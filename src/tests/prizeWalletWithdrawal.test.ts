import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('carteira de prêmios e saque PIX', () => {
  it('expõe apenas saldo sacável de premiações e mantém Coins fora do saque', () => {
    const financial = read('api/_handlers/financial.ts');
    const legacyCoinRedeem = read('api/_handlers/wallet-redeem.ts');

    expect(financial).toContain('WalletEngine.getWallet(auth.uid)');
    expect(financial).toContain("cashSource: 'official_prizes_only'");
    expect(financial).toContain('coinsWithdrawable: false');
    expect(financial).toContain('wallet.redeemableBalance');
    expect(financial).not.toContain('RewardCoinEngine');
    expect(legacyCoinRedeem).toContain('PIX_REDEMPTION_DISABLED');
  });

  it('remove selfie/Twilio do saque e exige reautenticação Firebase por telefone', () => {
    const financial = read('api/_handlers/financial.ts');
    const wallet = read('src/pages/PrizeWallet.tsx');
    const identityService = read('api/_lib/identity-verification-service.ts');

    expect(financial).toContain('emailVerified: identity.emailVerified');
    expect(financial).toContain('phoneVerified: identity.phoneVerified');
    expect(financial).toContain('cpfVerified: identity.cpfVerified');
    expect(financial).toContain("action !== 'request-withdrawal'");
    expect(financial).toContain('requireFreshFirebasePhoneReauth');
    expect(financial).toContain("provider === 'phone'");
    expect(financial).toContain('PHONE_REAUTH_MAX_AGE_SECONDS = 5 * 60');
    expect(financial).toContain('WithdrawalEngine.requestWithdrawal({');
    expect(financial).not.toContain('pending_withdrawal_otps');
    expect(financial).not.toContain('checkPhoneVerification');
    expect(identityService).not.toContain('TWILIO_');
    expect(identityService).not.toContain('verify.twilio.com');
    expect(wallet).not.toContain('VerifiedPresenceModal');
    expect(wallet).toContain('reauthenticateWithPhoneNumber');
    expect(wallet).toContain('RECEBER CÓDIGO POR SMS');
    expect(wallet).toContain('Não usamos selfie para liberar PIX.');
  });

  it('usa o telefone do Firebase Auth como fonte de verdade', () => {
    const financial = read('api/_handlers/financial.ts');
    const identityApi = read('api/identity-verification-guarded.ts');
    const identityPage = read('src/pages/IdentityVerification.tsx');

    expect(financial).toContain('authUser.phoneNumber');
    expect(financial).toContain('decoded.phone_number');
    expect(identityApi).toContain('account.authUser.phoneNumber');
    expect(identityApi).toContain("phoneVerificationProvider: 'firebase_auth_phone'");
    expect(identityApi).toContain("action === 'sync-phone'");
    expect(identityApi).not.toContain("action === 'start-phone'");
    expect(identityApi).not.toContain("action === 'confirm-phone'");
    expect(identityPage).toContain('PhoneAuthProvider');
    expect(identityPage).toContain('RecaptchaVerifier');
    expect(identityPage).toContain('linkWithCredential');
    expect(identityPage).toContain("action: 'sync-phone'");
  });

  it('só considera CPF oficialmente verificado quando Receita retorna REGULAR', () => {
    const financial = read('api/_handlers/financial.ts');
    const identityApi = read('api/identity-verification-guarded.ts');
    const identityService = read('api/_lib/identity-verification-service.ts');

    expect(identityApi).toContain("receitaStatus === 'REGULAR'");
    expect(identityApi).toContain("return normalized === '0' ? 'REGULAR' : normalized");
    expect(identityApi).toContain('result.regular === true');
    expect(identityApi).toContain('cpfVerified: false');
    expect(identityService).toContain("status === 'REGULAR' || status === '0'");
    expect(financial).toContain('profile.cpfReceitaRegular === true');
    expect(financial).toContain("String(profile.cpfReceitaStatus || '').trim().toUpperCase() === 'REGULAR'");
  });

  it('mantém a carteira disponível para sessão válida sem perfil e bloqueia CPF financeiro', () => {
    const financial = read('api/_handlers/financial.ts');
    expect(financial).toContain('const profile = profileSnap.exists ? profileSnap.data() || {} : {}');
    expect(financial).toContain('emailVerified: authUser.emailVerified === true');
    expect(financial).toContain('phoneVerified: Boolean(phone)');
    expect(financial).toContain('cpfVerified: profileSnap.exists');
  });

  it('usa o uid autenticado e nunca aceita userId do cliente', () => {
    const financial = read('api/_handlers/financial.ts');
    expect(financial).toContain('userId: auth.uid');
    expect(financial).not.toContain('req.body?.userId');
  });

  it('expõe a tela de identidade verificada com Firebase + Serpro', () => {
    const app = read('src/App.tsx');
    const identityPage = read('src/pages/IdentityVerification.tsx');
    const identityApi = read('api/identity-verification-guarded.ts');
    const identityService = read('api/_lib/identity-verification-service.ts');

    expect(app).toContain("import('./pages/IdentityVerification')");
    expect(app).toContain('<Route path="/profile/identity" element={<IdentityVerification />} />');
    expect(identityPage).toContain('CONFIRMAR NA RECEITA FEDERAL');
    expect(identityPage).toContain('ENVIAR SMS PELO FIREBASE');
    expect(identityPage).toContain('sendEmailVerification');
    expect(identityApi).toContain("action === 'verify-cpf'");
    expect(identityApi).toContain("action === 'sync-phone'");
    expect(identityService).toContain('verifyCpfWithReceita');
    expect(identityService).not.toContain('CustomFriendlyName');
  });

  it('mantém a rota e a tela da carteira de prêmios', () => {
    const app = read('src/App.tsx');
    const profile = read('src/pages/ProfileNew.tsx');
    const wallet = read('src/pages/PrizeWallet.tsx');

    expect(app).toContain("import('./pages/PrizeWallet')");
    expect(app).toContain('<Route path="/profile/wallet" element={<PrizeWallet />} />');
    expect(app).toContain('<Route path="/wallet" element={<Navigate to="/profile/wallet" replace />} />');
    expect(profile).toContain("navigate('/profile/wallet')");
    expect(profile).toContain('Prêmios e saques');
    expect(wallet).toContain("authenticatedFetch('/api/financial'");
    expect(wallet).toContain('INVICTUS COINS NÃO SÃO DINHEIRO');
  });
});
