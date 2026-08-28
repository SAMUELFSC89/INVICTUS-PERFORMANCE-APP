import { Capacitor } from '@capacitor/core';
import { ForegroundService, Importance, ServiceType } from '@capawesome-team/capacitor-android-foreground-service';
import type { PluginListenerHandle } from '@capacitor/core';
import type { ActivitySession } from '../types';

// #328: notificação persistente com controle da atividade (pausar/retomar/
// finalizar) mesmo com o app em segundo plano ou tela bloqueada.
//
// Só existe implementação nativa no Android (@capawesome-team/capacitor-
// android-foreground-service é Android-only -- ver README do plugin). No
// iOS o equivalente é uma Live Activity (ActivityKit), que fica em um
// serviço separado (activityLiveActivityService.ts) porque depende de um
// target de Widget Extension no projeto Xcode.
//
// Este serviço nunca deve travar ou falhar o fluxo real da atividade: toda
// chamada é best-effort (falhas apenas geram console.warn).

const NOTIFICATION_ID = 4281;
const CHANNEL_ID = 'invictus_activity';
const BUTTON_PAUSE_RESUME = 1;
const BUTTON_FINISH = 2;
// Atualizar a notificação a cada segundo (junto com o cronômetro da tela)
// sobrecarregaria o NotificationManager e o sistema pode começar a descartar
// atualizações. 5s é frequente o suficiente para o usuário perceber a
// notificação "viva" sem gerar throttling.
const MIN_UPDATE_INTERVAL_MS = 5000;

let channelReady = false;
let isRunning = false;
let lastUpdateAt = 0;
let listenerHandle: PluginListenerHandle | null = null;

function isAndroid(): boolean {
  return Capacitor.getPlatform() === 'android';
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
  const isCardio = session.type === 'cardio';
  const title = session.isPaused
    ? 'Invictus · Atividade em pausa'
    : isCardio ? 'Invictus · Cardio em andamento' : 'Invictus · Treino em andamento';
  const parts = [formatElapsed(elapsedSeconds)];
  if (isCardio && typeof distanceKm === 'number' && distanceKm > 0) {
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
  channelReady = true; // marca antes: não vale a pena tentar de novo toda hora se falhar
  try {
    await ForegroundService.createNotificationChannel({
      id: CHANNEL_ID,
      name: 'Atividade em andamento',
      description: 'Controle da atividade (pausar, retomar, finalizar) direto da notificação.',
      importance: Importance.Low,
    });
  } catch (err) {
    console.warn('[activityNotificationService] createNotificationChannel falhou:', err);
  }
}

async function ensurePermission(): Promise<boolean> {
  try {
    const status = await ForegroundService.checkPermissions();
    if (status.display === 'granted') return true;
    const requested = await ForegroundService.requestPermissions();
    return requested.display === 'granted';
  } catch (err) {
    // Em SDK < 33 o plugin nem exige essa permissão -- se o check falhar por
    // qualquer motivo, seguimos tentando iniciar o serviço mesmo assim.
    console.warn('[activityNotificationService] checagem de permissão falhou:', err);
    return true;
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
    if (!isAndroid()) return;
    try {
      await ensureChannel();
      const granted = await ensurePermission();
      if (!granted) return; // notificação é um extra -- nunca bloqueia o início da atividade
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
      console.warn('[activityNotificationService] start falhou:', err);
    }
  },

  /** `force=true` ignora o intervalo mínimo -- usar em mudanças de estado (pausar/retomar). */
  async update(session: ActivitySession, elapsedSeconds: number, distanceKm?: number, force = false): Promise<void> {
    if (!isAndroid() || !isRunning) return;
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
    if (!isAndroid() || !isRunning) return;
    isRunning = false;
    try {
      await ForegroundService.stopForegroundService();
    } catch (err) {
      console.warn('[activityNotificationService] stop falhou:', err);
    }
  },
};
