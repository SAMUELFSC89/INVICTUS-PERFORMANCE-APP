import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Android native Google authentication', () => {
  it('does not use Firebase Web redirect inside a native WebView', () => {
    const firebase = read('src/firebase.ts');
    expect(firebase).toContain("Capacitor.isNativePlatform() && provider instanceof GoogleAuthProvider");
    expect(firebase).toContain('nativeGoogleAuth.signIn()');
    expect(firebase).toContain('signInWithCredential(authInstance, credential)');
    expect(firebase).toContain('if (Capacitor.isNativePlatform())');
    expect(firebase).toContain('getRedirectResult ignorado');
  });

  it('registers the Android bridge and requests a Google ID token', () => {
    const activity = read('android/app/src/main/java/com/desafiosemdesculpa/app/MainActivity.java');
    const plugin = read('android/app/src/main/java/com/desafiosemdesculpa/app/InvictusGoogleAuthPlugin.java');
    const gradle = read('android/app/build.gradle');

    expect(activity).toContain('registerPlugin(InvictusGoogleAuthPlugin.class)');
    expect(plugin).toContain('@CapacitorPlugin(name = "InvictusGoogleAuth")');
    expect(plugin).toContain('.requestIdToken(serverClientId)');
    expect(plugin).toContain('getSignInIntent()');
    expect(plugin).toContain('GoogleSignIn.getSignedInAccountFromIntent(data)');
    expect(plugin).toContain('response.put("idToken", idToken)');
    expect(gradle).toContain('com.google.android.gms:play-services-auth:21.2.0');
  });

  it('surfaces a configuration-specific message if the Android OAuth signature is missing', () => {
    const plugin = read('android/app/src/main/java/com/desafiosemdesculpa/app/InvictusGoogleAuthPlugin.java');
    expect(plugin).toContain('Registre o SHA-1/SHA-256 do APK no Firebase');
    expect(plugin).toContain('status == 10');
  });
});
