import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { Rankings } from './pages/Rankings';
import { Achievements } from './pages/Achievements';
import { Challenges } from './pages/Challenges';
import { PublicProfile } from './pages/PublicProfile';
import { Profile } from './pages/Profile';
import { ProfileSecondary } from './pages/ProfileSecondary';
import { PaymentSuccess } from './pages/PaymentSuccess';
import { AdminWorkouts } from './pages/AdminWorkouts';
import { AdminPayouts } from './pages/AdminPayouts';
import { AdminDashboard } from './pages/AdminDashboard';
import { AdminGymAudit } from './pages/AdminGymAudit';
import { AdminRankingSimulator } from './pages/AdminRankingSimulator';
import { AdminSecurityAudit } from './pages/AdminSecurityAudit';
import { AdminIGATesteOriginal } from './pages/AdminIGATesteOriginal';
import { AdminGuard } from './components/AdminGuard';
import { AuthGuard } from './components/AuthGuard';
import { Performance } from './pages/Performance';
import GlobalErrorBoundary from './components/GlobalErrorBoundary';
import { MobileBridge } from './components/MobileBridge';

import { UserProvider } from './UserContext';
import { ProProvider } from './ProContext';
import { API_CONFIG } from './config';
import { PowerModule } from './pages/PowerModule';
import { Health, HealthReport } from './pages/Health';
import { League } from './pages/League';
import { Notifications } from './pages/Notifications';
import './styles/invictus.css';

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
    <GlobalErrorBoundary>
      <UserProvider>
        <ProProvider>
          <BrowserRouter>
            {/* <MobileBridge /> */}
            <AuthGuard>
            <Routes>
              <Route path="/onboarding/diet" element={<Navigate to="/" replace />} />
              <Route element={<Layout />}>
                <Route path="/" element={<Home />} />
                <Route path="/invite" element={<Home />} />
                <Route path="/rankings" element={<Rankings />} />
                <Route path="/league" element={<League />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/gym" element={<Navigate to="/profile/academy" replace />} />
                <Route path="/challenges" element={<Challenges />} />
                <Route path="/profile/:userId" element={<PublicProfile />} />
                <Route path="/profile/academy" element={<ProfileSecondary />} />
                <Route path="/profile/academy/search" element={<ProfileSecondary />} />
                <Route path="/profile/academy/confirm" element={<ProfileSecondary />} />
                <Route path="/profile/wearables" element={<ProfileSecondary />} />
                <Route path="/profile/wallet" element={<ProfileSecondary />} />
                <Route path="/profile/goals" element={<ProfileSecondary />} />
                <Route path="/profile/security" element={<ProfileSecondary />} />
                <Route path="/profile/preferences" element={<ProfileSecondary />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/achievements" element={<Achievements />} />
                <Route path="/wallet" element={<Navigate to="/profile/wallet" replace />} />
                <Route path="/performance" element={<Performance />} />
                <Route path="/power" element={<PowerModule />} />
                <Route path="/settings" element={<Navigate to="/profile/preferences" replace />} />
                <Route path="/wearables" element={<Navigate to="/profile/wearables" replace />} />
                <Route path="/health" element={<Health />} />
                <Route path="/health/report" element={<HealthReport />} />
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
                <Route path="/admin/wearables" element={<AdminGuard><WearablesDashboard /></AdminGuard>} />
                <Route path="/admin" element={<AdminGuard><AdminDashboard /></AdminGuard>} />
              </Route>
            </Routes>
          </AuthGuard>
        </BrowserRouter>
        </ProProvider>
      </UserProvider>
    </GlobalErrorBoundary>
  );
}
