import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Gate 1 — HealthKit read-only disclosure', () => {
  test('iOS declara as finalidades exigidas pela Apple sem afirmar escrita que o app não realiza', () => {
    const plist = read('ios/App/App/Info.plist');
    expect(plist).toContain('<key>NSHealthShareUsageDescription</key>');
    expect(plist).toContain('<key>NSHealthUpdateUsageDescription</key>');
    expect(plist).toContain('O INVICTUS não grava dados no app Saúde.');
    expect(plist).toContain('o INVICTUS solicita apenas acesso de leitura');
  });

  test('provider de métricas não solicita autorização de escrita no HealthKit', () => {
    const provider = read('src/services/wearables/HealthVitalsProvider.ts');
    expect(provider).toContain('requestAuthorization');
    expect(provider).not.toMatch(/write\s*:/);
  });

  test('Android também continua removendo permissões de escrita do Health Connect', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android.permission.health.WRITE_STEPS');
    expect(manifest).toContain('tools:node="remove"');
  });
});
