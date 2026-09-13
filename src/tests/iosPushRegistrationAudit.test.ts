import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Gate 1 — registro e apresentação de push no iOS', () => {
  it('encaminha sucesso e erro de registro APNs para o plugin Capacitor', () => {
    const delegate = read('ios/App/App/AppDelegate.swift');
    expect(delegate).toContain('didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data');
    expect(delegate).toContain('.capacitorDidRegisterForRemoteNotifications');
    expect(delegate).toContain('didFailToRegisterForRemoteNotificationsWithError error: Error');
    expect(delegate).toContain('.capacitorDidFailToRegisterForRemoteNotifications');
  });

  it('mantém a capability de push no target do aplicativo', () => {
    const entitlements = read('ios/App/App/App.entitlements');
    expect(entitlements).toContain('<key>aps-environment</key>');
    expect(entitlements).toContain('<string>production</string>');
  });

  it('usa opções modernas de apresentação em foreground', () => {
    const config = read('capacitor.config.ts');
    expect(config).toContain('presentationOptions: ["badge", "sound", "banner", "list"]');
    expect(config).not.toContain('presentationOptions: ["badge", "sound", "alert"]');
  });

  it('não mistura o token APNs do iOS com o token FCM do Android', () => {
    const client = read('src/services/pushNotificationService.ts');
    const server = read('api/_services/notification-service.ts');
    expect(client).toContain("Capacitor.getPlatform() === 'ios' ? 'ios' : 'android'");
    expect(server).toContain("platform === 'ios' ? 'apnsTokens' : 'fcmTokens'");
    expect(server).toContain('this.sendApnsPush');
    expect(server).toContain('this.sendFcmPush');
  });
});
