import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Sign in with Apple (Guideline 4.8)', () => {
  test('firebase.ts usa a API nativa da Apple no iOS, não um OAuth em WebView', () => {
    const firebase = read('src/firebase.ts');

    expect(firebase).toContain("import { SignInWithApple } from '@capacitor-community/apple-sign-in'");
    expect(firebase).toContain('async function nativeAppleAuth(');
    expect(firebase).toContain('SignInWithApple.authorize(');
    // O gate precisa checar plataforma iOS + provider apple.com, igual ao
    // gate do Google checa GoogleAuthProvider -- nenhum dos dois deve vazar
    // para o outro provider.
    expect(firebase).toContain("Capacitor.getPlatform() === 'ios'");
    expect(firebase).toContain("provider.providerId === 'apple.com'");
    expect(firebase).toContain('await nativeAppleAuth(authInstance)');
  });

  test('o nonce é gerado localmente e verificado pelo Firebase (rawNonce + hash SHA-256)', () => {
    const firebase = read('src/firebase.ts');

    expect(firebase).toContain('function generateAppleNonce(');
    expect(firebase).toContain('crypto.subtle.digest(\'SHA-256\'');
    expect(firebase).toContain('provider.credential({ idToken: identityToken, rawNonce })');
  });

  test('AuthGuard tem um fluxo de login Apple espelhando o do Google (mesmo tratamento de erro/fallback)', () => {
    const guard = read('src/components/AuthGuard.tsx');

    expect(guard).toContain('const handleAppleLogin = async ()');
    expect(guard).toContain("new OAuthProvider('apple.com')");
    expect(guard).toContain('onApple={handleAppleLogin}');
    // Mesmos códigos de erro tratados do fluxo Google (popup bloqueado,
    // fechado pelo usuário, fallback para redirect).
    expect(guard).toContain("auth/popup-blocked");
    expect(guard).toContain("auth/popup-closed-by-user");
  });

  test('dependência do plugin nativo está declarada e o entitlement do iOS está habilitado', () => {
    const pkg = read('package.json');
    const entitlements = read('ios/App/App/App.entitlements');

    expect(pkg).toContain('"@capacitor-community/apple-sign-in"');
    expect(entitlements).toContain('com.apple.developer.applesignin');
  });
});
