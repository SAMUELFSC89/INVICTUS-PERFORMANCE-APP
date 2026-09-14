import fs from 'node:fs';
import path from 'node:path';

const firebaseSource = fs.readFileSync(
  path.join(process.cwd(), 'src/firebase.ts'),
  'utf8',
);

describe('Gate 1 — Google redirect completion by native platform', () => {
  test('only iOS native skips Firebase getRedirectResult', () => {
    expect(firebaseSource).toContain("Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'");
    expect(firebaseSource).toContain("marcarDiag('getRedirectResult ignorado no iOS nativo')");
    expect(firebaseSource).toContain('return firebaseGetRedirectResult(authInstance);');
    expect(firebaseSource).not.toContain("if (Capacitor.isNativePlatform()) {\n    marcarDiag('getRedirectResult ignorado no app nativo')");
  });

  test('Android still starts the Firebase redirect flow that requires that result consumer', () => {
    expect(firebaseSource).toContain('await firebaseSignInWithRedirect(authInstance, provider);');
    expect(firebaseSource).toContain('// Web e Android continuam exatamente no fluxo Firebase existente.');
  });
});
