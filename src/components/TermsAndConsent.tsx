import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shield, ChevronRight, Check, AlertCircle, X, ScrollText, Lock, Trophy, Scale, Users } from 'lucide-react';
import { useUser } from '../UserContext';
import { userService } from '../services/userService';
import { cn } from '../lib/utils';
import { 
  LEGAL_TERMS_OF_USE, 
  LEGAL_PRIVACY_POLICY, 
  LEGAL_HEALTH_DATA_POLICY, 
  LEGAL_PROMOTIONAL_RULES, 
  LEGAL_ANTI_FRAUD_POLICY,
  CURRENT_LEGAL_VERSION
} from '../lib/legalDocuments';

export const CURRENT_TERMS_VERSION = CURRENT_LEGAL_VERSION;

export function TermsAndConsent() {
  const { user, refreshUser } = useUser();
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewingDetail, setViewingDetail] = useState<'usage' | 'privacy' | 'competition' | 'prizes' | 'challenges' | null>(null);

  if (!user) return null;

  const needsAcceptance = !user.termsVersionAccepted || user.termsVersionAccepted < CURRENT_TERMS_VERSION;

  if (!needsAcceptance) return null;

  const handleAccept = async () => {
    if (!accepted) return;
    setLoading(true);
    setError(null);
    try {
      await userService.updateProfile({
        termsVersionAccepted: CURRENT_TERMS_VERSION,
        termsAcceptedAt: new Date().toISOString(),
        termsAccepted: true
      });
      await refreshUser();
    } catch (err: any) {
      console.error('Error accepting terms:', err);
      setError('Falha na conexão. Verifique sua internet e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const DetailView = ({ type, onClose }: { type: 'usage' | 'privacy' | 'competition' | 'prizes' | 'challenges', onClose: () => void }) => {
    const rawTextMap = {
      usage: { title: 'Termos de Uso da Plataforma', text: LEGAL_TERMS_OF_USE },
      privacy: { title: 'Política de Privacidade e Proteção de Dados', text: LEGAL_PRIVACY_POLICY },
      competition: { title: 'Dados de Saúde e Wearables', text: LEGAL_HEALTH_DATA_POLICY },
      prizes: { title: 'Desafios, Campeonatos, XP e Coins', text: LEGAL_PROMOTIONAL_RULES },
      challenges: { title: 'Integridade, Power Lift e Revisão', text: LEGAL_ANTI_FRAUD_POLICY }
    };

    const doc = rawTextMap[type];

    return (
      <motion.div 
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        className="fixed inset-0 z-[200] bg-background p-6 overflow-y-auto"
      >
        <div className="flex items-center gap-4 mb-6 sticky top-0 bg-background/95 backdrop-blur-md pt-2 pb-4 border-b border-outline-variant/10 z-10">
          <button onClick={onClose} className="p-2 hover:bg-surface-container-high rounded-full cursor-pointer">
            <X size={24} />
          </button>
          <h2 className="font-headline italic font-black text-xl uppercase tracking-tighter text-on-surface">{doc.title}</h2>
        </div>
        <div className="space-y-4 pb-12 text-xs text-on-surface-variant font-sans whitespace-pre-line leading-relaxed">
          {doc.text}
        </div>
      </motion.div>
    );
  };

  return (
    <div className="fixed inset-0 z-[150] bg-background flex flex-col pt-12">
      <div className="flex-1 overflow-y-auto px-6 pb-32">
        <header className="mb-12 space-y-4">
          <div className="w-16 h-16 bg-primary/20 rounded-[20px] flex items-center justify-center text-primary shadow-xl shadow-primary/10">
            <Shield size={32} />
          </div>
          <h1 className="font-headline italic font-black text-4xl uppercase tracking-tighter text-on-surface leading-none">Termos de Uso<br/>e Integridade</h1>
          <p className="font-label text-xs font-black text-on-surface-variant uppercase tracking-widest">Sua jornada saudável e transparente começa aqui</p>
        </header>

        <div className="space-y-3">
          <button 
            onClick={() => setViewingDetail('usage')}
            className="w-full flex items-center justify-between p-5 bg-surface-container-low rounded-3xl border border-outline-variant/10 group active:scale-95 transition-all text-left"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-500/10 text-blue-500 rounded-2xl"><ScrollText size={20} /></div>
              <span className="font-headline italic font-black text-lg uppercase tracking-tight">Termos de Uso</span>
            </div>
            <ChevronRight size={20} className="text-on-surface-variant/30 group-hover:text-primary group-hover:translate-x-1 transition-all" />
          </button>

          <button 
            onClick={() => setViewingDetail('competition')}
            className="w-full flex items-center justify-between p-5 bg-surface-container-low rounded-3xl border border-outline-variant/10 group active:scale-95 transition-all text-left"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 bg-primary/10 text-primary rounded-2xl"><Trophy size={20} /></div>
              <span className="font-headline italic font-black text-lg uppercase tracking-tight">Dados de Saúde</span>
            </div>
            <ChevronRight size={20} className="text-on-surface-variant/30 group-hover:text-primary group-hover:translate-x-1 transition-all" />
          </button>

          <button 
            onClick={() => setViewingDetail('privacy')}
            className="w-full flex items-center justify-between p-5 bg-surface-container-low rounded-3xl border border-outline-variant/10 group active:scale-95 transition-all text-left"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 bg-green-500/10 text-green-500 rounded-2xl"><Lock size={20} /></div>
              <span className="font-headline italic font-black text-lg uppercase tracking-tight">Privacidade</span>
            </div>
            <ChevronRight size={20} className="text-on-surface-variant/30 group-hover:text-primary group-hover:translate-x-1 transition-all" />
          </button>

          <button 
            onClick={() => setViewingDetail('prizes')}
            className="w-full flex items-center justify-between p-5 bg-surface-container-low rounded-3xl border border-outline-variant/10 group active:scale-95 transition-all text-left"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 bg-amber-500/10 text-amber-500 rounded-2xl"><Scale size={20} /></div>
              <span className="font-headline italic font-black text-lg uppercase tracking-tight">Desafios, Campeonatos e Coins</span>
            </div>
            <ChevronRight size={20} className="text-on-surface-variant/30 group-hover:text-primary group-hover:translate-x-1 transition-all" />
          </button>

          <button 
            onClick={() => setViewingDetail('challenges')}
            className="w-full flex items-center justify-between p-5 bg-surface-container-low rounded-3xl border border-outline-variant/10 group active:scale-95 transition-all text-left"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 bg-indigo-500/10 text-indigo-500 rounded-2xl"><Users size={20} /></div>
              <span className="font-headline italic font-black text-lg uppercase tracking-tight">Integridade e Power Lift</span>
            </div>
            <ChevronRight size={20} className="text-on-surface-variant/30 group-hover:text-primary group-hover:translate-x-1 transition-all" />
          </button>
        </div>

        <div className="mt-8 p-6 bg-error/5 rounded-3xl border border-error/10 flex items-start gap-4">
          <AlertCircle className="text-error shrink-0" size={20} />
          <p className="text-on-surface-variant font-label text-[10px] uppercase font-bold leading-relaxed">
            Atividades podem ser aprovadas, parcialmente consideradas, enviadas para revisão ou desconsideradas quando faltarem dados obrigatórios ou existirem sinais de manipulação. Você poderá solicitar revisão quando aplicável.
          </p>
        </div>
      </div>

      <div className="bg-surface-container p-8 border-t border-outline-variant/10 space-y-6">
        {error && (
          <div className="p-3 bg-error/10 border border-error/20 rounded-xl flex items-center gap-2 mb-2 animate-in fade-in slide-in-from-bottom-2">
            <AlertCircle size={16} className="text-error" />
            <span className="text-error font-label text-[10px] font-bold uppercase">{error}</span>
          </div>
        )}
        <label className="flex items-center gap-4 cursor-pointer group">
          <input 
            type="checkbox" 
            className="hidden" 
            checked={accepted} 
            onChange={(e) => setAccepted(e.target.checked)} 
          />
          <div 
            className={cn(
              "w-8 h-8 rounded-xl border-2 transition-all flex items-center justify-center shrink-0 shadow-lg",
              accepted ? "bg-primary border-primary rotate-0" : "bg-transparent border-outline-variant/30 -rotate-12 group-hover:border-primary/50 group-hover:rotate-0"
            )}
          >
            {accepted && <Check size={20} className="text-on-primary animate-in zoom-in" />}
          </div>
          <span className="font-label text-xs font-black uppercase text-on-surface-variant tracking-wider leading-tight">
            Li e concordo com os Termos de Uso e a Política de Privacidade. Permissões de saúde, GPS, câmera, vídeo e notificações serão solicitadas separadamente quando eu usar cada recurso.
          </span>
        </label>

        <button 
          onClick={handleAccept}
          disabled={!accepted || loading}
          className="w-full h-16 bg-primary text-on-primary rounded-2xl font-headline italic font-black text-xl uppercase tracking-widest shadow-xl shadow-primary/20 disabled:opacity-30 active:scale-95 transition-all flex items-center justify-center gap-3"
        >
          {loading ? (
            <div className="w-6 h-6 border-2 border-on-primary border-t-transparent rounded-full animate-spin" />
          ) : (
            "ACEITAR E CONTINUAR"
          )}
        </button>
      </div>

      <AnimatePresence>
        {viewingDetail && (
          <DetailView type={viewingDetail} onClose={() => setViewingDetail(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
