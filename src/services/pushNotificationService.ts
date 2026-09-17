import { Capacitor } from '@capacitor/core';
import { PushNotifications, type Token, type PushNotificationSchema, type ActionPerformed } from '@capacitor/push-notifications';
import { auth } from '../firebase';
import { API_CONFIG } from '../config';

/**
 * REAL PUSH NOTIFICATION REGISTRATION (Android/iOS notification bar)
 * --------------------------------------------------------------------
 * A push token represents the physical app installation, not a user. Because
 * more than one Invictus account can use the same device, both token ownership
 * and the app-level notification preference must be scoped by authenticated
 * UID. A device-wide preference would let account B silently inherit account
 * A's choice after a login switch.
 */

let initialized = false;
let initializedUserId: string | null = null;
const DEVICE_TOKEN_KEY = 'invictus_push_device_token';
const DEVICE_TOKEN_OWNER_KEY = 'invictus_push_device_token_owner';
const LEGACY_NOTIFICATION_PREFERENCE_KEY = 'notifications-enabled';
const GENERAL_NOTIFICATION_CHANNEL_ID = 'invictus_general';
const REGISTRATION_TIMEOUT_MS = 15_000;
const TOKEN_CLAIM_MAX_ATTEMPTS = 2;
const notificationPreferenceKey = (uid: string) => `notifications-enabled:${uid}`;
const currentPushPlatform = () => Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';

export type PushNotificationPreferenceState = 'enabled' | 'disabled' | 'unset';

function safeInternalActionPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null;
  return path;
}

export function getPushNotificationPreferenceState(uid: string): PushNotificationPreferenceState {
  const scopedKey = notificationPreferenceKey(uid);
  const scoped = localStorage.getItem(scopedKey);
  if (scoped !== null) return scoped === 'true' ? 'enabled' : 'disabled';

  const legacy = localStorage.getItem(LEGACY_NOTIFICATION_PREFERENCE_KEY);
  const tokenOwner = localStorage.getItem(DEVICE_TOKEN_OWNER_KEY);
  if (tokenOwner === uid && legacy !== null) {
    const state: PushNotificationPreferenceState = legacy === 'true' ? 'enabled' : 'disabled';
    localStorage.setItem(scopedKey, String(state === 'enabled'));
    return state;
  }

  return 'unset';
}

export function pushNotificationsEnabledForUser(uid: string): boolean {
  return getPushNotificationPreferenceState(uid) === 'enabled';
}

function setPushNotificationPreference(uid: string, enabled: boolean): void {
  localStorage.setItem(notificationPreferenceKey(uid), String(enabled));
  localStorage.setItem(LEGACY_NOTIFICATION_PREFERENCE_KEY, String(enabled));
}

function mirrorCurrentPreference(uid: string | null): void {
  if (!uid) {
    localStorage.setItem(LEGACY_NOTIFICATION_PREFERENCE_KEY, 'false');
    return;
  }
  localStorage.setItem(
    LEGACY_NOTIFICATION_PREFERENCE_KEY,
    String(getPushNotificationPreferenceState(uid) === 'enabled')
  );
}

const delay = (ms: number) => new Promise<void>(resolve => globalThis.setTimeout(resolve, ms));

