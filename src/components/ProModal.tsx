import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Crown, Zap, Shield, Rocket, X, Users, Copy, Check, Share2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useUser } from '../UserContext';

interface ProModalProps {
  isOpen: boolean;
  onClose: () => void;
  reason?: string;
}

export function ProModal({ isOpen, onClose, reason }: ProModalProps) {
  const { user } = useUser();
  const [copied, setCopied] = useState(false);

  const referralCode = user?.referralCode || (user?.uid ? user.uid.substring(0, 6).toUpperCase() : 'INVICTUS');
  const baseUrl = import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://www.invictusperformance.app.br');
  const inviteLink = `${baseUrl.replace(/\/$/, '')}/invite?ref=${referralCode}`;

  const handleCopyInvite = () => {
    const inviteText = `Vem treinar comigo na Elite PRO do INVICTUS! 🏆🔥 Desenvolva sua força na academia oficial e dispute o ranking usando meu código de indicação: ${referralCode}\n\nCadastre-se agora: ${inviteLink}`;
    navigator.clipboard.writeText(inviteText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="relative w-full max-w-lg bg-surface-container rounded-[40px] border border-primary/20 p-8 shadow-2xl overflow-y-auto max-h-[90vh] custom-scrollbar"
          >
            {/* Background elements */}
            <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-64 h-64 bg-primary/10 blur-[100px] rounded-full" />
            
            <button 
              onClick={onClose}
              className="absolute top-6 right-6 p-2 rounded-full bg-white/5 hover:bg-white/10 text-on-surface-variant transition-colors"
            >
              <X size={20} />
            </button>

            <div className="relative z-10 space-y-6 text-center">
              <div className="inline-flex p-4 rounded-3xl bg-primary/10 text-primary">
                <Crown size={48} className="drop-shadow-[0_0_20px_rgba(255,184,0,0.5)]" />
              </div>

              <div className="space-y-2">
                <h2 className="font-headline italic font-black text-3xl uppercase tracking-tighter">
                  Junte-se à Elite PRO
                </h2>
                <p className="text-on-surface-variant font-medium text-sm px-4">
                  {reason || "Nossa infraestrutura gratuita atingiu o limite de tráfego. Como atleta PRO, você tem prioridade em todos os serviços."}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-left">
                <BenefitItem 
                  icon={<Zap size={18} />} 
                  title="Conexão Instantânea" 
                  desc="Sem filas ou limites de servidor." 
                />
                <BenefitItem 
                  icon={<Shield size={18} />} 
                  title="Validação Prioritária" 
                  desc="Suas atividades são aprovadas na hora." 
                />
                <BenefitItem 
                  icon={<Rocket size={18} />} 
                  title="Features Exclusivas" 
                  desc="Acesso a rankings e métricas avançadas." 
                />
                <BenefitItem 
                  icon={<Crown size={18} />} 
                  title="Selo de Elite" 
                  desc="Destaque total no ranking oficial." 
                />
              </div>

              {/* Invitation and referral module (envio de convite para pro) */}
              <div className="p-5 rounded-3xl bg-primary/5 border border-primary/20 text-left space-y-4 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-2xl pointer-events-none" />
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-1">
                    <Users size={16} className="text-primary" />
                    <h4 className="font-headline italic font-black text-sm text-primary uppercase tracking-tight">CÓDIGO DE CONVITE PRO</h4>
                  </div>
                  <p className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider leading-snug">
                    Convide outros atletas para a membresia PRO e receba bônus de consistência diária!
                  </p>
                </div>

                <div className="flex bg-surface-container-high rounded-2xl p-1 border border-white/5 items-center justify-between">
                  <span className="font-mono text-sm font-black text-white px-4 tracking-[0.2em] uppercase truncate">{referralCode}</span>
                  <button 
                    onClick={handleCopyInvite}
                    className={cn(
                      "h-10 px-4 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all duration-300 flex items-center gap-1.5",
                      copied 
                        ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20" 
                        : "bg-primary hover:bg-primary/95 text-black hover:scale-[1.02] active:scale-[0.98]"
                    )}
                  >
                    {copied ? <Check size={12} strokeWidth={3} /> : <Copy size={12} strokeWidth={3} />}
                    {copied ? "COPIADO" : "ENVIAR CONVITE"}
                  </button>
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <button 
                  onClick={() => {
                    alert('Obrigado pelo interesse! Nosso sistema PRO está em manutenção para melhor atendê-los.');
                    onClose();
                  }}
                  className="w-full py-5 bg-gradient-to-r from-primary to-orange-500 text-black rounded-[24px] font-headline italic font-black text-lg uppercase tracking-widest hover:scale-[1.02] transition-transform shadow-lg shadow-primary/20"
                >
                  TENHO INTERESSE NO PRO
                </button>
                
                <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest opacity-40">
                  Planos a partir de apenas R$ 9,99/mês
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function BenefitItem({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) {
  return (
    <div className="bg-white/5 p-4 rounded-2xl border border-white/5 space-y-1">
      <div className="text-primary">{icon}</div>
      <p className="text-xs font-black uppercase tracking-tight text-white">{title}</p>
      <p className="text-[10px] text-on-surface-variant leading-tight">{desc}</p>
    </div>
  );
}
