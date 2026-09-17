import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('isolamento de push entre contas no mesmo aparelho', () => {
  it('mantém um único proprietário servidor para cada token físico', () => {
    const handler = read('api/_handlers/notifications.ts');
    expect(handler).toContain("action === 'claim-device-token'");
    expect(handler).toContain("collection('push_device_tokens')");
    expect(handler).toContain("where(meta.tokenField, 'array-contains', meta.token)");
    expect(handler).toContain('ownerUid: authUid');
    expect(handler).toContain('currentTokens.filter((value: string) => value !== meta.token)');
  });

  it('bloqueia envio quando a propriedade do token é divergente ou ambígua', () => {
    const service = read('api/_services/notification-service.ts');
    expect(service).toContain('filterOwnedPushTokens');
    expect(service).toContain("collection('push_device_tokens')");
    expect(service).toContain("where(tokenField, 'array-contains', token)");
    expect(service).toContain('legacyOwners.size === 1 && legacyOwners.docs[0].id === userId');
    expect(service).toContain('ownedFcmTokens');
    expect(service).toContain('ownedApnsTokens');
  });

  it('reivindica ou invalida token quando a identidade Firebase muda', () => {
    const service = read('src/services/pushNotificationService.ts');
    const context = read('src/UserContext.tsx');
    expect(service).toContain('initializedUserId');
    expect(service).toContain('reconcilePushNotificationsForAuthChange');
    expect(service).toContain('PushNotifications.unregister()');
    expect(service).toContain('DEVICE_TOKEN_OWNER_KEY');
    expect(service).toContain("'claim-device-token'");
    expect(context).toContain('reconcilePushNotificationsForAuthChange(firebaseUser?.uid || null)');
  });

  it('distingue conta nova de opt-out explícito', () => {
    const service = read('src/services/pushNotificationService.ts');
    expect(service).toContain("export type PushNotificationPreferenceState = 'enabled' | 'disabled' | 'unset'");
    expect(service).toContain('getPushNotificationPreferenceState');
    expect(service).toContain("return 'unset'");
    expect(service).toContain('setPushNotificationPreference(expectedUid, true)');
    expect(service).toContain('setPushNotificationPreference(currentUser.uid, false)');
  });

  it('solicita registro no primeiro uso nativo, mas respeita quem já desativou', () => {
    const service = read('src/services/pushNotificationService.ts');
    const start = service.indexOf('export async function reconcilePushNotificationsForAuthChange');
    const end = service.indexOf('/**\n * Desativa', start);
    const reconciliation = service.slice(start, end);
    expect(reconciliation).toContain("preference === 'unset'");
    expect(reconciliation).toContain('await initPushNotifications()');
    expect(reconciliation).toContain("preference === 'disabled'");
    expect(reconciliation).toContain("'remove-device-token'");
  });

  it('persiste opt-out somente quando o SO nega a permissão', () => {
    const service = read('src/services/pushNotificationService.ts');
    const initStart = service.indexOf('export async function initPushNotifications');
    const reconcileStart = service.indexOf('export async function reconcilePushNotificationsForAuthChange');
    const init = service.slice(initStart, reconcileStart);
    expect(init).toContain('PushNotifications.requestPermissions()');
    expect(init).toContain('setPushNotificationPreference(expectedUid, false)');
    expect(init.indexOf('setPushNotificationPreference(expectedUid, false)')).toBeGreaterThan(init.indexOf("req.receive !== 'granted'"));
  });

  it('só marca push como ativo depois de obter e reivindicar o token nativo', () => {
    const service = read('src/services/pushNotificationService.ts');
    const installStart = service.indexOf('async function installListeners');
    const unregisterStart = service.indexOf('async function unregisterLocalPush', installStart);
    const install = service.slice(installStart, unregisterStart);
    const initStart = service.indexOf('export async function initPushNotifications');
    const reconcileStart = service.indexOf('export async function reconcilePushNotificationsForAuthChange');
    const init = service.slice(initStart, reconcileStart);

    expect(install).toContain("PushNotifications.addListener('registration'");
    expect(install).toContain('await saveDeviceToken(token.value, expectedUid)');
    expect(install).toContain('await registrationReady');
    expect(install.indexOf('await saveDeviceToken(token.value, expectedUid)')).toBeLessThan(install.indexOf('settleSuccess()'));
    expect(install.indexOf('await registrationReady')).toBeLessThan(install.indexOf('initialized = true'));
    expect(init.indexOf('await installListeners(expectedUid, onNavigate)')).toBeLessThan(init.indexOf('setPushNotificationPreference(expectedUid, true)'));
  });

  it('não fica eternamente habilitado sem token e limita o handshake nativo', () => {
    const service = read('src/services/pushNotificationService.ts');
    expect(service).toContain('REGISTRATION_TIMEOUT_MS = 15_000');
    expect(service).toContain("new Error('O aparelho não retornou um token de notificações a tempo.')");
    expect(service).toContain('localStorage.getItem(DEVICE_TOKEN_KEY)');
    expect(service).toContain('owner === expectedUid');
    expect(service).toContain('initialized = false');
  });

  it('repete uma vez o claim do token em falha transitória do backend', () => {
    const service = read('src/services/pushNotificationService.ts');
    expect(service).toContain('TOKEN_CLAIM_MAX_ATTEMPTS = 2');
    expect(service).toContain('attempt <= TOKEN_CLAIM_MAX_ATTEMPTS');
    expect(service).toContain('currentUser.getIdToken(attempt > 1)');
    expect(service).toContain('response.status < 500 || attempt === TOKEN_CLAIM_MAX_ATTEMPTS');
    expect(service).toContain('await delay(450)');
  });

  it('cria canal Android visível e mantém presentation options para foreground', () => {
    const service = read('src/services/pushNotificationService.ts');
    const config = read('capacitor.config.ts');
    expect(service).toContain("GENERAL_NOTIFICATION_CHANNEL_ID = 'invictus_general'");
    expect(service).toContain('PushNotifications.createChannel');
    expect(service).toContain('importance: 4');
    expect(config).toContain('"alert", "banner", "list"');
  });

  it('transfere o token antigo antes de invalidá-lo na troca de conta', () => {
    const service = read('src/services/pushNotificationService.ts');
    const start = service.indexOf('export async function reconcilePushNotificationsForAuthChange');
    const end = service.indexOf('/**\n * Desativa', start);
    const reconciliation = service.slice(start, end);
    expect(reconciliation.indexOf('await saveDeviceToken(existingToken, nextUid)')).toBeGreaterThan(-1);
    expect(reconciliation.indexOf('await saveDeviceToken(existingToken, nextUid)')).toBeLessThan(reconciliation.lastIndexOf('await unregisterLocalPush()'));
  });

  it('abre toque em push mesmo sem callback, mas somente para rota interna segura', () => {
    const service = read('src/services/pushNotificationService.ts');
    expect(service).toContain('safeInternalActionPath');
    expect(service).toContain("path.startsWith('//')");
    expect(service).toContain("path.includes('\\\\')");
    expect(service).toContain('else window.location.assign(actionPath)');
  });
});
