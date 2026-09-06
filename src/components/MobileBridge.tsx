import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { auth, getRedirectResult } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { WearableManager } from '../services/wearables/WearableManager';
import { healthSummaryService } from '../services/healthSummaryService';

// Saúde passiva precisa chegar com baixa latência enquanto o app está em uso.
// O iOS não garante timers JavaScript com o app suspenso/encerrado; nesses
// estados sincronizamos imediatamente no próximo resume. Em primeiro plano,
// vitais são verificados a cada 2 minutos. Atividades completas continuam com
// uma janela maior porque são payloads bem mais pesados que passos/HRV/FC/etc.
const INTERVALO_AUTO_SYNC_MS = 2 * 60 * 1000;
const MINUTOS_MINIMOS_VITAIS = 1.5;
const MINUTOS_MINIMOS_ATIVIDADES = 4;
let syncEmAndamento: Promise<void> | null = null;

async function tentarSincronizacaoAutomatica() {
  if (!auth.currentUser) return;
  if (syncEmAndamento) return syncEmAndamento;
  syncEmAndamento = (async () => {
    try {
      const manager = WearableManager.getInstance();
      const config = await manager.loadConfig();
      if (!config.autoSync) return;
      if (!config.appleHealthConnected && !config.healthConnectConnected) return;

      const minutosAtividade = config.lastSyncTime
        ? (Date.now() - new Date(config.lastSyncTime).getTime()) / 60000
        : Infinity;
      const minutosSaude = config.lastVitalsSyncTime
        ? (Date.now() - new Date(config.lastVitalsSyncTime).getTime()) / 60000
        : Infinity;

      const tarefas: Promise<unknown>[] = [];
      if (minutosAtividade >= MINUTOS_MINIMOS_ATIVIDADES) {
        tarefas.push(manager.syncAll());
      }
      if (minutosSaude >= MINUTOS_MINIMOS_VITAIS) {
        const vitalsTask = manager.syncVitals().then((result) => {
          // O resumo da tela Saúde não pode permanecer preso no cache depois
          // que uma nova revisão de passos/vitais foi persistida.
          healthSummaryService.invalidate();
          window.dispatchEvent(new CustomEvent('invictus:health-sync-complete', {
            detail: {
              savedCount: result.savedCount,
              syncedAt: new Date().toISOString(),
              reads: result.diagnostics?.reads?.map((read) => ({
                dataType: read.dataType,
                status: read.status,
                count: read.count
              })) || []
            }
          }));
          return result;
        });
        tarefas.push(vitalsTask);
      }
      if (tarefas.length) await Promise.allSettled(tarefas);
    } catch (err) {
      // Silenciosa de propósito -- não pode interromper o uso do app nem
      // aparecer como erro pro usuário só porque a sincronização automática
      // falhou no momento (ex.: sem internet).
      console.warn('[MobileBridge] Sincronização automática não concluída:', err);
    } finally {
      syncEmAndamento = null;
    }
  })();
  return syncEmAndamento;
}

export function MobileBridge() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Handle back button
    const backListener = CapApp.addListener('backButton', ({ canGoBack }) => {
      if (location.pathname === '/') {
        CapApp.exitApp();
      } else if (canGoBack) {
        window.history.back();
      } else {
        navigate('/');
      }
    });

    // Handle deep link / OAuth return
    const appUrlListener = CapApp.addListener('appUrlOpen', async (data) => {
      console.log('[MobileBridge] Deep link appUrlOpen received:', data.url);

      try {
        await Browser.close();
      } catch (e) {
        // Browser was not open or already closed
      }

      // #250: retorno do OAuth do Strava (ver api/_handlers/strava.ts,
      // buildStravaRedirectUrl) -- avisa quem estiver na tela de Dispositivos
      // (ProfileSecondary) pra atualizar o status sem exigir refresh manual.
      if (data.url.includes('strava-callback')) {
        const outcome = data.url.includes('strava=error') ? 'error' : 'connected';
        window.dispatchEvent(new CustomEvent('invictus:strava-callback', { detail: { outcome } }));
        return;
      }

      // Check if this is an auth redirect
      if (
        data.url.includes('access_token') ||
        data.url.includes('code') ||
        data.url.includes('state') ||
        data.url.includes('auth') ||
        data.url.includes('com.desafiosemdesculpa.app') ||
        data.url.includes('invictus')
      ) {
        try {
          const res = await getRedirectResult(auth);
          if (res?.user) {
            console.log('[MobileBridge] OAuth login completed via deep link:', res.user.uid);
          }
        } catch (err) {
          console.error('[MobileBridge] Error processing redirect result:', err);
        }
      }
    });

    // Handle external links
    const handleExternalLinks = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest('a');

      if (anchor && anchor.href) {
        const url = new URL(anchor.href);
        const isExternal = url.hostname !== window.location.hostname;

        if (isExternal) {
          e.preventDefault();
          Browser.open({ url: anchor.href });
        }
      }
    };

    document.addEventListener('click', handleExternalLinks);

    return () => {
      backListener.then(l => l.remove());
      appUrlListener.then(l => l.remove());
      document.removeEventListener('click', handleExternalLinks);
    };
  }, [navigate, location]);

  // Efeito próprio: instala uma vez e reage a autenticação, retomada do app e
  // ao timer de primeiro plano. Não depende de rota para não duplicar timers.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) void tentarSincronizacaoAutomatica();
    });

    const stateListener = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void tentarSincronizacaoAutomatica();
    });

    const interval = setInterval(() => {
      void tentarSincronizacaoAutomatica();
    }, INTERVALO_AUTO_SYNC_MS);

    return () => {
      stateListener.then((l) => l.remove());
      unsubscribeAuth();
      clearInterval(interval);
    };
  }, []);

  // Permissões são solicitadas no contexto do recurso: GPS ao iniciar
  // atividade/alterar academia, HealthKit/Health Connect ao conectar a fonte e
  // notificações quando o atleta as ativa. Isso evita prompts em cascata ao
  // abrir o app e atende as exigências de revisão da Apple e do Google Play.
  return null;
}
