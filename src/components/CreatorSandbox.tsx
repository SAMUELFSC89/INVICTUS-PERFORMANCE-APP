import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Wrench, Compass, UserCheck, Sparkles, X, Check,
  ChevronRight, RefreshCw, Layers,
  Sliders} from 'lucide-react';
import { useUser } from '../UserContext';
import { db } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { cn } from '../lib/utils';

interface CreatorSandboxProps {
  showFloatingButton?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  inline?: boolean;
}

export function CreatorSandbox({
  showFloatingButton = false,
  isOpen: controlledIsOpen,
  onClose: controlledOnClose,
  inline = false
}: CreatorSandboxProps) {
  const { user, refreshUser } = useUser();
  const navigate = useNavigate();
  const location = useLocation();

  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const handleClose = () => {
    if (controlledOnClose) controlledOnClose();
    setInternalIsOpen(false);
  };
  const handleOpen = () => {
    setInternalIsOpen(true);
  };

  const [simulatedRole, setSimulatedRole] = useState<string>('user');
  const [updatingRole, setUpdatingRole] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setSimulatedRole(user.role || 'user');
    }
  }, [isOpen, location.pathname, user]);

  // Handle toast timers
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const isCreatorOrAdmin = user?.role === 'admin';

  // Change user role directly in Firestore for real integration tests
  const handleChangeRoleInDb = async (newRole: string) => {
    if (!user) {
      setToast('Erro: Nenhum usuário autenticado para alterar o papel.');
      return;
    }
    setUpdatingRole(true);
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, { role: newRole });
      setSimulatedRole(newRole);
      setToast(`Papel atualizado para [${newRole.toUpperCase()}] no banco de dados com sucesso!`);
      await refreshUser();
    } catch (err: any) {
      console.error('Erro ao atualizar papel:', err);
      setToast(`Erro ao atualizar no Firestore: ${err.message || err}`);
    } finally {
      setUpdatingRole(false);
    }
  };

  // Quick navigation helpers
  const handleQuickNav = (path: string) => {
    navigate(path);
    handleClose();
    setToast(`Navegando para: ${path}`);
  };

  // Reset Onboarding flow to re-verify onboarding step layouts
  const handleResetOnboarding = async () => {
    if (!user) return;
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        termsAccepted: false,
        gymId: '',
        league: ''
      });
      setToast('ONBOARDING RESETADO! Atualize a página para ver o fluxo inicial novamente.');
      await refreshUser();
    } catch (err) {
      setToast('Erro ao resetar onboarding.');
    }
  };

  // Only render if logged in as admin or the creator email
  if (!isCreatorOrAdmin) {
    return null;
  }

  // Content body reused for both inline and slide-over modes
  const sandboxContent = (
    <div className="space-y-6 text-on-surface">
      {/* Toast Notification */}
      {toast && (
        <div className="bg-red-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl uppercase tracking-wide text-center animate-fade-in flex items-center justify-center gap-2 shadow-lg">
          <Sparkles size={14} />
          {toast}
        </div>
      )}

      {/* 1. LAYOUTS DIRECT NAVIGATION */}
      <div className="space-y-3">
        <h3 className="text-xs font-black text-on-surface-variant uppercase tracking-widest flex items-center gap-1.5">
          <Compass size={14} className="text-red-500" />
          ATALHOS DE TODOS OS LAYOUTS
        </h3>
        
        <div className="grid grid-cols-2 gap-2">
          {[
            { name: 'Início', path: '/' },
            { name: 'Módulo de Força ⚡', path: '/power' },
            { name: 'Academia & Mapa 🏋️', path: '/gym' },
            { name: 'Treinos normais', path: '/challenges' },
            { name: 'Performance Chart 📈', path: '/performance' },
            { name: 'Carteira (Wallet)', path: '/wallet' },
            { name: 'Perfil & Altar 👤', path: '/profile' },
            { name: 'Conquistas', path: '/achievements' },
            { name: 'Admin Geral 🛠️', path: '/admin' },
            { name: 'Admin Simulador 🎛️', path: '/admin/ranking-simulator' },
            { name: 'Admin Treinos', path: '/admin/workouts' },
            { name: 'Admin Payouts', path: '/admin/payouts' }
          ].map(layout => (
            <button
              key={layout.path}
              onClick={() => handleQuickNav(layout.path)}
              className={cn(
                "p-2.5 rounded-xl text-left border text-xs font-bold transition-all hover:translate-x-1 flex items-center justify-between group cursor-pointer",
                location.pathname === layout.path
                  ? "bg-red-500/15 border-red-500 text-white"
                  : "bg-surface border-white/5 text-on-surface-variant hover:border-white/10"
              )}
            >
              <span className="truncate">{layout.name}</span>
              <ChevronRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          ))}
        </div>
      </div>

      {/* 2. ROLE SIMULATOR ENGINE */}
      <div className="bg-surface p-4 rounded-2xl border border-white/5 space-y-3">
        <h3 className="text-xs font-black text-on-surface-variant uppercase tracking-widest flex items-center gap-1.5">
          <UserCheck size={14} className="text-red-500" />
          SIMULADOR DE PAPÉIS (ROLE CHANGER)
        </h3>
        <p className="text-[10px] text-on-surface-variant leading-relaxed">
          Altere o seu papel de usuário diretamente no Firestore para validar as permissões de acesso (AdminGuard) e visualizações exclusivas:
        </p>

        <div className="flex flex-col gap-1.5 pt-1">
          {[
            { id: 'user', name: 'Usuário Atleta Comum' },
            { id: 'educator', name: 'Educador Físico / Personal' },
            { id: 'admin', name: 'Administrador Geral' }
          ].map(roleItem => (
            <button
              key={roleItem.id}
              disabled={updatingRole}
              onClick={() => handleChangeRoleInDb(roleItem.id)}
              className={cn(
                "w-full p-2.5 rounded-xl border text-left text-xs font-bold flex items-center justify-between transition-all cursor-pointer",
                simulatedRole === roleItem.id
                  ? "bg-green-500/10 border-green-500 text-green-400"
                  : "bg-surface-container hover:bg-surface-container-high border-white/5 text-on-surface-variant"
              )}
            >
              <span>{roleItem.name} <span className="text-[10px] opacity-50 font-mono">({roleItem.id})</span></span>
              {simulatedRole === roleItem.id && <Check size={14} />}
            </button>
          ))}
        </div>
      </div>

      {/* 3. UTILITIES AND RESET ENGINE */}
      <div className="space-y-3">
        <h3 className="text-xs font-black text-on-surface-variant uppercase tracking-widest flex items-center gap-1.5">
          <Layers size={14} className="text-red-500" />
          UTILITÁRIOS DA SANDBOX
        </h3>

        <div className="space-y-2">
          <button
            onClick={handleResetOnboarding}
            className="w-full bg-white/5 hover:bg-white/10 text-on-surface font-bold text-xs p-3 rounded-xl border border-white/5 text-left flex items-center justify-between group cursor-pointer"
          >
            <div>
              <span className="text-[10px] font-black text-primary block uppercase tracking-wide">Resetar Onboarding Inicial</span>
              <span className="text-[10px] text-on-surface-variant">Limpa status de cadastro para forçar exibição do modal de Boas-Vindas</span>
            </div>
            <RefreshCw size={14} className="group-hover:rotate-180 transition-transform duration-500" />
          </button>

          <button
            onClick={() => {
              localStorage.clear();
              setToast('Local Storage Limpo com Sucesso! Recarregue a página.');
            }}
            className="w-full bg-red-500/5 hover:bg-red-500/10 text-red-400 font-bold text-xs p-3 rounded-xl border border-red-500/10 text-left flex items-center justify-between group cursor-pointer"
          >
            <div>
              <span className="text-[10px] font-black block uppercase tracking-wide">Limpar Cache Local (localStorage)</span>
              <span className="text-[10px] text-red-400/80">Limpa todas as chaves persistidas no navegador</span>
            </div>
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Footer info */}
      <div className="pt-2 text-center space-y-1">
        <div className="flex justify-center gap-2 text-[10px] text-on-surface-variant font-mono">
          <span>UID: {user?.uid?.substring(0, 8)}...</span>
          <span>•</span>
          <span>Email: {user?.email}</span>
        </div>
      </div>
    </div>
  );

  // If rendering inline inside Admin Dashboard
  if (inline) {
    return (
      <div className="bg-surface-container-low p-6 sm:p-8 rounded-[32px] border border-red-500/30 shadow-xl space-y-6">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-red-500/20 border border-red-500/30 text-red-400">
              <Wrench size={20} />
            </div>
            <div>
              <h2 className="font-headline italic font-black text-xl text-white uppercase tracking-tight">MÓDULO DO CRIADOR</h2>
              <p className="text-xs text-on-surface-variant uppercase tracking-wider">Sandbox de Desenvolvimento & Verificação de Layouts</p>
            </div>
          </div>
          <span className="bg-red-500/20 text-red-400 border border-red-500/30 text-[10px] font-mono font-bold px-3 py-1 rounded-full uppercase">SANDBOX ATIVA</span>
        </div>
        {sandboxContent}
      </div>
    );
  }

  return (
    <>
      {/* Floating Toggle Button - ONLY shown if showFloatingButton is explicitly true */}
      {showFloatingButton && (
        <div className="fixed bottom-24 right-6 z-[90] md:bottom-6">
          <motion.button
            id="creator-sandbox-toggle"
            onClick={handleOpen}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="flex items-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-full shadow-2xl border border-red-500/30 font-headline italic font-black text-xs uppercase tracking-wider cursor-pointer"
          >
            <Wrench size={14} className="animate-spin-slow" />
            Módulo do Criador
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          </motion.button>
        </div>
      )}

      {/* Slide-over Sandbox Drawer Panel */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={handleClose}
              className="fixed inset-0 bg-black z-[140]"
            />

            {/* Sidebar Container */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 20 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-surface-container-high border-l border-white/10 z-[141] shadow-2xl flex flex-col overflow-hidden text-on-surface"
            >
              {/* Header */}
              <div className="p-6 border-b border-white/5 bg-surface-container flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sliders className="text-red-500 animate-pulse" size={20} />
                  <div>
                    <h2 className="font-headline italic font-black text-lg text-white uppercase leading-none">PAINEL DO CRIADOR</h2>
                    <p className="text-[10px] text-on-surface-variant uppercase tracking-wider mt-0.5">Sandbox de Verificação de Layouts</p>
                  </div>
                </div>
                <button
                  onClick={handleClose}
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-on-surface-variant hover:text-white transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="p-6 overflow-y-auto flex-grow">
                {sandboxContent}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-white/5 bg-surface-container text-center">
                <p className="text-[9px] text-on-surface-variant uppercase">
                  Desenvolvido com primor e segurança para Invictus Gym.
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
