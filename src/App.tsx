import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AdminGuard } from './components/AdminGuard';
import { AuthGuard } from './components/AuthGuard';
import { MobileBridge } from './components/MobileBridge';
import { ProFeatureGate } from './components/ProFeatureGate';

import { UserProvider } from './UserContext';
import { ProProvider } from './ProContext';
import { API_CONFIG } from './config';
import './styles/invictus.css';
import './styles/internal-page-backdrop.css';

const lazyNamed = <T extends Record<string, unknown>, K extends keyof T>(
  loader: () => Promise<T>,
  exportName: K,
) => lazy(async () => ({ default: (await loader())[exportName] as ComponentType<any> }));

const Home = lazyNamed(() => import('./pages/Home'), 'Home');
const Achievements = lazyNamed(() => import('./pages/Achievements'), 'Achievements');
const Challenges = lazyNamed(() => import('./pages/Challenges'), 'Challenges');
const CardioObjective = lazyNamed(() => import('./pages/CardioObjective'), 'CardioObjective');
const ActivityTypeChooser = lazyNamed(() => import('./components/ActivityTypeChooser'), 'ActivityTypeChooser');
const PublicProfile = lazyNamed(() => import('./pages/PublicProfile'), 'PublicProfile');
const ProfileNew = lazyNamed(() => import('./pages/ProfileNew'), 'ProfileNew');
const ProfileSecondary = lazyNamed(() => import('./pages/ProfileSecondary'), 'ProfileSecondary');
const PrizeWallet = lazyNamed(() => import('./pages/PrizeWallet'), 'PrizeWallet');
const IdentityVerification = lazyNamed(() => import('./pages/IdentityVerification'), 'IdentityVerification');
const AcademySearch = lazyNamed(() => import('./pages/AcademySearch'), 'AcademySearch');
const AcademyConfirm = lazyNamed(() => import('./pages/AcademyConfirm'), 'AcademyConfirm');
const IGAExplanation = lazyNamed(() => import('./pages/IGAExplanation'), 'IGAExplanation');
const PaymentSuccess = lazyNamed(() => import('./pages/PaymentSuccess'), 'PaymentSuccess');
const AdminWorkouts = lazyNamed(() => import('./pages/AdminWorkouts'), 'AdminWorkouts');
const AdminPayouts = lazyNamed(() => import('./pages/AdminPayouts'), 'AdminPayouts');
const AdminDashboard = lazyNamed(() => import('./pages/AdminDashboard'), 'AdminDashboard');
const AdminGymAudit = lazyNamed(() => import('./pages/AdminGymAudit'), 'AdminGymAudit');
const AdminSecurityAudit = lazyNamed(() => import('./pages/AdminSecurityAudit'), 'AdminSecurityAudit');
const AdminFlaggedActivities = lazyNamed(() => import('./pages/AdminFlaggedActivities'), 'AdminFlaggedActivities');
const PowerLift = lazyNamed(() => import('./pages/PowerLift'), 'PowerLift');
const Health = lazyNamed(() => import('./pages/Health'), 'Health');
const HealthReport = lazyNamed(() => import('./pages/HealthReport'), 'HealthReport');
const SleepCheckin = lazyNamed(() => import('./pages/SleepCheckin'), 'SleepCheckin');
const Notifications = lazyNamed(() => import('./pages/Notifications'), 'Notifications');
const ChampionshipsHub = lazyNamed(() => import('./pages/championships/ChampionshipsHub'), 'ChampionshipsHub');
const CommunityChampionship = lazyNamed(() => import('./pages/championships/CommunityChampionship'), 'CommunityChampionship');
const CommunityRanking = lazyNamed(() => import('./pages/championships/CommunityRanking'), 'CommunityRanking');
const PaidChampionshipRanking = lazyNamed(() => import('./pages/championships/PaidChampionshipRanking'), 'PaidChampionshipRanking');
const ChampionshipPreview = lazyNamed(() => import('./pages/championships/ChampionshipPreview'), 'ChampionshipPreview');
const ChampionshipCheckoutReturn = lazyNamed(() => import('./pages/championships/ChampionshipCheckoutReturn'), 'ChampionshipCheckoutReturn');
const Musculation = lazyNamed(() => import('./pages/Musculation'), 'Musculation');
const InvictusAI = lazyNamed(() => import('./pages/InvictusAI'), 'InvictusAI');
const AdminStorePricing = lazyNamed(() => import('./pages/AdminStorePricing'), 'AdminStorePricing');
const AdminStoreDrops = lazyNamed(() => import('./pages/AdminStoreDrops'), 'AdminStoreDrops');
const AdminStoreOrders = lazyNamed(() => import('./pages/AdminStoreOrders'), 'AdminStoreOrders');

