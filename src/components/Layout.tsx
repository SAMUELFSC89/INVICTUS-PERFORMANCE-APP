import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Gauge, Trophy, Award, User, Dumbbell, Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { AchievementTracker } from './AchievementTracker';
import { XPToast } from './XPToast';
import { FloatingSessionIndicator } from './FloatingSessionIndicator';
import { InvictusAIFloatingAssistant } from './InvictusAIFloatingAssistant';

import { useUser } from '../UserContext';
import { TermsAndConsent } from './TermsAndConsent';
import { getXPProgress } from '../lib/levelUtils';
import { BarbellLifter } from './BarbellLifter';

export function Layout() {
  const { user, refreshUser } = useUser();
  const progress = getXPProgress(user?.xp || 0);
  const [showBarbellModal, setShowBarbellModal] = useState(false);
  const [xpToast, setXpToast] = useState<{ visible: boolean; points: number; message?: string; rankingPoints?: number }>({ 
    visible: false, points: 0 
  });

  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === '/' || location.pathname === '/invite';
  // Power Lift owns the whole viewport and ships its own footer. Keeping the
  // legacy shell mounted here produced two navigation bars on the same screen.
  const suppressLegacyChrome = location.pathname.startsWith('/power') || location.pathname.startsWith('/health');

  const [theme] = useState<'light' | 'dark'>(() => {
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

  const unreadCount = user?.notifications?.filter(n => !n.read).length || 0;

  return (
    <div className="min-h-screen app-fundo text-on-surface font-body flex flex-col">
      <TermsAndConsent />
      <AchievementTracker />
      {!suppressLegacyChrome && <FloatingSessionIndicator />}
      {!suppressLegacyChrome && <InvictusAIFloatingAssistant />}
      
      <XPToast 
        isVisible={xpToast.visible} 
        points={xpToast.points} 
        message={xpToast.message}
        rankingPoints={xpToast.rankingPoints}
        onComplete={() => setXpToast(prev => ({ ...prev, visible: false }))} 
      />

      {/* Notification Bell Only */}
      {/* O topo e calculado a partir da safe area (notch/Dynamic Island) em vez de
          um valor fixo: no iPhone o sino subia demais e encostava no relogio do
          sistema, e na web ficava colado na borda. env() vale 0px onde nao ha
          notch, entao na web o sino simplesmente desce para 1.5rem. */}
      {!suppressLegacyChrome && location.pathname !== '/notifications' && <div
        className="fixed right-4 z-50 pointer-events-auto flex items-center gap-2"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1.5rem)' }}>
        {/* #245: showBarbellModal e o BarbellLifter ja existiam prontos, mas
            nada na tela chamava setShowBarbellModal(true) -- MiniBarbellProgress
            (o widget largo pensado pra isso) tambem estava importado sem uso.
            Em vez de forcar aquele widget largo num canto de 40px, um badge
            compacto de nivel abre o mesmo modal -- conecta a funcionalidade
            sem redesenhar nenhuma tela. */}
        <button
          id="barbell-level-btn"
          onClick={() => setShowBarbellModal(true)}
          className="h-10 px-3 flex items-center gap-1.5 rounded-2xl bg-[#16120C]/85 backdrop-blur-xl border border-[#F5A623]/25 text-[#F5A623] hover:border-[#F5A623]/60 transition-colors shadow-lg active:scale-95 cursor-pointer"
          title="Nível do haltere"
          aria-label="Ver nível do haltere"
        >
          <Dumbbell size={16} />
          <span className="text-[11px] font-black uppercase tracking-wide">LVL {progress.currentLevel}</span>
        </button>
        <button
          id="notification-bell-btn"
          onClick={() => navigate('/notifications')}
          className="w-10 h-10 flex items-center justify-center rounded-2xl bg-[#16120C]/85 backdrop-blur-xl border border-[#F5A623]/25 text-[#9E8E7E] hover:text-[#F5A623] transition-colors relative shadow-lg active:scale-95 cursor-pointer"
          title="Notificações"
          aria-label="Abrir notificações"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#F5A623] rounded-full shadow-[0_0_10px_rgba(245,166,35,0.9)]" />
          )}
        </button>
      </div>}

      {/* Main Content */}
      {/* A Home desenha o proprio cabecalho (capacete + assinatura) e controla
          o respiro do topo, para o espartano do fundo aparecer como na arte.
          Nas outras telas o padding padrao continua valendo. */}
      <main className={cn(
        "flex-grow pb-40 w-full relative z-[2] max-w-screen-xl mx-auto px-4 md:px-6",
        isHome ? "pt-0" : "pt-16 md:pt-20"
      )}>
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, scale: 0.98, filter: 'blur(10px)' }}
            // NOTE: 'transitionEnd' clears filter AND transform to 'none' once the
            // page-enter animation settles. Leaving either as a lingering inline
            // style (Framer Motion's default behavior) creates a new CSS containing
            // block for every position:fixed descendant on the page - including every
            // modal - silently pinning them to this div's box instead of the real
            // viewport. That's the root cause behind modals opening off-screen /
            // needing a scroll to reach (e.g. the 'Qual seu treino de hoje?' modal).
            // #46: o filter ja era limpo, mas 'scale' continuava animado via
            // transform -- framer-motion mantem o transform inline mesmo em
            // scale:1 (nao volta pra 'none' sozinho). Isso prendia o overlay de
            // tela cheia do ChallengeActivityFlow (position:fixed) dentro da caixa
            // deste motion.div em vez do viewport real sempre que ele nascia
            // aberto (deep link Home -> Musculacao/Cardio): o card renderizava
            // deslocado/cortado e, dependendo do timing, o usuario caia de volta
            // na lista de Desafios. Limpar o transform tambem resolve na raiz,
            // sem depender de timing.
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none', transform: 'none' } }}
            exit={{ opacity: 0, scale: 1.02, filter: 'blur(10px)' }}
            transition={{ duration: 0.4, ease: [0.19, 1, 0.22, 1] }}
          >
            <Outlet context={{ triggerXPToast: (p: number, m?: string, rankingPoints?: number) => setXpToast({ visible: true, points: p, message: m, rankingPoints }) }} />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Navigation - Thin style with labels */}
      {!suppressLegacyChrome && <nav id="bottom-nav" className="fixed bottom-0 left-0 right-0 z-30 pb-safe-offset-4 pointer-events-none">
        <div className="max-w-lg mx-auto px-4 md:px-6 pb-4 md:pb-6">
          <div className="pointer-events-auto flex justify-between items-center h-16 md:h-20 px-2 md:px-4 bg-[#16120C]/85 backdrop-blur-3xl border border-[#F5A623]/25 shadow-[0_8px_32px_rgba(0,0,0,0.7)] rounded-[24px] md:rounded-[32px]">
            <NavItem
              id="nav-home"
              to="/"
              icon={<Gauge size={20} className="md:w-[22px] md:h-[22px]" />}
              label="INÍCIO"
              extraActiveCheck={(p) => p === '/' || p.startsWith('/championships')}
            />
            <NavItem id="nav-rankings" to="/rankings" icon={<Trophy size={20} className="md:w-[22px] md:h-[22px]" />} label="RANKING" />
            <NavItem id="nav-challenges" to="/challenges" icon={<Award size={20} className="md:w-[22px] md:h-[22px]" />} label="DESAFIOS" />
            <NavItem
              id="nav-profile"
              to="/profile"
              icon={<User size={20} className="md:w-[22px] md:h-[22px]" />}
              label="PERFIL"
              extraActiveCheck={(p) => p.startsWith('/profile')}
            />
          </div>
        </div>
      </nav>}

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

function NavItem({ to, icon, label, id, extraActiveCheck }: { to: string; icon: React.ReactNode; label: string; id?: string; extraActiveCheck?: (pathname: string) => boolean }) {
  const location = useLocation();
  const isExtraActive = extraActiveCheck ? extraActiveCheck(location.pathname) : false;

  return (
    <NavLink
      id={id}
      to={to}
      className={({ isActive }) =>
        cn(
          "flex flex-col items-center justify-center transition-all duration-300 flex-1 h-full gap-1 outline-none py-1",
          isActive || isExtraActive
            ? "text-[#F5A623] bg-[rgba(245,166,35,0.12)] rounded-2xl drop-shadow-[0_0_8px_rgba(245,166,35,0.4)]"
            : "text-[#9E8E7E] hover:text-white"
        )
      }
    >
      <div className="relative">
        {icon}
      </div>
      <span className="text-[8px] md:text-[10px] font-barlow font-bold tracking-widest uppercase transition-opacity">{label}</span>
    </NavLink>
  );
}
