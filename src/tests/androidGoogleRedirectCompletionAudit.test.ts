import fs from 'node:fs';
import path from 'node:path';

const firebaseSource = fs.readFileSync(
  path.join(process.cwd(), 'src/firebase.ts'),
  'utf8',
);

describe('Gate 1 — Google auth completion by native platform', () => {
  test('all Capacitor native platforms skip Firebase Web getRedirectResult', () => {
    expect(firebaseSource).toContain('if (Capacitor.isNativePlatform()) {');
    expect(firebaseSource).toContain('getRedirectResult ignorado no ${Capacitor.getPlatform()} nativo');
    expect(firebaseSource).toContain('return firebaseGetRedirectResult(authInstance);');
    expect(firebaseSource).not.toContain("Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'");
  });

  test('iOS and Android native Google login use the native bridge while web keeps Firebase redirect', () => {
    expect(firebaseSource).toContain('Capacitor.isNativePlatform() && provider instanceof GoogleAuthProvider');
    expect(firebaseSource).toContain('await nativeGoogleAuth.signIn();');
    expect(firebaseSource).toContain('await signInWithCredential(authInstance, credential);');
    expect(firebaseSource).toContain('await firebaseSignInWithRedirect(authInstance, provider);');
  });
});
