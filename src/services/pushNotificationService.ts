import { Capacitor } from '@capacitor/core';
import { PushNotifications, type Token, type PushNotificationSchema, type ActionPerformed } from '@capacitor/push-notifications';
import { auth } from '../firebase';
import { API_CONFIG } from '../config';

/**
 * REAL PUSH NOTIFICATION REGISTRATION (Android/iOS notification bar)
 * --------------------------------------------------------------------
 * A push token represents the physical app installation, not a user. Because
 * more than one Invictus account can use the same device, the token owner must
 * be rebound whenever auth changes; otherwise account A could keep receiving
 * notifications after account B logs in on the same phone.
 */

let initialized = false;
let initializedUserId: string | null = null;
const DEVICE_TOKEN_KEY = 'invictus_push_device_token';
const DEVICE_TOKEN_OWNER_KEY = 'invictus_push_device_token_owner';
const currentPushPlatform = () => Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';

async function updateDeviceTokenOwnership(action: 'claim-device-token' | 'remove-device-token', token: string, expectedUid: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid !== expectedUid) throw new Error('A conta mudou durante o registro de notificações.');
  const idToken = await currentUser.getIdToken();
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
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || 'Não foi possível atualizar este dispositivo.');
  }
}

async function saveDeviceToken(token: string, expectedUid: string): Promise<void> {
  await updateDeviceTokenOwnership('claim-device-token', token, expectedUid);
  if (auth.currentUser?.uid !== expectedUid) return;
  localStorage.setItem(DEVICE_TOKEN_KEY, token);
  localStorage.setItem(DEVICE_TOKEN_OWNER_KEY, expectedUid);
}

async function installListeners(expectedUid: string, onNavigate?: (url: string) => void): Promise<void> {
  await PushNotifications.removeAllListeners();

  await PushNotifications.addListener('registration', async (token: Token) => {
    if (auth.currentUser?.uid !== expectedUid) return;
    console.log('[Push] Dispositivo registrado, token obtido.');
    try {
      await saveDeviceToken(token.value, expectedUid);
    } catch (err) {
      console.error('[Push] Falha ao vincular token de push à conta atual:', err);
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
    if (actionUrl && onNavigate) onNavigate(actionUrl);
  });

  await PushNotifications.register();
  initialized = true;
  initializedUserId = expectedUid;
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
  if (initialized && initializedUserId === expectedUid) return true;

  try {
    if (initializedUserId && initializedUserId !== expectedUid) await unregisterLocalPush();
    const permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive !== 'granted') {
      const req = await PushNotifications.requestPermissions();
      if (req.receive !== 'granted') {
        console.warn('[Push] Permissão de notificações negada pelo usuário.');
        return false;
      }
    }

    await installListeners(expectedUid, onNavigate);
    return true;
  } catch (err) {
    console.error('[Push] Falha ao inicializar push notifications:', err);
    return false;
  }
}

/**
 * Chamado pelo ciclo global de autenticação. Não abre prompt de permissão.
 * - logout/troca: invalida o token nativo local para o usuário anterior;
 * - login com permissão já concedida: registra novamente e o servidor transfere
 *   a propriedade exclusiva do token para o UID autenticado.
 */
export async function reconcilePushNotificationsForAuthChange(nextUid: string | null): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  if (!nextUid) {
    await unregisterLocalPush();
    return;
  }

  if (auth.currentUser?.uid !== nextUid) return;
  try {
    const permission = await PushNotifications.checkPermissions();
    if (permission.receive !== 'granted') {
      // Nunca solicite uma permissão sensível só porque a conta mudou.
      if (initializedUserId && initializedUserId !== nextUid) await unregisterLocalPush();
      return;
    }

    if (initializedUserId && initializedUserId !== nextUid) await unregisterLocalPush();

    // Se já temos um token desta instalação, reivindique-o imediatamente. Isso
    // fecha a janela de privacidade antes mesmo do callback de register().
    const existingToken = localStorage.getItem(DEVICE_TOKEN_KEY);
    const existingOwner = localStorage.getItem(DEVICE_TOKEN_OWNER_KEY);
    if (existingToken && existingOwner !== nextUid) {
      await saveDeviceToken(existingToken, nextUid);
    }

    if (!initialized || initializedUserId !== nextUid) {
      await installListeners(nextUid);
    }
  } catch (error) {
    console.error('[Push] Falha ao reconciliar token após mudança de conta:', error);
    // Não mantenha listeners associados à identidade anterior depois de falha.
    if (initializedUserId && initializedUserId !== nextUid) await unregisterLocalPush();
  }
}

/**
 * Desativa a inscrição deste aparelho para a conta atual. A remoção no servidor
 * acontece antes da invalidação local para não deixar um token ainda válido
 * associado ao usuário depois de a interface indicar "desativado".
 */
export async function disablePushNotifications(): Promise<void> {
  const currentUser = auth.currentUser;
  const token = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (token && currentUser) {
    await updateDeviceTokenOwnership('remove-device-token', token, currentUser.uid);
  }
  await unregisterLocalPush();
}
