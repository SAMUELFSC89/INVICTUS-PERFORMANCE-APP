import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { auth, getRedirectResult } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { WearableManager } from '../services/wearables/WearableManager';
import { healthSummaryService } from '../services/healthSummaryService';
import { parseNativeStravaCallback, resolveNativeDeepLinkRoute } from '../lib/nativeDeepLinks';

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
  const launchUrlHandledRef = useRef(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let disposed = false;

    const handleIncomingUrl = async (rawUrl: string) => {
      if (disposed || !rawUrl) return;
      console.log('[MobileBridge] Deep link recebido:', rawUrl);

      try {
        await Browser.close();
      } catch {
        // Browser não estava aberto ou já foi fechado.
      }
      if (disposed) return;

      // #250 + auditoria Gate 1: o callback agora também carrega o returnPath.
      // Isso é essencial no cold start: a WebView recém-criada não conserva a
      // rota que iniciou o OAuth e o CustomEvent pode acontecer antes de a tela
      // de Dispositivos montar seu listener.
      const stravaCallback = parseNativeStravaCallback(rawUrl);
      if (stravaCallback) {
        if (location.pathname !== stravaCallback.returnPath) {
          navigate(stravaCallback.returnPath, { replace: true });
        }
        window.dispatchEvent(new CustomEvent('invictus:strava-callback', {
          detail: { outcome: stravaCallback.outcome }
        }));
        return;
      }

      // iOS 16.x: o botão "Abrir no app" da Live Activity usa
      // invictus://activity. Antes o esquema apenas acordava o app; nenhuma
      // rota era aberta. O mesmo resolvedor é usado no warm e no cold start.
      const internalRoute = resolveNativeDeepLinkRoute(rawUrl);
      if (internalRoute) {
        navigate(internalRoute);
        return;
      }

      // Check if this is an auth redirect. Mantemos os formatos legados já
      // aceitos para não regredir Google/Firebase enquanto os deep links de
      // produto acima são tratados de forma estrita primeiro.
      if (
        rawUrl.includes('access_token') ||
        rawUrl.includes('code') ||
        rawUrl.includes('state') ||
        rawUrl.includes('auth') ||
        rawUrl.includes('com.desafiosemdesculpa.app') ||
        rawUrl.includes('invictus')
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
    };

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

    // Warm start / app já aberto.
    const appUrlListener = CapApp.addListener('appUrlOpen', (data) => {
      void handleIncomingUrl(data.url);
    });

    // Cold start. appUrlOpen sozinho não é contrato suficiente para recuperar
    // a URL que lançou uma WebView nova; o plugin App expõe getLaunchUrl()
    // exatamente para esse caso. O ref evita reprocessar a URL quando este
    // efeito é reinstalado por mudança de rota.
    if (!launchUrlHandledRef.current) {
      launchUrlHandledRef.current = true;
      void CapApp.getLaunchUrl()
        .then((launch) => {
          if (launch?.url) return handleIncomingUrl(launch.url);
          return undefined;
        })
        .catch((err) => console.warn('[MobileBridge] Não foi possível ler a URL de lançamento:', err));
    }

    // Handle external links
    const handleExternalLinks = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest('a');

      if (anchor && anchor.href) {
        const url = new URL(anchor.href);
        const isExternal = url.hostname !== window.location.hostname;

        if (isExternal) {
          e.preventDefault();
          void Browser.open({ url: anchor.href });
        }
      }
    };

    document.addEventListener('click', handleExternalLinks);

    return () => {
      disposed = true;
      backListener.then(l => l.remove());
      appUrlListener.then(l => l.remove());
      document.removeEventListener('click', handleExternalLinks);
    };
  }, [navigate, location.pathname]);

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
