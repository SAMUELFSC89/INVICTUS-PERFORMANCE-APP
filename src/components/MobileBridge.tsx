import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { auth, getRedirectResult } from '../firebase';
import { NativePermissionBanner } from './NativePermissionBanner';
import { checkAllNativePermissions, requestAllNativePermissions } from '../lib/nativePermissions';

export function MobileBridge() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Check & proactively prompt for native permissions on initial native launch
    checkAllNativePermissions().then((status) => {
      if (!status.allGranted) {
        console.log('[MobileBridge] Proactively requesting missing native permissions...');
        requestAllNativePermissions().catch((e) =>
          console.warn('[MobileBridge] Permission prompt error:', e)
        );
      }
    });

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

  return <NativePermissionBanner />;
}

