import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { PushNotifications } from '@capacitor/push-notifications';
import { AppleHealthProvider } from '../services/wearables/AppleHealthProvider';
import { HealthConnectProvider } from '../services/wearables/HealthConnectProvider';

export type PermissionState = 'granted' | 'denied' | 'prompt';

export interface PermissionStatusSummary {
  location: PermissionState;
  health: PermissionState;
  notifications: PermissionState;
  isNative: boolean;
}

function healthProvider() {
  return Capacitor.getPlatform() === 'ios'
    ? new AppleHealthProvider()
    : new HealthConnectProvider();
}

function normalizeNativePermission(value: string | undefined): PermissionState {
  if (value === 'granted') return 'granted';
  if (value === 'denied') return 'denied';
  return 'prompt';
}

/**
 * Consulta permissões sem abrir qualquer diálogo do sistema. Em navegadores
 * não há equivalência para HealthKit/Health Connect, por isso não fingimos que
 * elas estão liberadas: a interface deve mostrar dados apenas quando existirem.
 */
export async function checkNativePermissions(): Promise<PermissionStatusSummary> {
  if (!Capacitor.isNativePlatform()) {
    return { location: 'prompt', health: 'prompt', notifications: 'prompt', isNative: false };
  }

  let location: PermissionState = 'prompt';
  let health: PermissionState = 'prompt';
  let notifications: PermissionState = 'prompt';

  try {
    const status = await Geolocation.checkPermissions();
    if (status.location === 'granted' || status.coarseLocation === 'granted') location = 'granted';
    else if (status.location === 'denied' && status.coarseLocation === 'denied') location = 'denied';
  } catch (error) {
    console.warn('[Permissions] Não foi possível consultar localização:', error);
  }

  try {
    health = (await healthProvider().isConnected()) ? 'granted' : 'prompt';
  } catch (error) {
    console.warn('[Permissions] Não foi possível consultar integração de saúde:', error);
  }

  try {
    notifications = normalizeNativePermission((await PushNotifications.checkPermissions()).receive);
  } catch (error) {
    console.warn('[Permissions] Não foi possível consultar notificações:', error);
  }

  return { location, health, notifications, isNative: true };
}

/** Solicita GPS somente quando uma tela que usa localização a chama. */
export async function requestNativeLocationPermission(): Promise<PermissionState> {
  if (!Capacitor.isNativePlatform()) return 'prompt';
  try {
    const status = await Geolocation.requestPermissions();
    return status.location === 'granted' || status.coarseLocation === 'granted'
      ? 'granted'
      : normalizeNativePermission(status.location);
  } catch (error) {
    console.warn('[Permissions] Não foi possível solicitar localização:', error);
    return 'denied';
  }
}

/** Solicita HealthKit no iOS ou Health Connect no Android após o toque em conectar. */
export async function requestNativeHealthPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  return healthProvider().requestPermissions();
}

/** Solicita notificações somente após o usuário optar por ativá-las. */
export async function requestNativeNotificationPermission(): Promise<PermissionState> {
  if (!Capacitor.isNativePlatform()) return 'prompt';
  try {
    const status = await PushNotifications.requestPermissions();
    return normalizeNativePermission(status.receive);
  } catch (error) {
    console.warn('[Permissions] Não foi possível solicitar notificações:', error);
    return 'denied';
  }
}
