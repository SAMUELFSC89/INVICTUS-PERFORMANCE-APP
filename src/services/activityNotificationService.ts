import { Capacitor } from '@capacitor/core';
import { ForegroundService, Importance, ServiceType } from '@capawesome-team/capacitor-android-foreground-service';
import type { PluginListenerHandle } from '@capacitor/core';
import type { ActivitySession } from '../types';

// #328: notificação persistente com controle da atividade (pausar/retomar/
// finalizar) para sessões que realmente dependem de localização contínua.
//
// No Android 14+ um foreground service do tipo `location` precisa corresponder
// a um uso real de localização e só pode ser iniciado quando a permissão de
// localização está válida. Portanto não usamos esse FGS como simples timer de
// musculação/atividade indoor: ele existe para proteger a continuidade do GPS
// em sessões com `requiresGpsDistance=true`.
//
// POST_NOTIFICATIONS é independente da capacidade de iniciar um foreground
// service. Se o usuário negar notificações no Android 13+, o sistema ainda
// permite iniciar o FGS (a visibilidade da notificação fica sob controle do
// próprio Android). Por isso a continuidade do GPS nunca pode depender da
// permissão de notificações.
//
// No iOS o equivalente é uma Live Activity (ActivityKit), mantida em
// activityLiveActivityService.ts.

const NOTIFICATION_ID = 4281;
const CHANNEL_ID = 'invictus_activity';
const BUTTON_PAUSE_RESUME = 1;
const BUTTON_FINISH = 2;
const MIN_UPDATE_INTERVAL_MS = 5000;

let channelReady = false;
let isRunning = false;
let lastUpdateAt = 0;
let listenerHandle: PluginListenerHandle | null = null;

function isAndroid(): boolean {
  return Capacitor.getPlatform() === 'android';
}

function shouldUseLocationForegroundService(session: ActivitySession): boolean {
  return session.requiresGpsDistance === true && session.isPaused !== true;
}

function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function buildContent(session: ActivitySession, elapsedSeconds: number, distanceKm?: number) {
  const title = 'Invictus · Cardio em andamento';
  const parts = [formatElapsed(elapsedSeconds)];
  if (typeof distanceKm === 'number' && distanceKm > 0) {
    parts.push(`${distanceKm.toFixed(2)} km`);
  }
  return { title, body: parts.join(' · ') };
}

function buildButtons(session: ActivitySession) {
  return [
    { id: BUTTON_PAUSE_RESUME, title: session.isPaused ? 'Retomar' : 'Pausar' },
    { id: BUTTON_FINISH, title: 'Finalizar' },
  ];
}

async function ensureChannel(): Promise<void> {
  if (channelReady) return;
  try {
    await ForegroundService.createNotificationChannel({
      id: CHANNEL_ID,
      name: 'Atividade em andamento',
      description: 'Controle da atividade cardio e continuidade do GPS em segundo plano.',
      importance: Importance.Low,
    });
    channelReady = true;
  } catch (err) {
    // Não sela `channelReady` em falha transitória: uma próxima tentativa de
    // start precisa poder recriar o canal depois que a ponte nativa voltar.
    channelReady = false;
    throw err;
  }
}

export const activityNotificationService = {
  isSupported(): boolean {
    return isAndroid();
  },

  /** Registra o listener de clique nos botões da notificação uma única vez. */
  async registerButtonListener(onTogglePause: () => void, onFinish: () => void): Promise<void> {
    if (!isAndroid()) return;
    try {
      if (listenerHandle) {
        await listenerHandle.remove();
        listenerHandle = null;
      }
      listenerHandle = await ForegroundService.addListener('buttonClicked', (event) => {
        if (event.buttonId === BUTTON_PAUSE_RESUME) onTogglePause();
        else if (event.buttonId === BUTTON_FINISH) onFinish();
      });
    } catch (err) {
      console.warn('[activityNotificationService] registerButtonListener falhou:', err);
    }
  },

  async start(session: ActivitySession, elapsedSeconds: number, distanceKm?: number): Promise<void> {
    if (!isAndroid() || !shouldUseLocationForegroundService(session)) return;
    try {
      await ensureChannel();
      const { title, body } = buildContent(session, elapsedSeconds, distanceKm);
      await ForegroundService.startForegroundService({
        id: NOTIFICATION_ID,
        title,
        body,
        smallIcon: 'ic_stat_invictus_activity',
        serviceType: ServiceType.Location,
        notificationChannelId: CHANNEL_ID,
        silent: true,
        buttons: buildButtons(session),
      });
      isRunning = true;
      lastUpdateAt = Date.now();
    } catch (err) {
      isRunning = false;
      console.warn('[activityNotificationService] start falhou:', err);
    }
  },

  /**
   * Sincroniza o FGS com o estado da atividade.
   * Pausa/atividade sem GPS => encerra o serviço location.
   * Retomada de cardio GPS => recria o serviço antes de voltar ao background.
   */
  async sync(session: ActivitySession, elapsedSeconds: number, distanceKm?: number): Promise<void> {
    if (!isAndroid()) return;
    if (!shouldUseLocationForegroundService(session)) {
      await this.stop();
      return;
    }
    if (!isRunning) {
      await this.start(session, elapsedSeconds, distanceKm);
      return;
    }
    await this.update(session, elapsedSeconds, distanceKm, true);
  },

  /** `force=true` ignora o intervalo mínimo -- usar em mudanças de estado. */
  async update(session: ActivitySession, elapsedSeconds: number, distanceKm?: number, force = false): Promise<void> {
    if (!isAndroid() || !isRunning || !shouldUseLocationForegroundService(session)) return;
    const now = Date.now();
    if (!force && now - lastUpdateAt < MIN_UPDATE_INTERVAL_MS) return;
    lastUpdateAt = now;
    try {
      const { title, body } = buildContent(session, elapsedSeconds, distanceKm);
      await ForegroundService.updateForegroundService({
        id: NOTIFICATION_ID,
        title,
        body,
        smallIcon: 'ic_stat_invictus_activity',
        serviceType: ServiceType.Location,
        notificationChannelId: CHANNEL_ID,
        silent: true,
        buttons: buildButtons(session),
      });
    } catch (err) {
      console.warn('[activityNotificationService] update falhou:', err);
    }
  },

  async stop(): Promise<void> {
    if (!isAndroid()) return;
    // `isRunning` vive no processo JS. Depois de recriação do WebView ele pode
    // voltar a false mesmo com um serviço nativo antigo ainda ativo. Sempre
    // tentamos parar no Android; a chamada nativa é tratada como idempotente.
    isRunning = false;
    lastUpdateAt = 0;
    try {
      await ForegroundService.stopForegroundService();
    } catch (err) {
      console.warn('[activityNotificationService] stop falhou:', err);
    }
  },
};
