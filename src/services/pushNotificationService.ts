import { Capacitor } from '@capacitor/core';
import { PushNotifications, type Token, type PushNotificationSchema, type ActionPerformed } from '@capacitor/push-notifications';
import { auth } from '../firebase';
import { API_CONFIG } from '../config';

/**
 * REAL PUSH NOTIFICATION REGISTRATION (Android/iOS notification bar)
 * --------------------------------------------------------------------
 * Before this, @capacitor/push-notifications was installed and permission
 * was requested during onboarding (see src/lib/nativePermissions.ts), but
 * PushNotifications.register() was never called and no FCM token was ever
 * captured or stored - so the backend had no device to push to, even
 * though it "looked" wired. This closes that gap:
 *
 *   1. Registers the device with FCM/APNs.
 *   2. Saves the resulting token onto users/{uid}.fcmTokens (an array,
 *      since a user may have multiple devices).
 *   3. Handles taps on a delivered notification (deep link via actionUrl).
 *
 * NOTE: this still requires google-services.json to exist under android/app
 * (not committed to this repo yet - must be downloaded from the Firebase
 * console) for Android push to actually deliver, and an APNs key uploaded
 * to Firebase for iOS. Without those, register() will simply fail silently
 * and no token will be captured - everything else in the notification
 * system (in-app Bell) works regardless.
 */

let initialized = false;
const DEVICE_TOKEN_KEY = 'invictus_push_device_token';
const currentPushPlatform = () => Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';

async function saveDeviceToken(token: string): Promise<void> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Sessão inválida para registrar notificações.');

  const response = await fetch(`${API_CONFIG.baseUrl}/api/profile?action=device-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ token, platform: currentPushPlatform() }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || 'Não foi possível registrar este dispositivo.');
  }
}

export async function initPushNotifications(onNavigate?: (url: string) => void): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    console.log('[Push] Ambiente web/preview - registro de push pulado (apenas apps nativos).');
    return true;
  }
  if (initialized) return true;

  try {
    const permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive !== 'granted') {
      const req = await PushNotifications.requestPermissions();
      if (req.receive !== 'granted') {
        console.warn('[Push] Permissão de notificações negada pelo usuário.');
        return false;
      }
    }

    await PushNotifications.addListener('registration', async (token: Token) => {
      console.log('[Push] Dispositivo registrado, token FCM obtido.');
      try {
        await saveDeviceToken(token.value);
        localStorage.setItem(DEVICE_TOKEN_KEY, token.value);
      } catch (err) {
        console.error('[Push] Falha ao salvar token de push no servidor:', err);
      }
    });

    await PushNotifications.addListener('registrationError', (err) => {
      console.error('[Push] Erro ao registrar para push notifications:', err.error);
    });

    await PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
      console.log('[Push] Notificação recebida em primeiro plano:', notification.title);
    });

    await PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      const actionUrl = action.notification?.data?.actionUrl;
      if (actionUrl && onNavigate) {
        onNavigate(actionUrl);
      }
    });

    await PushNotifications.register();
    initialized = true;
    return true;
  } catch (err) {
    console.error('[Push] Falha ao inicializar push notifications:', err);
    return false;
  }
}

/**
 * Desativa a inscrição deste aparelho no servidor. A preferência visual nunca
 * deve dizer "desativada" enquanto o token ainda está apto a receber push.
 */
export async function disablePushNotifications(): Promise<void> {
  const token = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (token) {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error('Sessão inválida para desativar notificações.');

    const response = await fetch(`${API_CONFIG.baseUrl}/api/profile?action=remove-device-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ token, platform: currentPushPlatform() }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || 'Não foi possível remover este dispositivo.');
    }
    localStorage.removeItem(DEVICE_TOKEN_KEY);
  }

  if (Capacitor.isNativePlatform()) {
    await PushNotifications.removeAllListeners();
  }
  initialized = false;
}
