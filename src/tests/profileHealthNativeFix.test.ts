import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('profile photo flow', () => {
  test('new profile exposes change/remove actions and never blocks UI on the heavy refresh', () => {
    const profile = read('src/pages/ProfileNew.tsx');
    expect(profile).toContain('await compressImage(file, 800, 0.82)');
    expect(profile).toContain('const uploadedPhotoURL = await userService.updateProfilePhoto(compressed)');
    expect(profile).toContain('setProfilePhotoOverride(uploadedPhotoURL)');
    expect(profile).toContain('refreshProfileInBackground()');
    expect(profile).not.toContain('await refreshUser();');
    expect(profile).toContain('accept="image/*"');
    expect(profile).toContain('await userService.removeProfilePhoto()');
    expect(profile).toContain('Trocar foto');
    expect(profile).toContain('Remover foto');
  });

  test('image preparation and every remote upload stage have finite timeouts', () => {
    const utils = read('src/lib/utils.ts');
    const service = read('src/services/userService.ts');
    expect(utils).toContain('PROCESSING_TIMEOUT_MS = 15_000');
    expect(utils).toContain("new Error('IMAGE_PROCESSING_TIMEOUT')");
    expect(utils).toContain('URL.revokeObjectURL(objectUrl)');
    expect(service).toContain("new Error('UPLOAD_TIMEOUT')");
    expect(service).toContain("withTimeout(getDownloadURL(uploadTask.snapshot.ref), 15_000, 'DOWNLOAD_URL_TIMEOUT')");
    expect(service).toContain("15_000, 'PROFILE_WRITE_TIMEOUT'");
  });

  test('storage objects are versioned and owned old avatars are deleted', () => {
    const service = read('src/services/userService.ts');
    expect(service).toContain('avatar-${Date.now()}.jpg');
    expect(service).toContain('await deleteObject(avatarRef)');
    expect(service).toContain("await updateDoc(userRef, {\n        photoURL: '',");
  });
});

describe('health diagnostics and native PDF', () => {
  test('health refresh is in the header and technical notices are placed after content', () => {
    const health = read('src/pages/Health.tsx');
    const screen = health.slice(health.indexOf('export function Health()'), health.indexOf('export function HealthReportContent'));
    expect(screen).toContain('aria-label="Atualizar dados de saúde"');
    expect(screen.indexOf('<HealthTechnicalStatus')).toBeGreaterThan(screen.indexOf('<HealthGlossary'));
  });

  test('native report export is bridged on both platforms with web-only print fallback', () => {
    const service = read('src/services/healthReportExportService.ts');
    expect(service).toContain("registerPlugin<InvictusPdfPlugin>('InvictusPdf')");
    expect(service).toContain('if (Capacitor.isNativePlatform())');
    expect(service).toContain('window.print()');
    expect(read('android/app/src/main/java/com/desafiosemdesculpa/app/MainActivity.java')).toContain('registerPlugin(InvictusPdfPlugin.class)');
    expect(read('ios/App/App/InvictusBridgeViewController.swift')).toContain('registerPluginInstance(InvictusPdfPlugin())');
    expect(read('ios/App/App.xcodeproj/project.pbxproj')).toContain('InvictusPdfPlugin.swift in Sources');
  });

  test('prints only report content and removes interactive controls from the PDF', () => {
    const report = read('src/pages/HealthReport.tsx');
    const styles = read('src/pages/HealthAdjustments.css');
    expect(report).toContain("document.body.classList.add('health-report-print-context')");
    expect(report).toContain("document.body.classList.remove('health-report-print-context')");
    expect(styles).toContain('body.health-report-print-context > #root');
    expect(styles).toContain('.health-report-shell .health-period-picker');
    expect(styles).toContain('.health-report-shell .health-new-footer');
  });
});
