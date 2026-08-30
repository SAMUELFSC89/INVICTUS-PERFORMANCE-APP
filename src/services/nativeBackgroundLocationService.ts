import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeTrackedLocation {
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp: string;
  speedKmH?: number;
  isSimulated?: boolean;
}

interface NativeActivityLocationPlugin {
  startLocationTracking(): Promise<void>;
  getTrackedLocations(): Promise<{ locations?: NativeTrackedLocation[] }>;
  stopLocationTracking(): Promise<{ locations?: NativeTrackedLocation[] }>;
}

const NativeActivityLocation = registerPlugin<NativeActivityLocationPlugin>('InvictusActivity');

function supported(): boolean {
  const platform = Capacitor.getPlatform();
  return Capacitor.isNativePlatform() && (platform === 'ios' || platform === 'android');
}

export const nativeBackgroundLocationService = {
  async start(): Promise<void> {
    if (!supported()) return;
    await NativeActivityLocation.startLocationTracking();
  },

  async collectAndStop(): Promise<NativeTrackedLocation[]> {
    if (!supported()) return [];
    const result = await NativeActivityLocation.stopLocationTracking();
    return Array.isArray(result.locations) ? result.locations : [];
  },

  async stop(): Promise<void> {
    if (!supported()) return;
    await NativeActivityLocation.stopLocationTracking();
  }
};
