import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AdminGuard } from './components/AdminGuard';
import { AuthGuard } from './components/AuthGuard';
import { MobileBridge } from './components/MobileBridge';

import { UserProvider } from './UserContext';
import { ProProvider } from './ProContext';
import { API_CONFIG } from './config';
import './styles/invictus.css';

const lazyNamed = <T extends Record<string, unknown>, K extends keyof T>(
  loader: () => Promise<T>,
  exportName: K,
) => lazy(async () => ({ default: (await loader())[exportName] as ComponentType<any> }));

const Home = lazyNamed(() => import('./pages/Home'), 'Home');
const Rankings = lazyNamed(() => import('./pages/Rankings'), 'Rankings');
const Achievements = lazyNamed(() => import('./pages/Achievements'), 'Achievements');
const Challenges = lazyNamed(() => import('./pages/Challenges'), 'Challenges');
const ActivityTypeChooser = lazyNamed(() => import('./components/ActivityTypeChooser'), 'ActivityTypeChooser');
const PublicProfile = lazyNamed(() => import('./pages/PublicProfile'), 'PublicProfile');
const ProfileNew = lazyNamed(() => import('./pages/ProfileNew'), 'ProfileNew');
const ProfileSecondary = lazyNamed(() => import('./pages/ProfileSecondary'), 'ProfileSecondary');
const PaymentSuccess = lazyNamed(() => import('./pages/PaymentSuccess'), 'PaymentSuccess');
const AdminWorkouts = lazyNamed(() => import('./pages/AdminWorkouts'), 'AdminWorkouts');
const AdminPayouts = lazyNamed(() => import('./pages/AdminPayouts'), 'AdminPayouts');
const AdminDashboard = lazyNamed(() => import('./pages/AdminDashboard'), 'AdminDashboard');
const AdminGymAudit = lazyNamed(() => import('./pages/AdminGymAudit'), 'AdminGymAudit');
const AdminRankingSimulator = lazyNamed(() => import('./pages/AdminRankingSimulator'), 'AdminRankingSimulator');
const AdminSecurityAudit = lazyNamed(() => import('./pages/AdminSecurityAudit'), 'AdminSecurityAudit');
const AdminIGATesteOriginal = lazyNamed(() => import('./pages/AdminIGATesteOriginal'), 'AdminIGATesteOriginal');
const Performance = lazyNamed(() => import('./pages/Performance'), 'Performance');
const PowerLift = lazyNamed(() => import('./pages/PowerLift'), 'PowerLift');
const Health = lazyNamed(() => import('./pages/Health'), 'Health');
const HealthReport = lazyNamed(() => import('./pages/HealthReport'), 'HealthReport');
const Notifications = lazyNamed(() => import('./pages/Notifications'), 'Notifications');
const ChampionshipsHub = lazyNamed(() => import('./pages/championships/ChampionshipsHub'), 'ChampionshipsHub');
const CommunityChampionship = lazyNamed(() => import('./pages/championships/CommunityChampionship'), 'CommunityChampionship');
const ChampionshipPreview = lazyNamed(() => import('./pages/championships/ChampionshipPreview'), 'ChampionshipPreview');
const Musculation = lazyNamed(() => import('./pages/Musculation'), 'Musculation');
const InvictusStore = lazyNamed(() => import('./pages/InvictusStore'), 'InvictusStore');
const InvictusAI = lazyNamed(() => import('./pages/InvictusAI'), 'InvictusAI');
const StoreProductDetail = lazyNamed(() => import('./pages/StoreProductDetail'), 'StoreProductDetail');
const StoreCheckout = lazyNamed(() => import('./pages/StoreCheckout'), 'StoreCheckout');
const StoreOrders = lazyNamed(() => import('./pages/StoreOrders'), 'StoreOrders');
const AdminStorePricing = lazyNamed(() => import('./pages/AdminStorePricing'), 'AdminStorePricing');
const AdminStoreDrops = lazyNamed(() => import('./pages/AdminStoreDrops'), 'AdminStoreDrops');
const AdminStoreOrders = lazyNamed(() => import('./pages/AdminStoreOrders'), 'AdminStoreOrders');

