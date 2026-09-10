import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Crown, Zap, Shield, Rocket, X, Users, Copy, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { useUser } from '../UserContext';
import { useNavigate } from 'react-router-dom';

interface ProModalProps {
  isOpen: boolean;
  onClose: () => void;
  reason?: string;
}

export function ProModal({ isOpen, onClose, reason }: ProModalProps) {
  const { user } = useUser();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const referralCode = user?.referralCode || (user?.uid ? user.uid.substring(0, 6).toUpperCase() : 'INVICTUS');
  const baseUrl = import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://www.invictusperformance.app.br');
  const inviteLink = `${baseUrl.replace(/\/$/, '')}/invite?ref=${referralCode}`;

  const handleCopyInvite = () => {
    const inviteText = `Vem treinar comigo no INVICTUS! 🏆🔥 Use meu código de indicação: ${referralCode}\n\nCadastre-se agora: ${inviteLink}`;
    navigator.clipboard.writeText(inviteText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const content = (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9500] flex items-center justify-center p-4" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 16px)', paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/88 backdrop-blur-md" />

          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-[32px] border border-[#F5A623]/20 bg-[#11100E] p-7 text-white shadow-2xl custom-scrollbar"
          >
            <div className="absolute right-0 top-0 h-64 w-64 -translate-y-1/2 translate-x-1/2 rounded-full bg-[#F5A623]/10 blur-[100px]" />
            <button onClick={onClose} className="absolute right-5 top-5 rounded-full bg-white/5 p-2 text-white/60 transition-colors hover:bg-white/10"><X size={20} /></button>

            <div className="relative z-10 space-y-6 text-center">
              <div className="inline-flex rounded-3xl bg-[#F5A623]/10 p-4 text-[#F5A623]"><Crown size={44} /></div>
              <div className="space-y-2">
                <h2 className="font-headline text-3xl font-black uppercase italic tracking-tighter">Invictus Pro</h2>
                <p className="px-4 text-sm font-medium text-white/55">{reason || 'Desbloqueie recursos avançados de saúde, integrações, relatórios e Invictus IA.'}</p>
              </div>

              <div className="grid grid-cols-1 gap-3 text-left md:grid-cols-2">
                <BenefitItem icon={<Zap size={18} />} title="Invictus IA" desc="Análises e recomendações personalizadas." />
                <BenefitItem icon={<Shield size={18} />} title="Saúde avançada" desc="Métricas, zonas cardíacas e integrações." />
                <BenefitItem icon={<Rocket size={18} />} title="Relatórios completos" desc="Acompanhe sua evolução em mais detalhes." />
                <BenefitItem icon={<Crown size={18} />} title="Sem vantagem competitiva" desc="A assinatura não altera sua pontuação ou ranking." />
              </div>

              <div className="relative space-y-4 overflow-hidden rounded-3xl border border-[#F5A623]/20 bg-[#F5A623]/5 p-5 text-left">
                <div className="relative z-10">
                  <div className="mb-1 flex items-center gap-2"><Users size={16} className="text-[#F5A623]" /><h4 className="font-headline text-sm font-black uppercase italic tracking-tight text-[#F5A623]">CÓDIGO DE CONVITE</h4></div>
                  <p className="text-[10px] font-bold uppercase leading-snug tracking-wider text-white/50">Convide outros atletas para treinar com você no Invictus.</p>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/5 p-1">
                  <span className="truncate px-4 font-mono text-sm font-black uppercase tracking-[0.2em] text-white">{referralCode}</span>
                  <button onClick={handleCopyInvite} className={cn('flex h-10 items-center gap-1.5 rounded-xl px-4 text-[9px] font-black uppercase tracking-wider transition-all', copied ? 'bg-emerald-500 text-black' : 'bg-[#F5A623] text-black')}>
                    {copied ? <Check size={12} strokeWidth={3} /> : <Copy size={12} strokeWidth={3} />}{copied ? 'COPIADO' : 'COPIAR'}
                  </button>
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <button onClick={() => { onClose(); navigate('/profile/preferences/subscriptions', { state: { returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}` } }); }} className="w-full rounded-[22px] bg-[#F5A623] py-4 font-headline text-lg font-black uppercase italic tracking-widest text-black shadow-lg shadow-[#F5A623]/15">VER PLANO PRO</button>
                <p className="text-[10px] font-black uppercase tracking-widest text-white/35">Preço e período confirmados pela App Store ou Google Play</p>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}

function BenefitItem({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) {
  return <div className="space-y-1 rounded-2xl border border-white/5 bg-white/5 p-4"><div className="text-[#F5A623]">{icon}</div><p className="text-xs font-black uppercase tracking-tight text-white">{title}</p><p className="text-[10px] leading-tight text-white/50">{desc}</p></div>;
}
