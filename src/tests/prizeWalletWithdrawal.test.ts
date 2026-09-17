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

  it('remove selfie do novo saque e exige identidade verificada + OTP por SMS', () => {
    const financial = read('api/_handlers/financial.ts');
    const wallet = read('src/pages/PrizeWallet.tsx');

    expect(financial).toContain('emailVerified: identity.emailVerified');
    expect(financial).toContain('phoneVerified: identity.phoneVerified');
    expect(financial).toContain('cpfVerified: identity.cpfVerified');
    expect(financial).toContain("action === 'request-withdrawal'");
    expect(financial).toContain('startPhoneVerification(identity.phone)');
    expect(financial).toContain("action === 'confirm-withdrawal-otp'");
    expect(financial).toContain('checkPhoneVerification(identity.phone, code)');
    expect(financial).toContain('WithdrawalEngine.requestWithdrawal({');
    expect(financial).not.toContain("actionType: 'withdrawal'");
    expect(financial).not.toContain('criarPresenceCheck');
    expect(wallet).not.toContain('VerifiedPresenceModal');
    expect(wallet).toContain('RECEBER CÓDIGO POR SMS');
    expect(wallet).toContain('Não usamos selfie para liberar PIX.');
  });

  it('usa o uid autenticado e nunca aceita userId do cliente', () => {
    const financial = read('api/_handlers/financial.ts');
    expect(financial).toContain('userId: auth.uid');
    expect(financial).not.toContain('req.body?.userId');
  });

  it('expõe a tela de identidade verificada e o fluxo oficial de CPF/telefone', () => {
    const app = read('src/App.tsx');
    const identityPage = read('src/pages/IdentityVerification.tsx');
    const identityApi = read('api/identity-verification-guarded.ts');
    const identityService = read('api/_lib/identity-verification-service.ts');

    expect(app).toContain("import('./pages/IdentityVerification')");
    expect(app).toContain('<Route path="/profile/identity" element={<IdentityVerification />} />');
    expect(identityPage).toContain('CONFIRMAR NA RECEITA FEDERAL');
    expect(identityPage).toContain('ENVIAR SMS INVICTUS');
    expect(identityPage).toContain('sendEmailVerification');
    expect(identityApi).toContain("action === 'verify-cpf'");
    expect(identityApi).toContain("action === 'confirm-phone'");
    expect(identityService).toContain('verifyCpfWithReceita');
    expect(identityService).toContain('CustomFriendlyName');
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
