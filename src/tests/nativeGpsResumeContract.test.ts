import fs from 'node:fs';
import path from 'node:path';

describe('Gate 1 — contrato nativo de retomada GPS', () => {
  const root = process.cwd();

  test('iOS expõe resumeLocationTracking sem limpar trackedLocations', () => {
    const source = fs.readFileSync(path.join(root, 'ios/App/App/InvictusActivityPlugin.swift'), 'utf8');
    expect(source).toContain('CAPPluginMethod(name: "resumeLocationTracking"');
    expect(source).toContain('@objc func resumeLocationTracking');
    expect(source).toContain('beginLocationTracking(call, clearExisting: false)');
    expect(source).toContain('beginLocationTracking(call, clearExisting: true)');
  });

  test('Android expõe resumeLocationTracking preservando SharedPreferences restaurado', () => {
    const source = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/desafiosemdesculpa/app/InvictusActivityPlugin.java'), 'utf8');
    expect(source).toContain('public void resumeLocationTracking(PluginCall call)');
    expect(source).toContain('beginLocationTracking(call, false)');
    expect(source).toContain('beginLocationTracking(call, true)');
    expect(source).toContain('restoreLocations();');
  });

  test('ponte TypeScript separa start limpo de resume preservando buffer', () => {
    const source = fs.readFileSync(path.join(root, 'src/services/nativeBackgroundLocationService.ts'), 'utf8');
    expect(source).toContain('resumeLocationTracking(): Promise<void>');
    expect(source).toContain('await NativeActivityLocation.startLocationTracking()');
    expect(source).toContain('await NativeActivityLocation.resumeLocationTracking()');
  });
});
