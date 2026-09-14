import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Gate 1 — captura de vídeo do Power Lift no iOS', () => {
  test('declara câmera e microfone para o fluxo de captura de vídeo', () => {
    const powerLift = read('src/pages/PowerLift.tsx');
    const info = read('ios/App/App/Info.plist');

    expect(powerLift).toContain('accept="video/*"');
    expect(powerLift).toContain('capture="environment"');
    expect(info).toContain('<key>NSCameraUsageDescription</key>');
    expect(info).toContain('<key>NSMicrophoneUsageDescription</key>');
    expect(info).toContain('vídeos de homologação do Power Lift');
  });

  test('selfie de presença continua explicitamente sem áudio', () => {
    const presence = read('src/components/VerifiedPresenceModal.tsx');
    expect(presence).toContain('audio: false');
  });
});