async function updateDeviceTokenOwnership(action: 'claim-device-token' | 'remove-device-token', token: string, expectedUid: string): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= TOKEN_CLAIM_MAX_ATTEMPTS; attempt += 1) {
    const currentUser = auth.currentUser;
    if (!currentUser || currentUser.uid !== expectedUid) throw new Error('A conta mudou durante o registro de notificações.');

    try {
      const idToken = await currentUser.getIdToken(attempt > 1);
      if (auth.currentUser?.uid !== expectedUid) throw new Error('A conta mudou durante o registro de notificações.');

      const response = await fetch(`${API_CONFIG.baseUrl}/api/notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ action, token, platform: currentPushPlatform() }),
      });
      if (auth.currentUser?.uid !== expectedUid) throw new Error('A conta mudou durante o registro de notificações.');
      if (response.ok) return;

      const payload = await response.json().catch(() => null);
      const error = new Error(payload?.error || 'Não foi possível atualizar este dispositivo.');
      if (response.status < 500 || attempt === TOKEN_CLAIM_MAX_ATTEMPTS) throw error;
      lastError = error;
    } catch (error) {
      if (auth.currentUser?.uid !== expectedUid) throw new Error('A conta mudou durante o registro de notificações.');
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === TOKEN_CLAIM_MAX_ATTEMPTS) throw lastError;
    }

    await delay(450);
  }

  throw lastError || new Error('Não foi possível atualizar este dispositivo.');
}

async function saveDeviceToken(token: string, expectedUid: string): Promise<void> {
  await updateDeviceTokenOwnership('claim-device-token', token, expectedUid);
  if (auth.currentUser?.uid !== expectedUid) return;
  localStorage.setItem(DEVICE_TOKEN_KEY, token);
  localStorage.setItem(DEVICE_TOKEN_OWNER_KEY, expectedUid);
}

async function ensureGeneralAndroidChannel(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    await PushNotifications.createChannel({
      id: GENERAL_NOTIFICATION_CHANNEL_ID,
      name: 'Invictus',
      description: 'Missões, objetivos, conquistas e avisos importantes do Invictus.',
      importance: 4,
      visibility: 1,
      vibration: true,
      lights: true,
    });
  } catch (error) {
    console.warn('[Push] Não foi possível preparar o canal geral:', error);
  }
}

async function installListeners(expectedUid: string, onNavigate?: (url: string) => void): Promise<void> {
  await PushNotifications.removeAllListeners();
  await ensureGeneralAndroidChannel();

  let settled = false;
  let resolveRegistration!: () => void;
  let rejectRegistration!: (error: Error) => void;
  const registrationReady = new Promise<void>((resolve, reject) => {
    resolveRegistration = resolve;
    rejectRegistration = reject;
  });
  const timeout = globalThis.setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectRegistration(new Error('O aparelho não retornou um token de notificações a tempo.'));
  }, REGISTRATION_TIMEOUT_MS);

  const settleSuccess = () => {
    if (settled) return;
    settled = true;
    globalThis.clearTimeout(timeout);
    resolveRegistration();
  };
  const settleFailure = (error: unknown) => {
    if (settled) return;
    settled = true;
    globalThis.clearTimeout(timeout);
    rejectRegistration(error instanceof Error ? error : new Error(String(error)));
  };

  await PushNotifications.addListener('registration', async (token: Token) => {
    if (auth.currentUser?.uid !== expectedUid) {
      settleFailure(new Error('A conta mudou durante o registro de notificações.'));
      return;
    }
    console.log('[Push] Dispositivo registrado, token obtido.');
    try {
      await saveDeviceToken(token.value, expectedUid);
      settleSuccess();
    } catch (err) {
      console.error('[Push] Falha ao vincular token de push à conta atual:', err);
      settleFailure(err);
    }
  });

  await PushNotifications.addListener('registrationError', (err) => {
    console.error('[Push] Erro ao registrar para push notifications:', err.error);
    settleFailure(new Error(err.error || 'O sistema não conseguiu registrar notificações neste aparelho.'));
  });

  await PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
    console.log('[Push] Notificação recebida em primeiro plano:', notification.title);
  });

  await PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
    const actionPath = safeInternalActionPath(action.notification?.data?.actionUrl);
    if (!actionPath) return;
    if (onNavigate) onNavigate(actionPath);
    else window.location.assign(actionPath);
  });

  try {
    await PushNotifications.register();
    await registrationReady;
    initialized = true;
    initializedUserId = expectedUid;
  } catch (error) {
    globalThis.clearTimeout(timeout);
    initialized = false;
    initializedUserId = null;
    try { await PushNotifications.removeAllListeners(); } catch { /* best effort */ }
    throw error;
  }
}

async function unregisterLocalPush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try { await PushNotifications.removeAllListeners(); } catch { /* best effort */ }
  try { await PushNotifications.unregister(); } catch (error) {
    console.warn('[Push] Não foi possível invalidar o token nativo durante troca de conta:', error);
  }
  initialized = false;
  initializedUserId = null;
  localStorage.removeItem(DEVICE_TOKEN_KEY);
  localStorage.removeItem(DEVICE_TOKEN_OWNER_KEY);
}

export async function initPushNotifications(onNavigate?: (url: string) => void): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    console.log('[Push] Ambiente web/preview - registro de push pulado (apenas apps nativos).');
    return true;
  }

  const expectedUid = auth.currentUser?.uid;
  if (!expectedUid) return false;
  if (initialized && initializedUserId === expectedUid) {
    const token = localStorage.getItem(DEVICE_TOKEN_KEY);
    const owner = localStorage.getItem(DEVICE_TOKEN_OWNER_KEY);
    if (token && owner === expectedUid) {
      setPushNotificationPreference(expectedUid, true);
      return true;
    }
    initialized = false;
    initializedUserId = null;
  }

  try {
    if (initializedUserId && initializedUserId !== expectedUid) await unregisterLocalPush();
    const permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive !== 'granted') {
      const req = await PushNotifications.requestPermissions();
      if (req.receive !== 'granted') {
        console.warn('[Push] Permissão de notificações negada pelo usuário.');
        setPushNotificationPreference(expectedUid, false);
        return false;
      }
    }

    await installListeners(expectedUid, onNavigate);
    setPushNotificationPreference(expectedUid, true);
    return true;
  } catch (err) {
    console.error('[Push] Falha ao inicializar push notifications:', err);
    return false;
  }
}

export async function reconcilePushNotificationsForAuthChange(nextUid: string | null): Promise<void> {
  mirrorCurrentPreference(nextUid);
  if (!Capacitor.isNativePlatform()) return;

  if (!nextUid) {
    await unregisterLocalPush();
    return;
  }

  if (auth.currentUser?.uid !== nextUid) return;
  try {
    const preference = getPushNotificationPreferenceState(nextUid);
    const existingToken = localStorage.getItem(DEVICE_TOKEN_KEY);
    const existingOwner = localStorage.getItem(DEVICE_TOKEN_OWNER_KEY);

    if (existingToken && existingOwner !== nextUid) {
      await saveDeviceToken(existingToken, nextUid);
    }

    if (preference === 'disabled') {
      const tokenToRemove = localStorage.getItem(DEVICE_TOKEN_KEY);
      if (tokenToRemove) {
        await updateDeviceTokenOwnership('remove-device-token', tokenToRemove, nextUid);
      }
      await unregisterLocalPush();
      mirrorCurrentPreference(nextUid);
      return;
    }

    if (preference === 'unset') {
      const tokenToRemove = localStorage.getItem(DEVICE_TOKEN_KEY);
      if (tokenToRemove) {
        await updateDeviceTokenOwnership('remove-device-token', tokenToRemove, nextUid);
        await unregisterLocalPush();
      }
      await initPushNotifications();
      return;
    }

    const permission = await PushNotifications.checkPermissions();
    if (permission.receive !== 'granted') {
      if (initializedUserId && initializedUserId !== nextUid) await unregisterLocalPush();
      return;
    }

    if (initializedUserId && initializedUserId !== nextUid) await unregisterLocalPush();
    if (!initialized || initializedUserId !== nextUid) {
      await installListeners(nextUid);
    }
  } catch (error) {
    console.error('[Push] Falha ao reconciliar token após mudança de conta:', error);
    if (initializedUserId && initializedUserId !== nextUid) await unregisterLocalPush();
  }
}

export async function disablePushNotifications(): Promise<void> {
  const currentUser = auth.currentUser;
  const token = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (token && currentUser) {
    await updateDeviceTokenOwnership('remove-device-token', token, currentUser.uid);
  }
  await unregisterLocalPush();
  if (currentUser) setPushNotificationPreference(currentUser.uid, false);
  else localStorage.setItem(LEGACY_NOTIFICATION_PREFERENCE_KEY, 'false');
}
