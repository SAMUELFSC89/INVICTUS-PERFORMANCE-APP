import { Capacitor } from '@capacitor/core';
import { PushNotifications, type Token, type PushNotificationSchema, type ActionPerformed } from '@capacitor/push-notifications';
import { db } from '../firebase';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';

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

export async function initPushNotifications(userId: string, onNavigate?: (url: string) => void) {
  if (!Capacitor.isNativePlatform()) {
    console.log('[Push] Ambiente web/preview - registro de push pulado (apenas apps nativos).');
    return;
  }
  if (initialized) return;
  initialized = true;

  try {
    const permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive !== 'granted') {
      const req = await PushNotifications.requestPermissions();
      if (req.receive !== 'granted') {
        console.warn('[Push] Permissão de notificações negada pelo usuário.');
        return;
      }
    }

    await PushNotifications.addListener('registration', async (token: Token) => {
      console.log('[Push] Dispositivo registrado, token FCM obtido.');
      try {
        await updateDoc(doc(db, 'users', userId), {
          fcmTokens: arrayUnion(token.value),
        });
      } catch (err) {
        console.error('[Push] Falha ao salvar token FCM no Firestore:', err);
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
  } catch (err) {
    console.error('[Push] Falha ao inicializar push notifications:', err);
  }
}
