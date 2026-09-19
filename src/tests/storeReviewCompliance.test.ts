import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('store review compliance gates', () => {
  test('iOS offers Sign in with Apple as an equivalent to Google, so Google no longer needs to be hidden there', () => {
    const auth = read('src/components/AuthExperience.tsx');
    // A guideline 4.8 exige paridade, não que o Google fique escondido -- com
    // o Apple implementado, nenhum dos dois botões é condicionado à
    // plataforma (ver src/tests/appleSignIn.test.ts para a cobertura do
    // fluxo nativo em si).
    expect(auth).not.toContain('showGoogleLogin');
    expect(auth).toContain('CONTINUAR COM A APPLE');
    expect(auth).toContain('CONTINUAR COM GOOGLE');
    expect(auth).toContain('onApple');
    expect(auth).toContain('onGoogle');
  });

  test('signup enforces the declared 18+ audience and explains identity collection', () => {
    const auth = read('src/components/AuthExperience.tsx');
    expect(auth).toContain('function isAdultBirthDate');
    expect(auth).toContain('return age >= 18');
    expect(auth).toContain('O Invictus é destinado a pessoas com 18 anos ou mais.');
    expect(auth).toContain('reduz duplicidade/fraude nos recursos competitivos');
  });

  test('account deletion can be initiated in app and has a public deletion resource', () => {
    const profile = read('src/pages/ProfileNew.tsx');
    const endpoint = read('api/account-deletion.ts');
    const publicPage = read('public/account-deletion.html');

    expect(profile).toContain('Excluir minha conta');
    expect(profile).toContain("fetch('/api/account-deletion'");
    expect(endpoint).toContain("source: 'in_app'");
    expect(endpoint).toContain("deletionStatus: 'requested'");
    expect(endpoint).toContain('em até 30 dias');
    expect(publicPage).toContain('Exclusão de conta e dados');
    expect(publicPage).toContain('até 30 dias');
    expect(publicPage).toContain('contato@invictusperformance.app.br');
  });

  test('store-facing legal files do not advertise the retired paid Elite/PIX model', () => {
    const terms = read('public/legal/terms_of_use.md');
    const privacy = read('public/legal/privacy_policy.md');
    const elite = read('public/legal/elite_rules.md');

    expect(terms).toContain('não podem ser sacados via PIX');
    expect(privacy).toContain('não os usamos para publicidade comportamental');
    expect(privacy).toContain('account-deletion.html');
    expect(elite).toContain('RECURSO NÃO ATIVO NA VERSÃO ATUAL');
    expect(elite).not.toContain('Mercado Pago');
  });

  test('native privacy declarations remain present for Apple and Health Connect', () => {
    const plist = read('ios/App/App/Info.plist');
    const entitlements = read('ios/App/App/App.entitlements');
    const manifest = read('android/app/src/main/AndroidManifest.xml');

    expect(plist).toContain('NSHealthShareUsageDescription');
    expect(plist).toContain('NSLocationWhenInUseUsageDescription');
    expect(plist).toContain('NSCameraUsageDescription');
    expect(entitlements).toContain('com.apple.developer.healthkit');
    expect(manifest).toContain('android.permission.health.READ_HEART_RATE');
    expect(manifest).toContain('androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE');
  });
});
