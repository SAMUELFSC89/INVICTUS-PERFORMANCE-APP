import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { History, ChevronRight } from 'lucide-react';
import { getXPProgress, getLevelTitle, getBarbellWeight } from '../lib/levelUtils';
import { UserProfile } from '../types';

interface PremiumLevelCardProps {
  user: UserProfile;
}

export function PremiumLevelCard({ user }: PremiumLevelCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const hasServerXP = typeof user.xp === 'number' && Number.isFinite(user.xp) && user.xp >= 0;
  const progressSnap = getXPProgress(hasServerXP ? user.xp : 0);
  const rankTitle = hasServerXP ? getLevelTitle(progressSnap.currentLevel) : 'AGUARDANDO DADOS';

  // Formatted numbers for presentation
  const currentXP = hasServerXP ? user.xp : null;
  const xpInCurrentLevel = progressSnap.xpInCurrentLevel;
  const xpNeededForNextLevel = progressSnap.xpNeededForNextLevel;
  const nextLevel = progressSnap.nextLevel;
  const percentage = progressSnap.percentage;

  return (
    <>
      {/* Visual Premium Level Widget Component (The requested AAA look) */}
      <div 
        onClick={() => setIsModalOpen(true)}
        className="relative overflow-hidden cursor-pointer select-none group w-full bg-surface-container-low border border-white/[0.04] p-5 rounded-2xl shadow-xl hover:shadow-[0_0_20px_rgba(255,204,0,0.06)] hover:border-primary/30 transition-all active:scale-[0.98]"
        title="Progresso de Nível - Toque para detalhes"
      >
        {/* Dynamic Glowing Aura behind */}
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-primary/5 group-hover:bg-primary/8 rounded-full blur-2xl transition-all" />
        
        <div className="flex justify-between items-center mb-3">
          <div className="space-y-0.5">
            <span className="text-[9px] font-black uppercase tracking-[0.25em] text-on-surface-variant/70 leading-none">
              INVICTUS RANK
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-black uppercase text-primary italic font-headline tracking-tighter">
                {rankTitle}
              </span>
              {hasServerXP && <><span className="w-1 h-1 bg-white/20 rounded-full" /><span className="text-[10px] font-bold text-on-surface-variant uppercase">
                {getBarbellWeight(progressSnap.currentLevel)} KG
              </span></>}
            </div>
          </div>
          
          {/* LEVEL NUMBER (Extremely high priority and highlighted) */}
          <div className="relative flex items-center justify-center shrink-0">
            <motion.div 
              whileHover={{ rotate: 5, scale: 1.05 }}
              className="relative z-10 w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-amber-400 p-[1.5px] shadow-lg shadow-primary/10 flex items-center justify-center"
            >
              <div className="w-full h-full bg-black/90 rounded-[11px] flex flex-col justify-center items-center">
                <span className="text-[7px] text-primary font-black uppercase leading-none tracking-widest -mb-0.5">LVL</span>
                <span className="text-xl font-bold italic font-headline text-white leading-none">
                  {hasServerXP ? progressSnap.currentLevel : '—'}
                </span>
              </div>
            </motion.div>
            {/* Soft pulsing halo */}
            <div className="absolute inset-0 bg-primary/20 rounded-xl blur-md scale-110 pointer-events-none group-hover:scale-125 transition-transform" />
          </div>
        </div>

        {/* Minimalist Tech Barbell Bar Rendering */}
        <div className="space-y-1.5 relative z-10">
          {/* BAR PROGRESS */}
          <div className="h-2 w-full bg-surface-container-highest p-[2px] rounded-full overflow-hidden border border-white/5 relative flex items-center">
            <motion.div 
              className="h-full bg-gradient-to-r from-primary to-amber-400 rounded-full relative shadow-[0_0_8px_rgba(255,204,0,0.4)]"
              initial={{ width: 0 }}
              animate={{ width: hasServerXP ? `${percentage}%` : '0%' }}
              transition={{ duration: 1.2, ease: "easeOut" }}
            >
              <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.2)_50%,transparent_100%)] w-2/3 h-full animate-[shimmer_2s_infinite]" />
            </motion.div>
          </div>

          <div className="flex justify-between items-center text-[9px] font-black uppercase text-on-surface-variant/80">
            <span>{hasServerXP ? `${xpInCurrentLevel} / ${xpNeededForNextLevel} XP` : 'XP aguardando sincronização'}</span>
            {hasServerXP && <span className="text-primary tracking-tight font-extrabold flex items-center gap-0.5">
              PROX {nextLevel} <ChevronRight size={10} className="stroke-2" />
            </span>}
          </div>
        </div>
      </div>

      {/* Elegant Detailed Progression Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 backdrop-blur-md p-4"
            onClick={() => setIsModalOpen(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-md bg-surface-container rounded-[36px] border border-white/10 p-6 shadow-2xl overflow-hidden"
            >
              {/* Radial gradient backing */}
              <div className="absolute -top-32 -left-32 w-80 h-80 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-32 -right-32 w-80 h-80 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

              {/* Close Button */}
              <button 
                onClick={() => setIsModalOpen(false)}
                className="absolute top-4 right-4 text-on-surface-variant hover:text-white transition-colors w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>

              <div className="text-center space-y-4 mb-6">
                <span className="inline-flex px-3 py-1 bg-primary/10 border border-primary/20 rounded-full text-[8px] font-black uppercase tracking-widest text-primary">
                  SISTEMA DE PRESTÍGIO INVICTUS
                </span>
                
                {/* Huge Highlighted Level Shield */}
                <div className="relative mx-auto w-24 h-24 rounded-3xl bg-gradient-to-br from-primary to-amber-400 p-[2px] shadow-2xl flex items-center justify-center">
                  <div className="w-full h-full bg-black/95 rounded-[22px] flex flex-col justify-center items-center">
                    <span className="text-[9px] text-primary font-black uppercase leading-none tracking-[0.2em] mb-1">LEVEL</span>
                    <span className="text-5xl font-black italic font-headline text-white leading-none">
                      {hasServerXP ? progressSnap.currentLevel : '—'}
                    </span>
                  </div>
                  <div className="absolute -bottom-2 bg-gradient-to-r from-primary to-amber-500 text-black px-4 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest whitespace-nowrap shadow-md">
                    {rankTitle}
                  </div>
                </div>

                <div className="pt-2">
                  {hasServerXP && <p className="text-[10px] font-black text-on-surface-variant uppercase tracking-widest">
                    HALTER ATUAL: {getBarbellWeight(progressSnap.currentLevel)} KG
                  </p>}
                  <p className="text-xs text-on-surface-variant font-medium mt-1">
                    {hasServerXP ? 'Seu nível é atualizado apenas após atividades homologadas.' : 'O nível será exibido quando o servidor disponibilizar o histórico de XP validado.'}
                  </p>
                </div>
              </div>

              {/* Advanced XP HUD Panel */}
              <div className="bg-surface-container-high/60 border border-white/5 rounded-2xl p-4 space-y-3 mb-5">
                <div className="flex justify-between items-center text-[10px] font-black uppercase text-on-surface-variant">
                  <span>PROGRESSO GERAL</span>
                  <span className="text-primary">{hasServerXP ? `${Math.round(percentage)}%` : '—'}</span>
                </div>
                
                {/* Glow Bar */}
                <div className="h-3 w-full bg-surface-container-highest p-[2px] rounded-full overflow-hidden border border-white/5 relative flex items-center shadow-inner">
                  <motion.div 
                    className="h-full bg-gradient-to-r from-primary to-amber-400 rounded-full relative"
                    initial={{ width: 0 }}
                    animate={{ width: hasServerXP ? `${percentage}%` : '0%' }}
                    transition={{ duration: 1.2, ease: "easeOut" }}
                  >
                    <div className="absolute inset-0 bg-primary/25 blur-sm" />
                  </motion.div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5 text-center">
                  <div>
                    <span className="text-[8px] font-black text-on-surface-variant uppercase block">XP TOTAL</span>
                    <span className="text-sm font-black italic font-headline text-white">{currentXP === null ? '—' : `${currentXP.toLocaleString()} XP`}</span>
                  </div>
                  <div>
                    <span className="text-[8px] font-black text-on-surface-variant uppercase block">{hasServerXP ? `FALTA PARA LVL ${nextLevel}` : 'PRÓXIMO NÍVEL'}</span>
                    <span className="text-sm font-black italic font-headline text-primary">{hasServerXP ? `${(xpNeededForNextLevel - xpInCurrentLevel).toLocaleString()} XP` : '—'}</span>
                  </div>
                </div>
              </div>

              {/* Recent XP Contributions */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 px-1 py-0.5">
                  <History size={12} className="text-primary" />
                  <span className="text-[9px] font-black text-on-surface-variant uppercase tracking-widest">HISTÓRICO RECENTE DE XP</span>
                </div>

                <div className="rounded-xl border border-white/[0.05] bg-surface-container-low p-3 text-xs text-on-surface-variant">
                  O detalhamento de ganhos de XP será exibido quando estiver disponível no histórico homologado do servidor.
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-2">
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="w-full py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all"
                >
                  FECHAR JANELA
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </>
  );
}
