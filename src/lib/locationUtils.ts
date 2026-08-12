
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

// Active native watches map: maps numeric browser IDs to native string IDs
let nextWatchId = 1;
const watchMap = new Map<number, string>();

/**
 * Robust check and request of native geolocation permissions for Android / iOS
 */
export async function requestNativePermissions(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  try {
    const status = await Geolocation.checkPermissions();
    if (status.location === 'granted' || status.coarseLocation === 'granted') {
      return true;
    }
    const req = await Geolocation.requestPermissions();
    return req.location === 'granted' || req.coarseLocation === 'granted';
  } catch (err) {
    console.error('[Location] Failed checking/requesting permissions via Capacitor:', err);
    return false;
  }
}

// Polyfill standard navigator.geolocation on Native Mobile Platforms
if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
  console.log('[Location] Mobile native platform detected. Polyfilling navigator.geolocation with Capacitor.');
  
  const nativeGeolocation = {
    getCurrentPosition: async (
      successCallback: PositionCallback,
      errorCallback?: PositionErrorCallback | null,
      options?: PositionOptions
    ) => {
      try {
        const hasPermission = await requestNativePermissions();
        if (!hasPermission && errorCallback) {
          errorCallback({
            code: 1, // PERMISSION_DENIED
            message: 'Permissão de localização negada pelo usuário.',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3
          } as GeolocationPositionError);
          return;
        }

        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: options?.enableHighAccuracy ?? true,
          timeout: options?.timeout ?? 15000,
          maximumAge: options?.maximumAge ?? 0
        });

        const formattedPosition = {
          coords: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude,
            altitudeAccuracy: pos.coords.altitudeAccuracy,
            heading: pos.coords.heading,
            speed: pos.coords.speed,
          },
          timestamp: pos.timestamp
        } as any as GeolocationPosition;

        successCallback(formattedPosition);
      } catch (err: any) {
        console.error('[Location Polyfill] getCurrentPosition error:', err);
        if (errorCallback) {
          errorCallback({
            code: err.code === 'PERMISSION_DENIED' ? 1 : 2,
            message: err.message || 'Erro ao obter localização precisa.',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3
          } as GeolocationPositionError);
        }
      }
    },

    watchPosition: (
      successCallback: PositionCallback,
      errorCallback?: PositionErrorCallback | null,
      options?: PositionOptions
    ): number => {
      const browserId = nextWatchId++;
      
      requestNativePermissions().then(async (hasPermission) => {
        if (!hasPermission) {
          if (errorCallback) {
            errorCallback({
              code: 1,
              message: 'Permissão de localização negada.',
              PERMISSION_DENIED: 1,
              POSITION_UNAVAILABLE: 2,
              TIMEOUT: 3
            } as GeolocationPositionError);
          }
          return;
        }

        try {
          const nativeId = await Geolocation.watchPosition(
            {
              enableHighAccuracy: options?.enableHighAccuracy ?? true,
              timeout: options?.timeout ?? 15000,
              maximumAge: options?.maximumAge ?? 0
            },
            (pos, err) => {
              if (err && errorCallback) {
                errorCallback({
                  code: 2,
                  message: err.message || 'Erro no rastreamento de localização.',
                  PERMISSION_DENIED: 1,
                  POSITION_UNAVAILABLE: 2,
                  TIMEOUT: 3
                } as GeolocationPositionError);
                return;
              }
              if (pos) {
                successCallback({
                  coords: {
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                    altitude: pos.coords.altitude,
                    altitudeAccuracy: pos.coords.altitudeAccuracy,
                    heading: pos.coords.heading,
                    speed: pos.coords.speed,
                  },
                  timestamp: pos.timestamp
                } as any as GeolocationPosition);
              }
            }
          );
          watchMap.set(browserId, nativeId);
        } catch (err: any) {
          console.error('[Location Polyfill] watchPosition setup error:', err);
          if (errorCallback) {
            errorCallback({
              code: 2,
              message: err.message || 'Falha ao iniciar rastreamento de localização.',
              PERMISSION_DENIED: 1,
              POSITION_UNAVAILABLE: 2,
              TIMEOUT: 3
            } as GeolocationPositionError);
          }
        }
      });

      return browserId;
    },

    clearWatch: (id: number) => {
      const nativeId = watchMap.get(id);
      if (nativeId) {
        Geolocation.clearWatch({ id: nativeId }).catch((e) =>
          console.error('[Location Polyfill] clearWatch error', e)
        );
        watchMap.delete(id);
      }
    }
  };

  // Replace global geolocation
  try {
    Object.defineProperty(window.navigator, 'geolocation', {
      value: nativeGeolocation,
      writable: true,
      configurable: true
    });
    console.log('[Location] Global navigator.geolocation successfully polyfilled on native.');
  } catch (e) {
    console.error('[Location] Failed to overwrite window.navigator.geolocation:', e);
  }
}

/**
 * Standard utility for getting current location with mandatory high accuracy settings
 * Enforces: enableHighAccuracy: true, maximumAge: 0, timeout: 15000
 */
export async function getCurrentLocation(
  highAccuracy = true, 
  timeout = 15000
): Promise<{ lat: number; lng: number; accuracy?: number }> {
  console.log('[Location] getCurrentLocation called with strictly high accuracy, maximumAge=0', { highAccuracy, timeout });
  
  if (!navigator.geolocation) {
    throw new Error('Geolocalização não suportada neste navegador.');
  }

  // Explicitly trigger permissions check on native
  if (Capacitor.isNativePlatform()) {
    await requestNativePermissions();
  }

  return new Promise<{ lat: number; lng: number; accuracy?: number }>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        console.log('[Location] Fresh GPS position acquired:', latitude, longitude, 'Accuracy:', accuracy);
        
        const isMocked = (pos as any).isMocked || (pos.coords as any).isMocked;
        if (isMocked) {
          console.error('[Location] Mock location detected!');
          reject(new Error('Uso de localização simulada (Mock Location) detectado. Fraude não é permitida.'));
          return;
        }

        resolve({
          lat: latitude,
          lng: longitude,
          accuracy: accuracy
        });
      },
      (err) => {
        console.error('[Location] Error acquiring fresh GPS location:', err);
        let msg = 'Erro ao obter localização de alta precisão.';
        if (err.code === 1) {
          msg = 'Permissão de localização negada. Ative a permissão de localização no seu dispositivo.';
        } else if (err.code === 2) {
          msg = 'Sinal de GPS indisponível ou inacessível. Vá para uma área aberta e tente novamente.';
        } else if (err.code === 3) {
          msg = 'Tempo limite esgotado ao tentar obter sua localização de alta precisão (15s). Tente novamente em local aberto.';
        }
        reject(new Error(msg));
      },
      { 
        enableHighAccuracy: true, 
        timeout: 15000, 
        maximumAge: 0 // STRICT REQUIREMENT: Never use cached locations
      }
    );
  });
}

export function watchLocation(
  onSuccess: (coords: { lat: number; lng: number }) => void,
  onError: (error: Error) => void,
  highAccuracy = true
): number {
  if (!navigator.geolocation) {
    onError(new Error('Geolocalização não suportada.'));
    return 0;
  }

  return navigator.geolocation.watchPosition(
    (pos) => {
      onSuccess({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      });
    },
    (err) => {
      console.warn('[Location] Watch Error:', err.code, err.message);
      let msg = 'Erro no rastreamento GPS.';
      if (err.code === 1) msg = 'Permissão de GPS negada.';
      onError(new Error(msg));
    },
    { enableHighAccuracy: highAccuracy }
  );
}

