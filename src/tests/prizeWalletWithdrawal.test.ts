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
    expect(financial).toContain('return identity.emailVerified && identity.phoneVerified;');
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
    expect(wallet).not.toContain('CPF/Receita');
    expect(wallet).not.toContain('e-mail, telefone e CPF');
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

  it('mantém CPF/Serpro fora do gate de saque enquanto a integração oficial não está disponível', () => {
    const financial = read('api/_handlers/financial.ts');
    const wallet = read('src/pages/PrizeWallet.tsx');
    const identityPage = read('src/pages/IdentityVerification.tsx');

    expect(financial).toContain('return identity.emailVerified && identity.phoneVerified;');
    expect(financial).toContain('CPF/Serpro fica fora do gate temporariamente');
    expect(wallet).not.toContain('CPF/Receita');
    expect(wallet).not.toContain('e-mail, telefone e CPF');
    expect(identityPage).not.toContain('CONFIRMAR NA RECEITA FEDERAL');
    expect(identityPage).not.toContain('verifyCpf');
    expect(identityPage).toContain('identity?.email.verified && identity?.phone.verified');
  });

  it('mantém a carteira disponível para sessão válida sem perfil e exige apenas e-mail e telefone', () => {
    const financial = read('api/_handlers/financial.ts');
    expect(financial).toContain('const profile = profileSnap.exists ? profileSnap.data() || {} : {}');
    expect(financial).toContain('emailVerified: authUser.emailVerified === true');
    expect(financial).toContain('phoneVerified: Boolean(phone)');
    expect(financial).toContain('return identity.emailVerified && identity.phoneVerified;');
  });

  it('usa o uid autenticado e nunca aceita userId do cliente', () => {
    const financial = read('api/_handlers/financial.ts');
    expect(financial).toContain('userId: auth.uid');
    expect(financial).not.toContain('req.body?.userId');
  });

  it('expõe a tela de identidade apenas com e-mail e telefone para o saque', () => {
    const app = read('src/App.tsx');
    const identityPage = read('src/pages/IdentityVerification.tsx');
    const identityApi = read('api/identity-verification-guarded.ts');

    expect(app).toContain("import('./pages/IdentityVerification')");
    expect(app).toContain('<Route path="/profile/identity" element={<IdentityVerification />} />');
    expect(identityPage).toContain('CONFIRMAR TELEFONE');
    expect(identityPage).toContain("action: 'send-verification-email'");
    expect(identityPage).not.toContain('CONFIRMAR NA RECEITA FEDERAL');
    expect(identityPage).not.toContain('Fingerprint');
    expect(identityPage).toContain("navigate('/profile/wallet')");
    expect(identityApi).toContain("action === 'sync-phone'");
    expect(identityApi).toContain("action === 'send-verification-email'");
  });

  it('envia o e-mail de verificação customizado pela Zoho em vez do template padrão do Firebase', () => {
    const identityPage = read('src/pages/IdentityVerification.tsx');
    const identityApi = read('api/identity-verification-guarded.ts');
    const mailer = read('api/_lib/zoho-mailer-service.ts');

    expect(identityPage).not.toContain('sendEmailVerification');
    expect(identityApi).toContain('generateEmailVerificationLink');
    expect(identityApi).toContain('buildVerificationEmail');
    expect(identityApi).toContain('sendInvictusEmail');
    expect(mailer).toContain('ZOHO_SMTP_HOST');
    expect(mailer).toContain('ZOHO_SMTP_PORT');
    expect(mailer).toContain('ZOHO_SMTP_USER');
    expect(mailer).toContain('ZOHO_SMTP_PASSWORD');
    expect(mailer).toContain('nodemailer');
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
