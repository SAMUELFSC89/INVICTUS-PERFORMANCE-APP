import { useState } from 'react';
import { createPortal } from 'react-dom';
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
        className="fixed inset-0 z-[10020] min-h-[100dvh] overflow-y-auto bg-[#080704] text-white"
        style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)', paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 20px)' }}
      >
        <div className="sticky top-0 z-10 flex items-center gap-4 border-b border-[#F5A623]/15 bg-[#080704]/95 px-5 py-4 backdrop-blur-xl">
          <button onClick={onClose} className="cursor-pointer rounded-full border border-white/10 bg-white/5 p-2 text-white active:scale-95">
            <X size={22} />
          </button>
          <h2 className="font-headline text-lg font-black uppercase italic tracking-tight text-white">{doc.title}</h2>
        </div>
        <div className="mx-auto max-w-2xl whitespace-pre-line px-5 py-6 font-sans text-xs leading-relaxed text-white/72">
          {doc.text}
        </div>
      </motion.div>
    );
  };

  const overlay = (
    <div
      className="fixed inset-0 z-[10000] flex min-h-[100dvh] flex-col overflow-hidden bg-[#080704] text-white"
      style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 10px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Termos de Uso e Integridade"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_0%,rgba(245,166,35,.14),transparent_36%),radial-gradient(circle_at_0%_45%,rgba(245,166,35,.06),transparent_32%)]" />

      <div className="relative z-[1] flex-1 overflow-y-auto px-5 pb-40 pt-5">
        <div className="mx-auto w-full max-w-2xl">
          <header className="mb-8 space-y-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#F5A623]/25 bg-[#F5A623]/10 text-[#F5A623] shadow-[0_12px_30px_rgba(0,0,0,.35)]">
              <Shield size={29} />
            </div>
            <div>
              <span className="font-label text-[10px] font-black uppercase tracking-[.28em] text-[#F5A623]">INVICTUS PERFORMANCE</span>
              <h1 className="mt-2 font-headline text-[2.45rem] font-black uppercase italic leading-[.9] tracking-[-.035em] text-white sm:text-5xl">
                Termos de Uso<br />e Integridade
              </h1>
            </div>
            <p className="max-w-md font-label text-[11px] font-bold uppercase leading-relaxed tracking-[.12em] text-white/55">
              Leia as regras essenciais antes de continuar. O aceite fica registrado na sua conta.
            </p>
          </header>

          <div className="space-y-3">
            {[
              { type: 'usage' as const, title: 'Termos de Uso', icon: <ScrollText size={19} /> },
              { type: 'competition' as const, title: 'Dados de Saúde', icon: <Trophy size={19} /> },
              { type: 'privacy' as const, title: 'Privacidade', icon: <Lock size={19} /> },
              { type: 'prizes' as const, title: 'Desafios, Campeonatos e Coins', icon: <Scale size={19} /> },
              { type: 'challenges' as const, title: 'Integridade e Power Lift', icon: <Users size={19} /> },
            ].map(item => (
              <button
                key={item.type}
                onClick={() => setViewingDetail(item.type)}
                className="group flex w-full items-center justify-between rounded-[22px] border border-white/8 bg-[#11100E] p-4 text-left shadow-[0_10px_28px_rgba(0,0,0,.18)] transition active:scale-[.985]"
              >
                <div className="flex min-w-0 items-center gap-3.5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#F5A623]/15 bg-[#F5A623]/8 text-[#F5A623]">{item.icon}</div>
                  <span className="font-headline text-base font-black uppercase italic tracking-tight text-white">{item.title}</span>
                </div>
                <ChevronRight size={19} className="shrink-0 text-white/28 transition group-active:translate-x-1 group-active:text-[#F5A623]" />
              </button>
            ))}
          </div>

          <div className="mt-6 flex items-start gap-3 rounded-[22px] border border-[#F5A623]/14 bg-[#F5A623]/5 p-4">
            <AlertCircle className="mt-0.5 shrink-0 text-[#F5A623]" size={18} />
            <p className="font-label text-[10px] font-bold uppercase leading-relaxed tracking-[.08em] text-white/58">
              Atividades podem ser aprovadas, parcialmente consideradas, enviadas para revisão ou desconsideradas quando faltarem dados obrigatórios ou existirem sinais de manipulação. Você poderá solicitar revisão quando aplicável.
            </p>
          </div>
        </div>
      </div>

      <div
        className="relative z-[2] border-t border-[#F5A623]/12 bg-[#0A0907]/98 px-5 pb-4 pt-4 shadow-[0_-18px_40px_rgba(0,0,0,.42)] backdrop-blur-xl"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}
      >
        <div className="mx-auto w-full max-w-2xl space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3">
              <AlertCircle size={16} className="text-red-400" />
              <span className="font-label text-[10px] font-bold uppercase text-red-300">{error}</span>
            </div>
          )}

          <label className="group flex cursor-pointer items-start gap-3">
            <input type="checkbox" className="hidden" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            <div className={cn(
              'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 transition-all',
              accepted ? 'border-[#F5A623] bg-[#F5A623]' : 'border-white/20 bg-white/[.02] group-active:border-[#F5A623]/60'
            )}>
              {accepted && <Check size={18} className="text-black" />}
            </div>
            <span className="font-label text-[10px] font-black uppercase leading-relaxed tracking-[.07em] text-white/62">
              Li e concordo com os Termos de Uso e a Política de Privacidade. Permissões de saúde, GPS, câmera, vídeo e notificações serão solicitadas separadamente quando eu usar cada recurso.
            </span>
          </label>

          <button
            onClick={handleAccept}
            disabled={!accepted || loading}
            className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-[#F5A623] font-headline text-lg font-black uppercase italic tracking-[.12em] text-black shadow-[0_10px_30px_rgba(245,166,35,.18)] transition active:scale-[.985] disabled:cursor-not-allowed disabled:opacity-30"
          >
            {loading ? <div className="h-5 w-5 animate-spin rounded-full border-2 border-black border-t-transparent" /> : 'ACEITAR E CONTINUAR'}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {viewingDetail && <DetailView type={viewingDetail} onClose={() => setViewingDetail(null)} />}
      </AnimatePresence>
    </div>
  );

  return createPortal(overlay, document.body);
}
