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

  it('mantém a preferência de notificações separada por conta', () => {
    const service = read('src/services/pushNotificationService.ts');
    expect(service).toContain('notifications-enabled:${uid}');
    expect(service).toContain('pushNotificationsEnabledForUser');
    expect(service).toContain('setPushNotificationPreference(expectedUid, true)');
    expect(service).toContain('setPushNotificationPreference(currentUser.uid, false)');
    expect(service).toContain('const enabledForAccount = pushNotificationsEnabledForUser(nextUid)');
  });

  it('transfere o token antigo antes de invalidá-lo na troca de conta', () => {
    const service = read('src/services/pushNotificationService.ts');
    const start = service.indexOf('export async function reconcilePushNotificationsForAuthChange');
    const end = service.indexOf('/**\n * Desativa', start);
    const reconciliation = service.slice(start, end);
    expect(reconciliation.indexOf('await saveDeviceToken(existingToken, nextUid)')).toBeGreaterThan(-1);
    expect(reconciliation.indexOf('await saveDeviceToken(existingToken, nextUid)')).toBeLessThan(reconciliation.lastIndexOf('await unregisterLocalPush()'));
  });

  it('não solicita permissão de push automaticamente só por trocar de conta', () => {
    const service = read('src/services/pushNotificationService.ts');
    const start = service.indexOf('export async function reconcilePushNotificationsForAuthChange');
    const end = service.indexOf('/**\n * Desativa', start);
    const reconciliation = service.slice(start, end);
    expect(reconciliation).toContain('PushNotifications.checkPermissions()');
    expect(reconciliation).not.toContain('PushNotifications.requestPermissions()');
  });

  it('abre toque em push mesmo sem callback, mas somente para rota interna segura', () => {
    const service = read('src/services/pushNotificationService.ts');
    expect(service).toContain('safeInternalActionPath');
    expect(service).toContain("path.startsWith('//')");
    expect(service).toContain("path.includes('\\\\')");
    expect(service).toContain('else window.location.assign(actionPath)');
  });
});
