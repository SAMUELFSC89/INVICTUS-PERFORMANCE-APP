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
const notificationPreferenceKey = (uid: string) => `notifications-enabled:${uid}`;
const currentPushPlatform = () => Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';

export type PushNotificationPreferenceState = 'enabled' | 'disabled' | 'unset';

function safeInternalActionPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  // Nunca abra protocolo, host externo ou forma ambígua com barra invertida a
  // partir de payload de push. Os destinos válidos do app são rotas relativas
  // à própria origem, sempre iniciadas por uma única '/'.
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null;
  return path;
}

export function getPushNotificationPreferenceState(uid: string): PushNotificationPreferenceState {
  const scopedKey = notificationPreferenceKey(uid);
  const scoped = localStorage.getItem(scopedKey);
  if (scoped !== null) return scoped === 'true' ? 'enabled' : 'disabled';

  // Migração conservadora: a preferência antiga só pode ser atribuída a uma
  // conta quando o token salvo confirma que aquela mesma conta era a dona.
  const legacy = localStorage.getItem(LEGACY_NOTIFICATION_PREFERENCE_KEY);
  const tokenOwner = localStorage.getItem(DEVICE_TOKEN_OWNER_KEY);
  if (tokenOwner === uid && legacy !== null) {
    const state: PushNotificationPreferenceState = legacy === 'true' ? 'enabled' : 'disabled';
    localStorage.setItem(scopedKey, String(state === 'enabled'));
    return state;
  }

  // IMPORTANTE: conta nova é "unset", não "disabled". A versão anterior
  // transformava este estado em false durante o auth restore e, com isso,
  // nunca chamava requestPermissions()/register(). O servidor então não tinha
  // FCM/APNs token para entregar alertas na barra do celular.
  return 'unset';
}

export function pushNotificationsEnabledForUser(uid: string): boolean {
  return getPushNotificationPreferenceState(uid) === 'enabled';
}

function setPushNotificationPreference(uid: string, enabled: boolean): void {
  localStorage.setItem(notificationPreferenceKey(uid), String(enabled));
  // A tela de Preferências ainda lê esta chave legada. Espelhamos somente a
  // preferência da identidade atual; reconcile() a troca sincronicamente antes
  // do subtree do novo usuário ser renderizado.
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
    // Android < 8 não possui channels; falha de criação não impede o registro
    // FCM e o SDK ainda dispõe do canal fallback.
    console.warn('[Push] Não foi possível preparar o canal geral:', error);
  }
}

async function installListeners(expectedUid: string, onNavigate?: (url: string) => void): Promise<void> {
  await PushNotifications.removeAllListeners();
  await ensureGeneralAndroidChannel();

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
    // A apresentação visual em foreground é controlada por
    // capacitor.config.ts (alert/banner/list + sound). O listener permanece
    // somente para telemetria/navegação e não substitui a notificação nativa.
    console.log('[Push] Notificação recebida em primeiro plano:', notification.title);
  });

  await PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
    const actionPath = safeInternalActionPath(action.notification?.data?.actionUrl);
    if (!actionPath) return;
    if (onNavigate) onNavigate(actionPath);
    else window.location.assign(actionPath);
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
  if (initialized && initializedUserId === expectedUid) {
    setPushNotificationPreference(expectedUid, true);
    return true;
  }

  try {
    if (initializedUserId && initializedUserId !== expectedUid) await unregisterLocalPush();
    const permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive !== 'granted') {
      const req = await PushNotifications.requestPermissions();
      if (req.receive !== 'granted') {
        console.warn('[Push] Permissão de notificações negada pelo usuário.');
        // Só uma decisão real do sistema operacional vira opt-out persistente.
        // Erro de rede/FCM abaixo permanece "unset" e poderá tentar novamente.
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

/**
 * Chamado pelo ciclo global de autenticação.
 *
 * A primeira versão tratava conta sem preferência como se tivesse escolhido
 * "desativado". Por isso o app nunca solicitava a permissão nem registrava
 * FCM/APNs para a maioria das instalações. Agora:
 * - enabled: reconcilia/re-registra silenciosamente;
 * - disabled: respeita o opt-out e remove o token;
 * - unset: limpa qualquer token herdado de outra conta e executa o opt-in
 *   inicial UMA vez. Negação do SO persiste disabled e não volta a incomodar.
 */
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

    // Transfira a propriedade ANTES de invalidar o token local. Se unregister
    // falhar, o token já não pertence à conta anterior no servidor.
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
      // Um token transferido acima só serviu para tirar com segurança a posse
      // da conta anterior. Conta nova ainda não consentiu: remova-o antes de
      // abrir o prompt e só recadastre após permissão concedida.
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
      // O usuário pode ter revogado a permissão nas Configurações do sistema.
      // Não reabrimos prompt automaticamente para uma preferência já definida.
      if (initializedUserId && initializedUserId !== nextUid) await unregisterLocalPush();
      return;
    }

    if (initializedUserId && initializedUserId !== nextUid) await unregisterLocalPush();
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
  if (currentUser) setPushNotificationPreference(currentUser.uid, false);
  else localStorage.setItem(LEGACY_NOTIFICATION_PREFERENCE_KEY, 'false');
}
