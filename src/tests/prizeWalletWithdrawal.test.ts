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

  it('exige prova de presença antes de criar um saque', () => {
    const financial = read('api/_handlers/financial.ts');
    const presence = read('api/_handlers/validate-presence.ts');

    expect(financial).toContain("actionType: 'withdrawal'");
    expect(financial).toContain('criarPresenceCheck({');
    expect(financial).not.toContain('WithdrawalEngine.requestWithdrawal({');
    expect(presence).toContain("if (actionType === 'withdrawal' && finalDecision === 'approved')");
    expect(presence).toContain('WithdrawalEngine.requestWithdrawal({ ...workoutPayload, userId })');
  });

  it('usa o uid autenticado e nunca aceita userId do cliente', () => {
    const financial = read('api/_handlers/financial.ts');
    expect(financial).toContain('userId: auth.uid');
    expect(financial).not.toContain('req.body?.userId');
  });

  it('restaura a rota e a tela de carteira de prêmios', () => {
    const app = read('src/App.tsx');
    const profile = read('src/pages/ProfileNew.tsx');
    const wallet = read('src/pages/PrizeWallet.tsx');

    expect(app).toContain("import('./pages/PrizeWallet')");
    expect(app).toContain('<Route path="/profile/wallet" element={<PrizeWallet />} />');
    expect(app).toContain('<Route path="/wallet" element={<Navigate to="/profile/wallet" replace />} />');
    expect(profile).toContain("navigate('/profile/wallet')");
    expect(profile).toContain('Prêmios e saques');
    expect(wallet).toContain('<VerifiedPresenceModal');
    expect(wallet).toContain("authenticatedFetch('/api/financial'");
    expect(wallet).toContain('INVICTUS COINS NÃO SÃO DINHEIRO');
  });
});
