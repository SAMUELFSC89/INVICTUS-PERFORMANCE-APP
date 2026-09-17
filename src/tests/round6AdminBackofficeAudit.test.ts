import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Round 6 admin backoffice audit guards', () => {
  test('legacy laboratory tools are removed from production admin', () => {
    const app = read('src/App.tsx');
    const dashboard = read('src/pages/AdminDashboard.tsx');

    expect(app).not.toContain("import('./pages/AdminRankingSimulator')");
    expect(app).not.toContain("import('./pages/AdminIGATesteOriginal')");
    expect(app).toContain('<Route path="/admin/ranking-simulator" element={<Navigate to="/admin" replace />} />');
    expect(app).toContain('<Route path="/admin/iga-teste-original" element={<Navigate to="/admin" replace />} />');
    expect(dashboard).not.toContain('CreatorSandbox');
    expect(dashboard).not.toContain('simulate-perf-users');
    expect(existsSync(resolve(process.cwd(), 'src/components/CreatorSandbox.tsx'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'src/pages/AdminRankingSimulator.tsx'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'src/pages/AdminIGATesteOriginal.tsx'))).toBe(false);
  });

  test('admin privilege changes are server-authoritative and active-account aware', () => {
    const dashboard = read('src/pages/AdminDashboard.tsx');
    const handler = read('api/_handlers/admin.ts');
    const guard = read('src/components/AdminGuard.tsx');

    expect(dashboard).toContain("adminRequest('set-user-role'");
    expect(dashboard).not.toContain('updateDoc(');
    expect(handler).toContain("case 'set-user-role'");
    expect(handler).toContain('targetUid === req.userId');
    expect(handler).toContain('isInactiveAccount(targetData)');
    expect(guard).toContain('hasActiveAdminProfile');
    expect(guard).toContain('data.isBlocked === true');
    expect(guard).toContain('data.isBanned === true');
  });

  test('activity admin cannot mutate score or workouts outside the canonical review transaction', () => {
    const workouts = read('src/pages/AdminWorkouts.tsx');
    const queue = read('src/pages/AdminFlaggedActivities.tsx');
    const service = read('api/_services/admin/admin-service.ts');

    expect(workouts).not.toContain('updateDoc(');
    expect(workouts).not.toContain('infractions');
    expect(workouts).not.toContain('isBanned');
    expect(workouts).toContain('/admin/flagged-activities');
    expect(queue).toContain("adminRequest('review-activity'");
    expect(queue).not.toContain("'suspicious'");
    expect(service).not.toContain("['valid', 'invalid', 'suspicious']");
    expect(service).toContain("['valid', 'invalid']");
    expect(service).toContain('reviewWorkoutTransaction');
  });

  test('finance admin has no artificial-credit controls and never manually marks provider payments as paid', () => {
    const payouts = read('src/pages/AdminPayouts.tsx');
    const handler = read('api/_handlers/admin.ts');
    const service = read('api/_services/admin/admin-service.ts');

    expect(payouts).not.toContain('credit-test-balance');
    expect(payouts).not.toContain('CREDITAR R$1');
    expect(payouts).toContain('Enviar PIX via Asaas');
    expect(payouts).toContain("requestAdmin('process-withdrawal-payment'");
    expect(handler).not.toContain("case 'credit-test-balance'");
    expect(service).not.toContain('creditTestBalance');
    expect(service).toContain("const validStatuses = ['pending', 'under_review', 'approved', 'cancelled', 'rejected']");
  });

  test('security admin uses real logs and traces instead of hardcoded readiness simulations', () => {
    const security = read('src/pages/AdminSecurityAudit.tsx');
    const handler = read('api/_handlers/admin.ts');

    expect(security).toContain("adminGet('logs'");
    expect(security).toContain("adminGet('get-trace'");
    expect(security).not.toContain('security-reports');
    expect(security).not.toContain('security-analytics');
    expect(security).not.toContain('override-security-decision');
    expect(security).not.toContain('production-audit');
    expect(handler).not.toContain("case 'production-audit'");
    expect(existsSync(resolve(process.cwd(), 'api/_lib/production-audit-engine.ts'))).toBe(false);
  });

  test('gym audit is wired to backend, bounded against slow upstream calls and repairs all linked profiles server-side', () => {
    const page = read('src/pages/AdminGymAudit.tsx');
    const handler = read('api/_handlers/admin.ts');
    const engine = read('api/_lib/admin-gym-audit.ts');

    expect(page).toContain("adminRequest('gyms-audit'");
    expect(page).toContain("adminRequest('fix-gym-coordinates'");
    expect(page).not.toContain('updateDoc(');
    expect(page).not.toContain("doc(db, 'gyms'");
    expect(handler).toContain("case 'gyms-audit'");
    expect(handler).toContain("case 'fix-gym-coordinates'");
    expect(engine).toContain('distanceMeters > 30');
    expect(engine).toContain('GOOGLE_PLACE_TIMEOUT_MS = 5_000');
    expect(engine).toContain('AUDIT_CONCURRENCY = 20');
    expect(engine).toContain('new AbortController()');
    expect(engine).toContain('Promise.all(results.slice(index, index + AUDIT_CONCURRENCY)');
    expect(engine).toContain("db.collection('users').where('gymId', '==', id).get()");
    expect(engine).toContain('FIRESTORE_BATCH_SIZE = 450');
    expect(engine).not.toContain("where('gymId', '==', id).limit(400)");
  });

  test('Store backoffice requires the same active-admin authority as the rest of admin', () => {
    const storeHandler = read('api/_handlers/store.ts');
    expect(storeHandler).toContain("import { hasActiveAdminAuthority } from '../_lib/admin-authority.js'");
    expect(storeHandler).toContain('hasActiveAdminAuthority(snapshot.data())');
    expect(storeHandler).not.toContain("snapshot.data()?.role === 'admin'");
  });

  test('prelaunch store stays hidden while official cash prizes remain isolated from Invictus Coins', () => {
    const app = read('src/App.tsx');
    const profile = read('src/pages/ProfileNew.tsx');
    const prizeWallet = read('src/pages/PrizeWallet.tsx');
    const coinRedeem = read('api/_handlers/wallet-redeem.ts');
    const challenges = read('src/components/ChallengesHubNew.tsx');
    const storeHandler = read('api/_handlers/store.ts');

    expect(app).not.toContain("import('./pages/InvictusStore')");
    expect(app).not.toContain("import('./pages/StoreProductDetail')");
    expect(app).not.toContain("import('./pages/StoreCheckout')");
    expect(app).not.toContain("import('./pages/StoreOrders')");
    expect(app).toContain('<Route path="/store" element={<Navigate to="/" replace />} />');
    expect(app).toContain('<Route path="/store/product/:productId" element={<Navigate to="/" replace />} />');
    expect(app).toContain('<Route path="/profile/wallet" element={<PrizeWallet />} />');
    expect(app).toContain('<Route path="/admin/store/drops" element={<AdminGuard><AdminStoreDrops /></AdminGuard>} />');

    expect(profile).toContain('INVICTUS COINS');
    expect(profile).toContain('missionService.dashboard()');
    expect(profile).toContain('data.coinWallet?.balance');
    expect(profile).toContain('Prêmios e saques');
    expect(profile).not.toContain('Loja Invictus');
    expect(profile).not.toContain("navigate('/store')");

    expect(prizeWallet).toContain("cashSource: 'official_prizes_only'");
    expect(prizeWallet).toContain('coinsWithdrawable: false');
    expect(prizeWallet).toContain('INVICTUS COINS NÃO SÃO DINHEIRO');
    expect(prizeWallet).toContain('Coins continuam sendo pontos internos do ecossistema e nunca entram neste saldo nem podem ser sacadas.');
    expect(prizeWallet).toContain("authenticatedFetch('/api/financial'");
    expect(prizeWallet).not.toContain('VerifiedPresenceModal');
    expect(prizeWallet).toContain('reauthenticateWithPhoneNumber');
    expect(prizeWallet).toContain("action: 'request-withdrawal'");
    expect(prizeWallet).toContain('Cada saque exige uma nova confirmação por SMS do Firebase');
    expect(coinRedeem).toContain('PIX_REDEMPTION_DISABLED');

    expect(challenges).not.toContain('futura Loja Invictus');
    expect(challenges).toContain('Invictus Coins são pontos internos de recompensa vinculados ao seu perfil');

    expect(storeHandler).toContain('const publicStoreEnabled');
    expect(storeHandler).toContain("process.env.NODE_ENV === 'test'");
    expect(storeHandler).toContain('process.env.PUBLIC_STORE_ENABLED');
    expect(storeHandler).toContain('!publicStoreEnabled() && !ADMIN_ACTIONS.has(action)');
    expect(storeHandler).toContain("'admin-drops'");
  });
});
