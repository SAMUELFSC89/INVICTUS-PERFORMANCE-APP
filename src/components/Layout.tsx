import React, { useEffect, useLayoutEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Gauge, Trophy, Award, User } from 'lucide-react';
import { cn } from '../lib/utils';
import { AchievementTracker } from './AchievementTracker';
import { XPToast } from './XPToast';
import { FloatingSessionIndicator } from './FloatingSessionIndicator';
import { useUser } from '../UserContext';
import { TermsAndConsent } from './TermsAndConsent';

export function Layout() {
  const { user, refreshUser } = useUser();
  const [xpToast, setXpToast] = useState<{ visible: boolean; points: number; message?: string; rankingPoints?: number }>({
    visible: false, points: 0
  });

  const location = useLocation();
  const isHome = location.pathname === '/' || location.pathname === '/invite';

  // Telas novas que possuem shell/cabeçalho/rodapé próprios (a maioria via
  // createPortal(document.body)). O menu antigo do Layout nunca pode ficar
  // montado por baixo delas: além do vazamento visual, dois navs simultâneos
  // mantinham alvos de toque invisíveis na mesma região da tela.
  const routeOwnsNavigation = isHome
    || location.pathname.startsWith('/power')
    || location.pathname.startsWith('/health')
    || location.pathname.startsWith('/championships')
    || location.pathname.startsWith('/challenges')
    || location.pathname.startsWith('/profile')
    || location.pathname.startsWith('/store')
    || location.pathname.startsWith('/admin')
    || location.pathname.startsWith('/activity')
    || location.pathname === '/running'
    || location.pathname === '/musculacao'
    || location.pathname === '/ai'
    || location.pathname === '/notifications'
    || location.pathname === '/achievements'
    || location.pathname.startsWith('/pagamento/');

  // O indicador deve desaparecer apenas onde a sessão em andamento já tem
  // superfície própria. Saúde, campeonatos e musculação são telas de consulta/
  // hub; esconder o indicador nelas fazia a sessão ativa parecer ter sumido.
  // Challenges/Activity/Running já exibem o fluxo ativo; Power possui o fluxo
  // próprio do Power Lift.
  const routeOwnsSessionSurface = location.pathname.startsWith('/power')
    || location.pathname.startsWith('/challenges')
    || location.pathname.startsWith('/activity')
    || location.pathname === '/running';

  // Several full-screen routes are rendered in document.body through portals.
  // Keeping the route surface on body lets the shared backdrop style reach both
  // regular Outlet pages and those portal-based screens without touching Home.
  useLayoutEffect(() => {
    document.body.dataset.invictusSurface = isHome ? 'home' : 'internal';
    return () => {
      delete document.body.dataset.invictusSurface;
    };
  }, [isHome]);

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
  // listener). Keep the shared refresh because current headers, profile and
  // notification surfaces consume this state even though the old global bell
  // was removed.
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

  return (
    <div className={cn(
      'min-h-screen app-fundo text-on-surface font-body flex flex-col',
      isHome ? 'app-fundo--home' : 'app-fundo--internal'
    )}>
      <TermsAndConsent />
      <AchievementTracker />
      {!routeOwnsSessionSurface && <FloatingSessionIndicator />}

      <XPToast
        isVisible={xpToast.visible}
        points={xpToast.points}
        message={xpToast.message}
        rankingPoints={xpToast.rankingPoints}
        onComplete={() => setXpToast(prev => ({ ...prev, visible: false }))}
      />

      {/*
        O badge global "LVL", o sino global e o modal BarbellLifter foram
        removidos daqui. As telas novas já possuem cabeçalho próprio e esses
        elementos antigos permaneciam montados atrás/por cima dos portals.
        Notificações continuam acessíveis pelos cabeçalhos atuais.
      */}

      <main className={cn(
        'flex-grow pb-40 w-full relative z-[2] max-w-screen-xl mx-auto px-4 md:px-6',
        isHome ? 'pt-0' : 'pt-16 md:pt-20'
      )}>
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, scale: 0.98, filter: 'blur(10px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none', transform: 'none' } }}
            exit={{ opacity: 0, scale: 1.02, filter: 'blur(10px)' }}
            transition={{ duration: 0.4, ease: [0.19, 1, 0.22, 1] }}
          >
            <Outlet context={{ triggerXPToast: (p: number, m?: string, rankingPoints?: number) => setXpToast({ visible: true, points: p, message: m, rankingPoints }) }} />
          </motion.div>
        </AnimatePresence>
      </main>

      {/*
        Fallback temporário apenas para rotas que ainda não possuem navegação
        própria (por exemplo, Ranking durante a revisão visual). Ele é
        explicitamente desmontado nas telas novas listadas em
        routeOwnsNavigation, portanto não pode mais ficar atrás dos portals.
      */}
      {!routeOwnsNavigation && <nav id="bottom-nav" className="fixed bottom-0 left-0 right-0 z-30 pb-safe-offset-4 pointer-events-none">
        <div className="max-w-lg mx-auto px-4 md:px-6 pb-4 md:pb-6">
          <div className="pointer-events-auto flex justify-between items-center h-16 md:h-20 px-2 md:px-4 bg-[#16120C]/85 backdrop-blur-3xl border border-[#F5A623]/25 shadow-[0_8px_32px_rgba(0,0,0,0.7)] rounded-[24px] md:rounded-[32px]">
            <NavItem
              id="nav-home"
              to="/"
              icon={<Gauge size={20} className="md:w-[22px] md:h-[22px]" />}
              label="INÍCIO"
              extraActiveCheck={(p) => p === '/' || p.startsWith('/championships')}
            />
            <NavItem id="nav-championships" to="/championships" icon={<Trophy size={20} className="md:w-[22px] md:h-[22px]" />} label="CAMPEONATOS" />
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
          'flex flex-col items-center justify-center transition-all duration-300 flex-1 h-full gap-1 outline-none py-1',
          isActive || isExtraActive
            ? 'text-[#F5A623] bg-[rgba(245,166,35,0.12)] rounded-2xl drop-shadow-[0_0_8px_rgba(245,166,35,0.4)]'
            : 'text-[#9E8E7E] hover:text-white'
        )
      }
    >
      <div className="relative">{icon}</div>
      <span className="text-[8px] md:text-[10px] font-barlow font-bold tracking-widest uppercase transition-opacity">{label}</span>
    </NavLink>
  );
}
