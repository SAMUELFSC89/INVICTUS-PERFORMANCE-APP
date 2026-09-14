import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { ActivitySession } from '../types';

// #328: Live Activity nativa (ActivityKit) da atividade em andamento --
// equivalente iOS da notificação persistente do Android
// (activityNotificationService.ts). Fala com um plugin Capacitor local
// (InvictusActivityPlugin.swift, dentro do próprio alvo do app -- não é um
// pacote npm) que por sua vez controla a Live Activity de verdade através
// da Widget Extension (InvictusActivityWidget). Só existe em iOS 16.1+;
// em qualquer outra plataforma/versão todo método aqui é um no-op seguro.

interface InvictusActivityStartOptions {
  sessionId: string;
  isCardio: boolean;
  title: string;
  distanceKm?: number;
}

interface InvictusActivityUpdateOptions {
  isPaused: boolean;
  referenceStartMs: number;
  frozenElapsedSeconds: number;
  distanceKm?: number;
  title: string;
}

interface InvictusActivityActionEvent {
  action: 'toggle_pause' | 'finish';
}

interface InvictusActivityPlugin {
  isSupported(): Promise<{ supported: boolean }>;
  start(options: InvictusActivityStartOptions): Promise<void>;
  update(options: InvictusActivityUpdateOptions): Promise<void>;
  end(): Promise<void>;
  addListener(
    eventName: 'activityAction',
    listenerFunc: (event: InvictusActivityActionEvent) => void
  ): Promise<PluginListenerHandle>;
}

const InvictusActivity = registerPlugin<InvictusActivityPlugin>('InvictusActivity');

// Igual ao throttle da notificação Android -- evita chamar a bridge nativa
// a cada tick de 1s do cronômetro.
const MIN_UPDATE_INTERVAL_MS = 5000;
let lastUpdateAt = 0;
let listenerHandle: PluginListenerHandle | null = null;

function isIOS(): boolean {
  return Capacitor.getPlatform() === 'ios';
}

function buildTitle(session: ActivitySession): string {
  return session.type === 'cardio' ? 'Cardio em andamento' : 'Treino em andamento';
}

export const activityLiveActivityService = {
  isSupported(): boolean {
    return isIOS();
  },

  async registerButtonListener(onTogglePause: () => void, onFinish: () => void): Promise<void> {
    if (!isIOS()) return;
    try {
      if (listenerHandle) {
        await listenerHandle.remove();
        listenerHandle = null;
      }
      listenerHandle = await InvictusActivity.addListener('activityAction', (event) => {
        if (event.action === 'toggle_pause') onTogglePause();
        else if (event.action === 'finish') onFinish();
      });
    } catch (err) {
      console.warn('[activityLiveActivityService] registerButtonListener falhou:', err);
    }
  },

  async start(session: ActivitySession, elapsedSeconds: number, distanceKm?: number): Promise<void> {
    if (!isIOS()) return;
    try {
      const { supported } = await InvictusActivity.isSupported();
      if (!supported) return; // Live Activities desativadas no sistema, ou iOS < 16.1
      await InvictusActivity.start({
        sessionId: session.id,
        isCardio: session.type === 'cardio',
        title: buildTitle(session),
        distanceKm: distanceKm ?? 0,
      });
      lastUpdateAt = Date.now();
      // Chamada inicial explícita: garante que o estado de pausa/cronômetro
      // já nasce correto mesmo se start() usar valores default.
      await this.update(session, elapsedSeconds, distanceKm, true);
    } catch (err) {
      console.warn('[activityLiveActivityService] start falhou:', err);
    }
  },

  async update(session: ActivitySession, elapsedSeconds: number, distanceKm?: number, force = false): Promise<void> {
    if (!isIOS()) return;
    const now = Date.now();
    if (!force && now - lastUpdateAt < MIN_UPDATE_INTERVAL_MS) return;
    lastUpdateAt = now;
    try {
      // Depois de um cold start não existe estado JS confiável dizendo se a
      // Live Activity nativa ainda está viva. O plugin atualiza todas as
      // Activities Invictus existentes; se não houver nenhuma, é um no-op.
      const referenceStartMs = now - elapsedSeconds * 1000;
      await InvictusActivity.update({
        isPaused: Boolean(session.isPaused),
        referenceStartMs,
        frozenElapsedSeconds: elapsedSeconds,
        distanceKm: distanceKm ?? 0,
        title: buildTitle(session),
      });
    } catch (err) {
      console.warn('[activityLiveActivityService] update falhou:', err);
    }
  },

  async stop(): Promise<void> {
    if (!isIOS()) return;
    try {
      // Também é best-effort após restart. Mesmo que esta instância JS nunca
      // tenha chamado start(), o plugin nativo consegue encerrar Activities
      // sobreviventes do processo anterior.
      await InvictusActivity.end();
    } catch (err) {
      console.warn('[activityLiveActivityService] stop falhou:', err);
    }
  },
};
