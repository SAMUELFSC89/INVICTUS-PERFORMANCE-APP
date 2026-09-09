import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('profile photo flow', () => {
  test('new profile exposes change and remove actions and compresses before upload', () => {
    const profile = read('src/pages/ProfileNew.tsx');
    expect(profile).toContain('await compressImage(file, 800, 0.82)');
    expect(profile).toContain('await userService.removeProfilePhoto()');
    expect(profile).toContain('Trocar foto');
    expect(profile).toContain('Remover foto');
  });

  test('storage objects are versioned and owned old avatars are deleted', () => {
    const service = read('src/services/userService.ts');
    expect(service).toContain('avatar-${Date.now()}.jpg');
    expect(service).toContain('await deleteObject(avatarRef)');
    expect(service).toContain("await updateDoc(userRef, { photoURL: '' })");
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
