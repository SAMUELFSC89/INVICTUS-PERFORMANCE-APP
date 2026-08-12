import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { PushNotifications } from '@capacitor/push-notifications';
import { HealthConnectProvider } from '../services/wearables/HealthConnectProvider';

export interface PermissionStatusSummary {
  location: 'granted' | 'denied' | 'prompt';
  healthConnect: 'granted' | 'denied' | 'prompt';
  notifications: 'granted' | 'denied' | 'prompt';
  isNative: boolean;
  allGranted: boolean;
}

const healthProvider = new HealthConnectProvider();

/**
 * Check state of core permissions on native Android APK / iOS / Web
 */
export async function checkAllNativePermissions(): Promise<PermissionStatusSummary> {
  const isNative = Capacitor.isNativePlatform();

  if (!isNative) {
    // In browser preview, return mock granted state so web dev is smooth
    return {
      location: 'granted',
      healthConnect: 'granted',
      notifications: 'granted',
      isNative: false,
      allGranted: true,
    };
  }

  let locationStatus: 'granted' | 'denied' | 'prompt' = 'prompt';
  let healthConnectStatus: 'granted' | 'denied' | 'prompt' = 'prompt';
  let notificationStatus: 'granted' | 'denied' | 'prompt' = 'prompt';

  // 1. Geolocation check
  try {
    const geo = await Geolocation.checkPermissions();
    if (geo.location === 'granted' || geo.coarseLocation === 'granted') {
      locationStatus = 'granted';
    } else if (geo.location === 'denied' && geo.coarseLocation === 'denied') {
      locationStatus = 'denied';
    } else {
      locationStatus = 'prompt';
    }
  } catch (err) {
    console.warn('[Permissions] Failed checking location status:', err);
  }

  // 2. Health Connect check
  try {
    const isHCConnected = await healthProvider.isConnected();
    healthConnectStatus = isHCConnected ? 'granted' : 'prompt';
  } catch (err) {
    console.warn('[Permissions] Failed checking Health Connect status:', err);
  }

  // 3. Push Notifications check
  try {
    const notif = await PushNotifications.checkPermissions();
    if (notif.receive === 'granted') {
      notificationStatus = 'granted';
    } else if (notif.receive === 'denied') {
      notificationStatus = 'denied';
    } else {
      notificationStatus = 'prompt';
    }
  } catch (err) {
    console.warn('[Permissions] Failed checking Push Notifications status:', err);
  }

  const allGranted = locationStatus === 'granted' && healthConnectStatus === 'granted';

  return {
    location: locationStatus,
    healthConnect: healthConnectStatus,
    notifications: notificationStatus,
    isNative,
    allGranted,
  };
}

/**
 * Sequentially trigger native OS permission dialogs for Location, Health Connect & Notifications
 */
export async function requestAllNativePermissions(): Promise<PermissionStatusSummary> {
  console.log('[NativePermissions] Triggering full native permissions request flow...');

  if (!Capacitor.isNativePlatform()) {
    return checkAllNativePermissions();
  }

  // 1. Request Geolocation (Fine & Coarse)
  try {
    console.log('[NativePermissions] Step 1: Requesting Geolocation...');
    await Geolocation.requestPermissions();
  } catch (err) {
    console.error('[NativePermissions] Error requesting geolocation:', err);
  }

  // 2. Request Health Connect (HeartRate, Steps, Distance, Calories, Exercise)
  try {
    console.log('[NativePermissions] Step 2: Requesting Health Connect permissions...');
    await healthProvider.requestPermissions();
  } catch (err) {
    console.error('[NativePermissions] Error requesting Health Connect:', err);
  }

  // 3. Request Push Notifications
  try {
    console.log('[NativePermissions] Step 3: Requesting Push Notifications...');
    await PushNotifications.requestPermissions();
  } catch (err) {
    console.error('[NativePermissions] Error requesting push notifications:', err);
  }

  return checkAllNativePermissions();
}
