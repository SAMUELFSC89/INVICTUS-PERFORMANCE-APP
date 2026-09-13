import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Gate 1 — Android foreground service / permissões', () => {
  test('POST_NOTIFICATIONS não bloqueia a continuidade do GPS', () => {
    const source = read('src/services/activityNotificationService.ts');

    expect(source).toContain('ForegroundService.startForegroundService');
    expect(source).toContain('serviceType: ServiceType.Location');
    expect(source).toContain('session.requiresGpsDistance === true');
    expect(source).not.toContain('ForegroundService.checkPermissions');
    expect(source).not.toContain('ForegroundService.requestPermissions');
  });

  test('FGS location não é usado como timer genérico e reconcilia pausa/retomada', () => {
    const source = read('src/services/activityNotificationService.ts');

    expect(source).toContain('shouldUseLocationForegroundService(session)');
    expect(source).toContain('if (!shouldUseLocationForegroundService(session))');
    expect(source).toContain('await this.stop()');
    expect(source).toContain('if (!isRunning)');
    expect(source).toContain('await this.start(session, elapsedSeconds, distanceKm)');
  });

  test('manifest mantém somente permissões necessárias ao FGS de localização', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');

    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE');
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE_LOCATION');
    expect(manifest).toContain('android:foregroundServiceType="location"');
    expect(manifest).toContain('android.permission.POST_NOTIFICATIONS');
    expect(manifest).not.toContain('android.permission.SYSTEM_ALERT_WINDOW');
  });

  test('cold restore volta a sincronizar o FGS antes de retomar a sessão', () => {
    const source = read('src/services/sessionContinuityService.ts');

    expect(source).toContain("import { activityNotificationService } from './activityNotificationService'");
    expect(source).toContain('await activityNotificationService.sync(session, elapsedSecondsForSession(session))');
    expect(source).toContain('await syncAndroidForegroundService(current)');
  });
});