function RouteLoading() {
  return <div className="app-route-loading" role="status" aria-live="polite">CARREGANDO…</div>;
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
    <UserProvider>
        <ProProvider>
          <BrowserRouter>
            <MobileBridge />
            <AuthGuard>
            <Suspense fallback={<RouteLoading />}>
            <Routes>
              {/* Continue URLs de verificação/reset do Firebase apontam para
                  /login. Mantemos a rota dentro do guard para não cair em tela
                  inexistente no PWA/nativo. */}
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="/onboarding/diet" element={<Navigate to="/" replace />} />
              <Route element={<Layout />}>
                <Route path="/" element={<Home />} />
                <Route path="/invite" element={<Home />} />
                <Route path="/rankings" element={<Rankings />} />
                <Route path="/league" element={<Navigate to="/championships" replace />} />
                <Route path="/league/inscricao" element={<Navigate to="/championships" replace />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/gym" element={<Navigate to="/profile/academy" replace />} />
                <Route path="/challenges" element={<Challenges />} />
                <Route path="/challenges/cardio" element={<Challenges />} />
                <Route path="/activity" element={<ActivityTypeChooser />} />
                {/* Rotas canônicas para retomar uma sessão sem voltar à escolha
                    de modalidade. A rota de saída apenas minimiza a sessão;
                    cancelar continua sendo uma ação explícita dentro do fluxo. */}
                <Route path="/activity/ongoing" element={<Challenges />} />
                <Route path="/running" element={<Challenges />} />
                <Route path="/activity/exit" element={<Navigate to="/" replace />} />
                <Route path="/musculacao" element={<Musculation />} />
                <Route path="/store" element={<InvictusStore />} />
                <Route path="/ai" element={<InvictusAI />} />
                <Route path="/store/product/:productId" element={<StoreProductDetail />} />
                <Route path="/store/product/:productId/checkout" element={<StoreCheckout />} />
                <Route path="/store/orders" element={<StoreOrders />} />
                <Route path="/profile/:userId" element={<PublicProfile />} />
                <Route path="/profile/academy" element={<ProfileSecondary />} />
                <Route path="/profile/academy/search" element={<ProfileSecondary />} />
                <Route path="/profile/academy/confirm" element={<ProfileSecondary />} />
                <Route path="/profile/wearables" element={<ProfileSecondary />} />
                <Route path="/profile/wallet" element={<Navigate to="/store" replace />} />
                <Route path="/profile/goals" element={<ProfileSecondary />} />
                <Route path="/profile/security" element={<ProfileSecondary />} />
                <Route path="/profile/preferences" element={<ProfileSecondary />} />
                <Route path="/profile/preferences/:section" element={<ProfileSecondary />} />
                <Route path="/profile" element={<ProfileNew />} />
                <Route path="/championships" element={<ChampionshipsHub />} />
                <Route path="/championships/community" element={<CommunityChampionship />} />
                <Route path="/championships/preview/musculacao" element={<ChampionshipPreview modality="musculacao" />} />
                <Route path="/championships/preview/cardio" element={<ChampionshipPreview modality="cardio" />} />
                <Route path="/championships/my" element={<Navigate to="/championships/community" replace />} />
                <Route path="/championships/my/:id" element={<Navigate to="/championships/community" replace />} />
                <Route path="/championships/:id/rules" element={<Navigate to="/championships" replace />} />
                <Route path="/championships/:id/register" element={<Navigate to="/championships" replace />} />
                <Route path="/championships/:id/checkout-redirect" element={<Navigate to="/championships" replace />} />
                <Route path="/championships/:id/confirmed" element={<Navigate to="/championships" replace />} />
                <Route path="/championships/:id" element={<Navigate to="/championships" replace />} />
                <Route path="/achievements" element={<Achievements />} />
                <Route path="/wallet" element={<Navigate to="/store" replace />} />
                <Route path="/performance" element={<Performance />} />
                <Route path="/power" element={<PowerLift />} />
                <Route path="/settings" element={<Navigate to="/profile/preferences" replace />} />
                <Route path="/wearables" element={<Navigate to="/profile/wearables" replace />} />
                <Route path="/health" element={<Health />} />
                <Route path="/health/report" element={<HealthReport />} />
                <Route path="/health/report/full" element={<Navigate to="/health/report" replace />} />
                <Route path="/pagamento/sucesso" element={<PaymentSuccess />} />
                <Route path="/pagamento/pendente" element={<PaymentSuccess />} />
                <Route path="/pagamento/falha" element={<PaymentSuccess />} />
                <Route path="/my-diet" element={<Navigate to="/" replace />} />
                <Route path="/saude" element={<Navigate to="/" replace />} />
                <Route path="/medical" element={<Navigate to="/" replace />} />
                <Route path="/clinical" element={<Navigate to="/" replace />} />
                <Route path="/admin/workouts" element={<AdminGuard><AdminWorkouts /></AdminGuard>} />
                <Route path="/admin/payouts" element={<AdminGuard><AdminPayouts /></AdminGuard>} />
                <Route path="/admin/gym-audit" element={<AdminGuard><AdminGymAudit /></AdminGuard>} />
                <Route path="/admin/ranking-simulator" element={<AdminGuard><AdminRankingSimulator /></AdminGuard>} />
                <Route path="/admin/iga-teste-original" element={<AdminGuard><AdminIGATesteOriginal /></AdminGuard>} />
                <Route path="/admin/security" element={<AdminGuard><AdminSecurityAudit /></AdminGuard>} />
                <Route path="/admin/store/pricing" element={<AdminGuard><AdminStorePricing /></AdminGuard>} />
                <Route path="/admin/store/drops" element={<AdminGuard><AdminStoreDrops /></AdminGuard>} />
                <Route path="/admin/store/orders" element={<AdminGuard><AdminStoreOrders /></AdminGuard>} />
                <Route path="/admin/wearables" element={<AdminGuard><ProfileSecondary /></AdminGuard>} />
                <Route path="/admin" element={<AdminGuard><AdminDashboard /></AdminGuard>} />
              </Route>
            </Routes>
            </Suspense>
          </AuthGuard>
        </BrowserRouter>
        </ProProvider>
    </UserProvider>
  );
}
