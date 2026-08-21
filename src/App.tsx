import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { Rankings } from './pages/Rankings';
import { Achievements } from './pages/Achievements';
import { Challenges } from './pages/Challenges';
import { EliteChallenges } from './pages/EliteChallenges';
import { PublicProfile } from './pages/PublicProfile';
import { Profile } from './pages/Profile';
import { Wallet } from './pages/Wallet';
import { Settings } from './pages/Settings';
import { PaymentSuccess } from './pages/PaymentSuccess';
import { AdminWorkouts } from './pages/AdminWorkouts';
import { AdminPayouts } from './pages/AdminPayouts';
import { AdminDashboard } from './pages/AdminDashboard';
import { AdminEliteChallenges } from './pages/AdminEliteChallenges';
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
import { Gym } from './pages/Gym';
import { PowerModule } from './pages/PowerModule';
import { WearablesDashboard } from './pages/WearablesDashboard';
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
                <Route path="/gym" element={<Gym />} />
                <Route path="/challenges" element={<Challenges />} />
                <Route path="/elite" element={<EliteChallenges />} />
                <Route path="/profile/:userId" element={<PublicProfile />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/achievements" element={<Achievements />} />
                <Route path="/wallet" element={<Wallet />} />
                <Route path="/performance" element={<Performance />} />
                <Route path="/power" element={<PowerModule />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/wearables" element={<WearablesDashboard />} />
                <Route path="/pagamento/sucesso" element={<PaymentSuccess />} />
                <Route path="/pagamento/pendente" element={<PaymentSuccess />} />
                <Route path="/pagamento/falha" element={<PaymentSuccess />} />
                <Route path="/my-diet" element={<Navigate to="/" replace />} />
                <Route path="/saude" element={<Navigate to="/" replace />} />
                <Route path="/medical" element={<Navigate to="/" replace />} />
                <Route path="/clinical" element={<Navigate to="/" replace />} />
                <Route path="/health" element={<Navigate to="/" replace />} />
                <Route path="/admin/workouts" element={<AdminGuard><AdminWorkouts /></AdminGuard>} />
                <Route path="/admin/elite" element={<AdminGuard><AdminEliteChallenges /></AdminGuard>} />
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
