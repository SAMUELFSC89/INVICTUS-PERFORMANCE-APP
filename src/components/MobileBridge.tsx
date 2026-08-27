import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { auth, getRedirectResult } from '../firebase';
import { WearableManager } from '../services/wearables/WearableManager';

// #249: "Sincronização automática" no Perfil so gravava uma preferencia --
// nada realmente sincronizava sozinho, o usuario tinha que sempre apertar
// "SINCRONIZAR AGORA". Nao existe (nem seria seguro inventar aqui) um job
// verdadeiramente em segundo plano rodando com o app fechado -- isso exige
// plugin nativo proprio (Background Runner/WorkManager), permissoes e
// entitlements especificos por plataforma, nada disso instalado nem
// testavel neste ambiente. O que da pra fazer com o que ja existe: sincronizar
// sozinho toda vez que o app for aberto ou voltar ao primeiro plano, e a cada
// intervalo enquanto ficar aberto -- e o que a maioria dos apps chama de
// "automatico" na pratica.
const INTERVALO_AUTO_SYNC_MS = 20 * 60 * 1000; // 20 min de app aberto
const MINUTOS_MINIMOS_ENTRE_SYNCS = 15; // nao insiste se acabou de sincronizar

async function tentarSincronizacaoAutomatica() {
  if (!auth.currentUser) return;
  try {
    const manager = WearableManager.getInstance();
    const config = await manager.loadConfig();
    if (!config.autoSync) return;
    if (!config.appleHealthConnected && !config.healthConnectConnected) return;

    if (config.lastSyncTime) {
      const minutosDesdeUltimoSync = (Date.now() - new Date(config.lastSyncTime).getTime()) / 60000;
      if (minutosDesdeUltimoSync < MINUTOS_MINIMOS_ENTRE_SYNCS) return;
    }

    const resultado = await manager.syncAll();
    if (resultado.syncedCount > 0 || resultado.duplicatesSkipped > 0) {
      console.log(`[MobileBridge] Sincronização automática: ${resultado.syncedCount} nova(s), ${resultado.duplicatesSkipped} duplicata(s).`);
    }
  } catch (err) {
    // Silenciosa de proposito -- nao pode interromper o uso do app nem
    // aparecer como erro pro usuario so porque a sincronizacao em segundo
    // plano falhou (ex.: sem internet no momento).
    console.warn('[MobileBridge] Sincronização automática não concluída:', err);
  }
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

  // #249: efeito PROPRIO (nao dentro do efeito acima) -- aquele reinstala os
  // listeners a cada troca de rota (precisa do location.pathname atualizado
  // pro botao voltar), o que faria a sincronizacao automatica disparar a
  // cada navegacao. Aqui e so uma vez, e reage a abrir/voltar ao app.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    void tentarSincronizacaoAutomatica();

    const stateListener = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void tentarSincronizacaoAutomatica();
    });

    const interval = setInterval(() => { void tentarSincronizacaoAutomatica(); }, INTERVALO_AUTO_SYNC_MS);

    return () => {
      stateListener.then((l) => l.remove());
      clearInterval(interval);
    };
  }, []);

  // Permissões são solicitadas no contexto do recurso: GPS ao iniciar
  // atividade/alterar academia, HealthKit/Health Connect ao conectar a fonte e
  // notificações quando o atleta as ativa. Isso evita prompts em cascata ao
  // abrir o app e atende as exigências de revisão da Apple e do Google Play.
  return null;
}

