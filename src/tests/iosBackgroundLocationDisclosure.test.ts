import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Gate 1 — disclosure de localização em background no iOS', () => {
  test('purpose string explica a coleta durante cardio com tela bloqueada', () => {
    const plist = read('ios/App/App/Info.plist');
    expect(plist).toContain('<key>NSLocationWhenInUseUsageDescription</key>');
    expect(plist).toContain('segundo plano');
    expect(plist).toContain('tela bloqueada');
    expect(plist).toContain('até você pausar ou finalizar o treino');
  });

  test('descrição permanece coerente com o comportamento nativo real', () => {
    const plist = read('ios/App/App/Info.plist');
    const plugin = read('ios/App/App/InvictusActivityPlugin.swift');
    expect(plist).toMatch(/<key>UIBackgroundModes<\/key>[\s\S]*?<string>location<\/string>/);
    expect(plugin).toContain('manager.allowsBackgroundLocationUpdates = true');
    expect(plugin).toContain('manager.startUpdatingLocation()');
    expect(plugin).toContain('stopLocationTracking');
  });
});
