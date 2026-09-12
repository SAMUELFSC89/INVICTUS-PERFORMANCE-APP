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

  it('reivindica ou invalida token quando a identidade Firebase muda', () => {
    const service = read('src/services/pushNotificationService.ts');
    const context = read('src/UserContext.tsx');
    expect(service).toContain('initializedUserId');
    expect(service).toContain('reconcilePushNotificationsForAuthChange');
    expect(service).toContain('PushNotifications.unregister()');
    expect(service).toContain("DEVICE_TOKEN_OWNER_KEY");
    expect(service).toContain("'claim-device-token'");
    expect(context).toContain('reconcilePushNotificationsForAuthChange(firebaseUser?.uid || null)');
  });

  it('não solicita permissão de push automaticamente só por trocar de conta', () => {
    const service = read('src/services/pushNotificationService.ts');
    const reconciliation = service.slice(service.indexOf('export async function reconcilePushNotificationsForAuthChange'));
    expect(reconciliation).toContain('PushNotifications.checkPermissions()');
    expect(reconciliation).not.toContain('PushNotifications.requestPermissions()');
  });
});
