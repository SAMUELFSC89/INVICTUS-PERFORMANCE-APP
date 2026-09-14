import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('Gate 1 — release production security contracts', () => {
  test('rotas administrativas sensíveis usam autoridade ativa revogável', () => {
    for (const file of [
      'api/_handlers/performance-dashboard.ts',
      'api/_handlers/health.ts',
      'api/_handlers/env-check.ts',
      'api/_handlers/migrate-reset.ts',
      'api/_handlers/migrate-legacy-private-challenges.ts',
    ]) {
      const source = read(file);
      expect(source).toContain("hasActiveAdminAuthority");
      expect(source).not.toContain("data()?.role === 'admin'");
      expect(source).not.toContain("userData?.role !== 'admin'");
    }
  });

  test('biometria financeira falha fechada em schema incompleto e ausência de referência', () => {
    const source = read('api/_handlers/validate-presence.ts');
    expect(source).toContain('function parseBiometricResult');
    expect(source).toContain("typeof parsed.livenessMatched !== 'boolean'");
    expect(source).toContain("typeof parsed.identityMatched !== 'boolean'");
    expect(source).toContain("const presenceConfidence = biometrics?.presenceConfidence ?? 0");
    expect(source).toContain("let finalDecision: 'approved' | 'pending' | 'rejected' = 'pending'");
    expect(source).toContain('if (schemaValid && reference.base64)');
    expect(source).not.toContain('biometrics.livenessMatched !== false');
    expect(source).not.toContain('biometrics.identityMatched !== false');
    expect(source).not.toContain('presenceConfidence: 70');
  });

  test('foto de referência externa é restrita ao Storage confiável e saque preserva o UID autenticado', () => {
    const source = read('api/_handlers/validate-presence.ts');
    expect(source).toContain("'firebasestorage.googleapis.com'");
    expect(source).toContain("'storage.googleapis.com'");
    expect(source).toContain("parsed.protocol !== 'https:'");
    expect(source).toContain('MAX_REFERENCE_IMAGE_BYTES');
    expect(source).toContain('WithdrawalEngine.requestWithdrawal({ ...workoutPayload, userId })');
    expect(source).not.toContain('WithdrawalEngine.requestWithdrawal({ userId, ...workoutPayload })');
  });

  test('buffers GPS nativos pertencem explicitamente a uma sessão', () => {
    const android = read('android/app/src/main/java/com/desafiosemdesculpa/app/InvictusActivityPlugin.java');
    const ios = read('ios/App/App/InvictusActivityPlugin.swift');
    const bridge = read('src/services/nativeBackgroundLocationService.ts');
    const continuity = read('src/services/sessionContinuityService.ts');

    expect(android).toContain('SESSION_ID_KEY = "background_session_id"');
    expect(ios).toContain('trackedSessionIdKey = "invictus.background.sessionId"');
    expect(bridge).toContain('readBufferedSnapshot(): Promise<NativeBufferedLocations>');
    expect(continuity).toContain('bufferedBeforeRestore.sessionId === restored.id');
  });
});