function RouteLoading() {
  return <div className="app-route-loading" role="status" aria-live="polite">CARREGANDO…</div>;
}

function HealthWithSleepEntry() {
  return <>
    <Health />
    <Link
      to="/health/sleep-checkin"
      aria-label="Registrar sono manualmente"
      style={{
        position: 'fixed', right: '16px', bottom: 'calc(82px + env(safe-area-inset-bottom, 0px))', zIndex: 80,
        display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '11px 14px', borderRadius: '999px',
        background: 'linear-gradient(135deg,#655bff,#8f87ff)', color: '#fff', textDecoration: 'none',
        fontSize: '12px', fontWeight: 900, letterSpacing: '.05em', boxShadow: '0 12px 28px rgba(72,61,220,.34)',
        border: '1px solid rgba(255,255,255,.18)'
      }}
    >☾ REGISTRAR SONO</Link>
  </>;
}

export default function App() {
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  useEffect(() => {
    console.log('[App] Initialized on origin:', window.location.origin);
    console.log('[App] API Base URL:', API_CONFIG.baseUrl || '(relative)');
  }, []);

  return (
    <BrowserRouter>
      <UserProvider>
        <ProProvider>
          <MobileBridge />
          <AuthGuard>
            <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="/onboarding/diet" element={<Navigate to="/" replace />} />
              <Route element={<Layout />}>
                <Route path="/" element={<Home />} />
                <Route path="/invite" element={<Home />} />
                <Route path="/rankings" element={<Navigate to="/championships" replace />} />
                <Route path="/league" element={<Navigate to="/championships" replace />} />
                <Route path="/league/inscricao" element={<Navigate to="/championships" replace />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/gym" element={<Navigate to="/profile/academy" replace />} />
                <Route path="/challenges" element={<Challenges />} />
                <Route path="/challenges/cardio" element={<Challenges />} />
                <Route path="/challenges/cardio/objective" element={<CardioObjective />} />
                <Route path="/activity" element={<ActivityTypeChooser />} />
                <Route path="/activity/ongoing" element={<Challenges />} />
                <Route path="/running" element={<Challenges />} />
                <Route path="/activity/exit" element={<Navigate to="/" replace />} />
                <Route path="/musculacao" element={<Musculation />} />
                {/* Loja física preservada no código/admin, mas fechada para usuários até o lançamento. */}
                <Route path="/store" element={<Navigate to="/" replace />} />
                <Route path="/store/product/:productId" element={<Navigate to="/" replace />} />
                <Route path="/store/product/:productId/checkout" element={<Navigate to="/" replace />} />
                <Route path="/store/orders" element={<Navigate to="/" replace />} />
                <Route path="/ai" element={<ProFeatureGate feature="ai"><InvictusAI /></ProFeatureGate>} />
                <Route path="/profile/:userId" element={<PublicProfile />} />
                <Route path="/profile/academy" element={<ProfileSecondary />} />
                <Route path="/profile/academy/search" element={<AcademySearch />} />
                <Route path="/profile/academy/confirm" element={<AcademyConfirm />} />
                <Route path="/profile/wearables" element={<ProfileSecondary />} />
                <Route path="/profile/wallet" element={<PrizeWallet />} />
                <Route path="/profile/identity" element={<IdentityVerification />} />
                <Route path="/profile/goals" element={<ProfileSecondary />} />
                <Route path="/profile/security" element={<ProfileSecondary />} />
                <Route path="/profile/preferences" element={<ProfileSecondary />} />
                <Route path="/profile/preferences/scoring" element={<IGAExplanation />} />
                <Route path="/profile/preferences/:section" element={<ProfileSecondary />} />
                <Route path="/profile" element={<ProfileNew />} />
                <Route path="/championships" element={<ChampionshipsHub />} />
                <Route path="/championships/community" element={<CommunityChampionship />} />
                <Route path="/championships/community/ranking" element={<CommunityRanking />} />
                <Route path="/championships/ranking/musculacao" element={<PaidChampionshipRanking modality="musculacao" />} />
                <Route path="/championships/ranking/cardio" element={<PaidChampionshipRanking modality="cardio" />} />
                <Route path="/championships/preview/musculacao" element={<ChampionshipPreview modality="musculacao" />} />
                <Route path="/championships/preview/cardio" element={<ChampionshipPreview modality="cardio" />} />
                <Route path="/championships/checkout-return" element={<ChampionshipCheckoutReturn />} />
                <Route path="/championships/invictus_strength_v1" element={<ChampionshipPreview modality="musculacao" />} />
                <Route path="/championships/invictus_cardio_v1" element={<ChampionshipPreview modality="cardio" />} />
                <Route path="/championships/my" element={<Navigate to="/championships/community" replace />} />
                <Route path="/championships/my/:id" element={<Navigate to="/championships/community" replace />} />
                <Route path="/championships/:id/rules" element={<Navigate to="/championships" replace />} />
                <Route path="/championships/:id/register" element={<Navigate to="/championships" replace />} />
                <Route path="/championships/:id/checkout-redirect" element={<Navigate to="/championships" replace />} />
                <Route path="/championships/:id/confirmed" element={<Navigate to="/championships" replace />} />
                <Route path="/championships/:id" element={<Navigate to="/championships" replace />} />
                <Route path="/achievements" element={<Achievements />} />
                <Route path="/wallet" element={<Navigate to="/profile/wallet" replace />} />
                <Route path="/performance" element={<Navigate to="/health" replace />} />
                <Route path="/power" element={<ProFeatureGate feature="powerlift"><PowerLift /></ProFeatureGate>} />
                <Route path="/settings" element={<Navigate to="/profile/preferences" replace />} />
                <Route path="/wearables" element={<Navigate to="/profile/wearables" replace />} />
                <Route path="/health" element={<ProFeatureGate feature="health"><HealthWithSleepEntry /></ProFeatureGate>} />
                <Route path="/health/sleep-checkin" element={<ProFeatureGate feature="health"><SleepCheckin /></ProFeatureGate>} />
                <Route path="/health/report" element={<ProFeatureGate feature="health"><HealthReport /></ProFeatureGate>} />
                <Route path="/health/report/full" element={<Navigate to="/health/report" replace />} />
                <Route path="/pagamento/sucesso" element={<PaymentSuccess />} />
                <Route path="/pagamento/pendente" element={<PaymentSuccess />} />
                <Route path="/pagamento/falha" element={<PaymentSuccess />} />
                <Route path="/my-diet" element={<Navigate to="/" replace />} />
                <Route path="/saude" element={<Navigate to="/health" replace />} />
                <Route path="/medical" element={<Navigate to="/health" replace />} />
                <Route path="/clinical" element={<Navigate to="/health" replace />} />

                <Route path="/admin/workouts" element={<AdminGuard><AdminWorkouts /></AdminGuard>} />
                <Route path="/admin/payouts" element={<AdminGuard><AdminPayouts /></AdminGuard>} />
                <Route path="/admin/gym-audit" element={<AdminGuard><AdminGymAudit /></AdminGuard>} />
                <Route path="/admin/security" element={<AdminGuard><AdminSecurityAudit /></AdminGuard>} />
                <Route path="/admin/flagged-activities" element={<AdminGuard><AdminFlaggedActivities /></AdminGuard>} />
                <Route path="/admin/store/pricing" element={<AdminGuard><AdminStorePricing /></AdminGuard>} />
                <Route path="/admin/store/drops" element={<AdminGuard><AdminStoreDrops /></AdminGuard>} />
                <Route path="/admin/store/orders" element={<AdminGuard><AdminStoreOrders /></AdminGuard>} />
                <Route path="/admin/wearables" element={<Navigate to="/profile/wearables" replace />} />
                {/* Ferramentas antigas de laboratório não fazem parte do backoffice de produção. */}
                <Route path="/admin/ranking-simulator" element={<Navigate to="/admin" replace />} />
                <Route path="/admin/iga-teste-original" element={<Navigate to="/admin" replace />} />
                <Route path="/admin" element={<AdminGuard><AdminDashboard /></AdminGuard>} />

                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
            </Suspense>
          </AuthGuard>
        </ProProvider>
      </UserProvider>
    </BrowserRouter>
  );
}
