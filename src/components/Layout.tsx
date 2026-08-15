import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Gauge, Trophy, Award, User, Zap, Settings as SettingsIcon, Medal, Wallet, Users, Heart, Dumbbell, Bell, Building2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { auth, db } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { UserProfile } from '../types';
import { AchievementTracker } from './AchievementTracker';
import { Onboarding } from './Onboarding';
import { NotificationCenter } from './NotificationCenter';
import { XPToast } from './XPToast';
import { FloatingSessionIndicator } from './FloatingSessionIndicator';
import { InvictusAIFloatingAssistant } from './InvictusAIFloatingAssistant';

import { useUser } from '../UserContext';
import { TermsAndConsent } from './TermsAndConsent';
import { getXPProgress, getLevelFromXP } from '../lib/levelUtils';
import { BarbellLifter } from './BarbellLifter';
import { MiniBarbellProgress } from './MiniBarbellProgress';
import { InvictusLogo } from './InvictusLogo';
import { initPushNotifications } from '../services/pushNotificationService';

export function Layout() {
  const { user, refreshUser } = useUser();
  const progress = getXPProgress(user?.xp || 0);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [showBarbellModal, setShowBarbellModal] = useState(false);
  const [xpToast, setXpToast] = useState<{ visible: boolean; points: number; message?: string }>({ 
    visible: false, points: 0 
  });

  const navigate = useNavigate();
  const location = useLocation();

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    const root = window.document.documentElement;
    root.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    if (user) {
      if (!user.termsAccepted || !user.league || !user.gymId) {
        setShowOnboarding(true);
      } else {
        setShowOnboarding(false);
      }
    }
  }, [user]);

  // Push notifications: register this device's FCM token once we have an
  // authenticated user (real registration, not just a permission check).
  useEffect(() => {
    if (user?.uid) {
      initPushNotifications(user.uid, (url) => navigate(url));
    }
  }, [user?.uid, navigate]);

  // UserContext fetches the profile once on login (no live Firestore
  // listener), so without this the Bell badge would only refresh after a
  // full app reload. Cheap periodic + on-focus refresh keeps it real.
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => { refreshUser(); }, 60000);
    const onFocus = () => refreshUser();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [user, refreshUser]);

  const handleMarkNotifRead = async (id: string) => {
    if (!user) return;
    const updated = user.notifications?.map(n => n.id === id ? { ...n, read: true } : n);
    await updateDoc(doc(db, 'users', user.uid), { notifications: updated });
  };

  const handleClearAllNotifs = async () => {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid), { notifications: [] });
  };

  const unreadCount = user?.notifications?.filter(n => !n.read).length || 0;

  return (
    <div className="min-h-screen bg-background text-on-surface font-body flex flex-col">
      {showOnboarding && user && location.pathname !== '/settings' && (
        <Onboarding user={user} onComplete={() => setShowOnboarding(false)} />
      )}
      <TermsAndConsent />
      <AchievementTracker />
      <FloatingSessionIndicator />
      <InvictusAIFloatingAssistant />
      
      <XPToast 
        isVisible={xpToast.visible} 
        points={xpToast.points} 
        message={xpToast.message}
        onComplete={() => setXpToast(prev => ({ ...prev, visible: false }))} 
      />

      <NotificationCenter 
        isOpen={isNotifOpen}
        onClose={() => setIsNotifOpen(false)}
        notifications={user?.notifications || []}
        onMarkAsRead={handleMarkNotifRead}
        onClearAll={handleClearAllNotifs}
      />

      {/* Top Bar - Clean header with Invictus Performance branding centered */}
      <header id="main-header" className="w-full top-0 z-50 sticky bg-background/90 backdrop-blur-xl border-b border-white/[0.03]">
        <nav className="max-w-screen-xl mx-auto flex items-center justify-between px-4 md:px-6 py-3 md:py-4 w-full min-h-16 md:h-20 relative">
          {/* Left spacer to balance layout */}
          <div className="w-9 h-9 md:w-10 md:h-10 shrink-0" />

          {/* Centered Logo & Brand Title */}
          <button
            onClick={() => navigate('/')}
            className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2.5 sm:gap-3 cursor-pointer group py-1 opacity-95 hover:opacity-100 transition-opacity active:scale-95"
            title="Invictus Performance - Início"
          >
            <InvictusLogo size={32} className="w-7 h-7 sm:w-8 sm:h-8 md:w-9 md:h-9 shrink-0 transition-transform group-hover:scale-105" />
            <div className="flex flex-col text-left leading-none">
              <span className="font-headline italic font-black text-sm sm:text-base md:text-lg text-primary tracking-tighter uppercase">
                INVICTUS
              </span>
              <span className="font-sans font-black text-[8px] sm:text-[9px] md:text-[10px] text-white/80 tracking-[0.2em] uppercase mt-0.5">
                PERFORMANCE
              </span>
            </div>
          </button>
          
          {/* Right Action Controls */}
          <div className="flex items-center gap-2 md:gap-3">
            <button 
              onClick={() => setIsNotifOpen(true)}
              className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center rounded-2xl bg-surface-container border border-white/5 text-on-surface-variant hover:text-primary transition-colors relative"
              title="Notificações"
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full shadow-[0_0_10px_rgba(255,204,0,0.8)]" />
              )}
            </button>
          </div>
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-grow pb-40 max-w-screen-xl mx-auto w-full px-4 md:px-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, scale: 0.98, filter: 'blur(10px)' }}
            // NOTE: 'transitionEnd' clears the filter to 'none' once the page-enter
            // animation settles. Leaving 'filter: blur(0px)' as a lingering inline
            // style (Framer Motion's default behavior) creates a new CSS containing
            // block for every position:fixed descendant on the page - including every
            // modal - silently pinning them to this div's box instead of the real
            // viewport. That's the root cause behind modals opening off-screen /
            // needing a scroll to reach (e.g. the 'Qual seu treino de hoje?' modal).
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
            exit={{ opacity: 0, scale: 1.02, filter: 'blur(10px)' }}
            transition={{ duration: 0.4, ease: [0.19, 1, 0.22, 1] }}
          >
            <Outlet context={{ triggerXPToast: (p: number, m?: string) => setXpToast({ visible: true, points: p, message: m }) }} />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Navigation - Thin style with labels */}
      <nav id="bottom-nav" className="fixed bottom-0 left-0 right-0 z-30 pb-safe-offset-4 pointer-events-none">
        <div className="max-w-lg mx-auto px-4 md:px-6 pb-4 md:pb-6">
          <div className="pointer-events-auto flex justify-between items-center h-16 md:h-20 px-2 md:px-4 bg-surface/80 backdrop-blur-3xl border border-white/5 shadow-2xl rounded-[24px] md:rounded-[32px]">
            <NavItem id="nav-home" to="/" icon={<Gauge size={20} className="md:w-[22px] md:h-[22px]" />} label="INÍCIO" />
            <NavItem id="nav-rankings" to="/rankings" icon={<Trophy size={20} className="md:w-[22px] md:h-[22px]" />} label="RANKING" />
            <NavItem id="nav-challenges" to="/challenges" icon={<Award size={20} className="md:w-[22px] md:h-[22px]" />} label="DESAFIOS" />
            <NavItem id="nav-profile" to="/profile" icon={<User size={20} className="md:w-[22px] md:h-[22px]" />} label="PERFIL" />
          </div>
        </div>
      </nav>

      {/* Barbell Lifter Modal */}
      <AnimatePresence>
        {showBarbellModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
            onClick={() => setShowBarbellModal(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 350 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-lg bg-surface-container-low border border-white/10 rounded-[32px] p-6 shadow-2xl overflow-hidden"
            >
              <button 
                onClick={() => setShowBarbellModal(false)}
                className="absolute top-4 right-4 text-on-surface-variant hover:text-white transition-colors text-sm font-bold bg-white/5 hover:bg-white/10 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
              <div className="text-center mb-4">
                <h3 className="font-headline italic font-black text-xl md:text-2xl text-on-surface tracking-tight uppercase leading-none">
                  NÍVEL DO HALTER
                </h3>
                <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mt-1">FORÇA REAL NO INVICTUS</p>
              </div>
              <div className="max-h-[75vh] overflow-y-auto">
                <BarbellLifter level={progress.currentLevel} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItem({ to, icon, label, id }: { to: string; icon: React.ReactNode; label: string; id?: string }) {
  return (
    <NavLink
      id={id}
      to={to}
      className={({ isActive }) =>
        cn(
          "flex flex-col items-center justify-center transition-all duration-300 flex-1 h-full gap-1 outline-none",
          isActive
            ? "text-primary bg-primary/5 rounded-3xl"
            : "text-on-surface-variant/50 hover:text-on-surface"
        )
      }
    >
      <div className="relative">
        {icon}
      </div>
      <span className="text-[8px] md:text-[10px] font-black tracking-widest uppercase transition-opacity">{label}</span>
    </NavLink>
  );
}
