import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Trophy, Coins, Zap, Award, Share2, CheckCircle2, Clock, Sparkles, ArrowRight, ShieldCheck, Gift } from 'lucide-react';
import { cn } from '../lib/utils';

export interface ChallengeDetail {
  id: string;
  title: string;
  category: 'diario' | 'semanal' | 'mensal' | 'novos' | 'temporada' | 'epico' | 'patrocinado' | 'conquista';
  objective: string;
  description: string;
  currentProgress: number;
  totalGoal: number;
  unit: string;
  timeRemaining?: string;
  xpReward: number;
  coinsReward: number;
  badge?: string;
  sponsorName?: string;
  sponsorLogo?: string;
  perks?: string[];
  isCompleted?: boolean;
  completedDate?: string;
  isEpic?: boolean;
  actionType?: 'workout' | 'cardio' | 'diet' | 'recovery' | 'social' | 'league' | 'custom';
}

interface ChallengeDetailModalProps {
  challenge: ChallengeDetail | null;
  onClose: () => void;
  onTrackAction?: (challenge: ChallengeDetail) => void;
  onShareAction?: (challenge: ChallengeDetail) => void;
}

export function ChallengeDetailModal({
  challenge,
  onClose,
  onTrackAction,
  onShareAction,
}: ChallengeDetailModalProps) {
  if (!challenge) return null;

  const percent = Math.min(100, Math.round((challenge.currentProgress / challenge.totalGoal) * 100));

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className={cn(
            "w-full max-w-lg bg-surface-container rounded-[36px] border overflow-hidden shadow-2xl relative p-6 sm:p-8 space-y-6",
            challenge.isEpic 
              ? "border-amber-500/40 shadow-amber-500/10 bg-gradient-to-b from-surface-container via-surface-container to-amber-950/20"
              : challenge.sponsorName
              ? "border-emerald-500/30 shadow-emerald-500/10"
              : "border-white/10"
          )}
        >
          {/* Header Close & Badge */}
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "font-label text-[9px] font-black uppercase tracking-[0.25em] px-2.5 py-0.5 rounded-full border",
                  challenge.isEpic
                    ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                    : challenge.sponsorName
                    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                    : "bg-primary/10 text-primary border-primary/20"
                )}>
                  {challenge.isEpic ? '⭐ DESAFIO ÉPICO' : challenge.sponsorName ? `🤝 PATROCINADO POR ${challenge.sponsorName.toUpperCase()}` : `DESAFIO ${challenge.category.toUpperCase()}`}
                </span>
                {challenge.isCompleted && (
                  <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-label text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full flex items-center gap-1">
                    <CheckCircle2 size={10} /> CONCLUÍDO
                  </span>
                )}
              </div>
              <h2 className="font-headline italic font-black text-2xl sm:text-3xl uppercase tracking-tighter text-white leading-tight pt-1">
                {challenge.title}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-on-surface-variant hover:text-white transition-all shrink-0"
            >
              <X size={20} />
            </button>
          </div>

          {/* Goal & Description */}
          <div className="bg-surface-container-high/60 border border-white/5 rounded-3xl p-5 space-y-3">
            <div>
              <span className="font-label text-[8px] font-black text-on-surface-variant uppercase tracking-widest block mb-1">
                OBJETIVO PRINCIPAL
              </span>
              <p className="font-headline italic font-black text-base text-white uppercase tracking-tight">
                {challenge.objective}
              </p>
            </div>
            <p className="text-xs text-on-surface-variant font-medium leading-relaxed">
              {challenge.description}
            </p>

            {challenge.sponsorName && challenge.perks && challenge.perks.length > 0 && (
              <div className="pt-3 border-t border-white/5 space-y-1.5">
                <span className="font-label text-[8px] font-black text-emerald-400 uppercase tracking-widest flex items-center gap-1">
                  <Gift size={12} /> RECOMPENSAS DE PATROCÍNIO
                </span>
                <ul className="space-y-1">
                  {challenge.perks.map((perk, i) => (
                    <li key={i} className="text-[11px] text-white font-semibold flex items-center gap-1.5">
                      <span className="text-emerald-400">✓</span> {perk}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs font-black uppercase tracking-wider">
              <span className="text-on-surface-variant">SEU PROGRESSO</span>
              <span className={cn(challenge.isCompleted ? "text-emerald-400" : "text-primary")}>
                {challenge.currentProgress} de {challenge.totalGoal} {challenge.unit} ({percent}%)
              </span>
            </div>

            <div className="h-3 bg-surface-container-high rounded-full overflow-hidden p-0.5 border border-white/5">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${percent}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className={cn(
                  "h-full rounded-full transition-all",
                  challenge.isCompleted
                    ? "bg-emerald-400 shadow-glow-emerald"
                    : challenge.isEpic
                    ? "bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500"
                    : "bg-primary shadow-glow-primary"
                )}
              />
            </div>

            {challenge.timeRemaining && (
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider pt-1">
                <Clock size={12} className="text-primary" />
                <span>Tempo restante: <strong className="text-white font-mono">{challenge.timeRemaining}</strong></span>
              </div>
            )}

            {challenge.completedDate && (
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400 uppercase tracking-wider pt-1">
                <CheckCircle2 size={12} />
                <span>Conquistado em: {challenge.completedDate}</span>
              </div>
            )}
          </div>

          {/* Rewards Grid */}
          <div className="space-y-2">
            <span className="font-label text-[8px] font-black text-on-surface-variant uppercase tracking-widest block">
              RECOMPENSAS AO CONCLUIR
            </span>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-surface-container-high/80 p-3.5 rounded-2xl border border-white/5 text-center flex flex-col items-center justify-center space-y-1">
                <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <Zap size={16} />
                </div>
                <span className="font-headline italic font-black text-base text-primary leading-none">
                  +{challenge.xpReward}
                </span>
                <span className="text-[8px] font-black text-on-surface-variant uppercase tracking-wider">XP</span>
              </div>

              <div className="bg-surface-container-high/80 p-3.5 rounded-2xl border border-white/5 text-center flex flex-col items-center justify-center space-y-1">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                  <Coins size={16} />
                </div>
                <span className="font-headline italic font-black text-base text-emerald-400 leading-none">
                  +R$ {challenge.coinsReward}
                </span>
                <span className="text-[8px] font-black text-on-surface-variant uppercase tracking-wider">PRÊMIO R$</span>
              </div>

              <div className="bg-surface-container-high/80 p-3.5 rounded-2xl border border-white/5 text-center flex flex-col items-center justify-center space-y-1">
                <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center">
                  <Award size={16} />
                </div>
                <span className="font-headline italic font-black text-xs text-purple-300 leading-none uppercase truncate max-w-full">
                  {challenge.badge || 'BADGE ELITE'}
                </span>
                <span className="text-[8px] font-black text-on-surface-variant uppercase tracking-wider">INSÍGNIA</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            {!challenge.isCompleted && onTrackAction && (
              <button
                onClick={() => onTrackAction(challenge)}
                className="flex-1 py-4 bg-primary hover:bg-primary/90 text-black rounded-2xl font-headline italic font-black text-sm uppercase tracking-wider shadow-lg shadow-primary/20 flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer"
              >
                <span>ACOMPANHAR</span>
                <ArrowRight size={16} />
              </button>
            )}

            {onShareAction && (
              <button
                onClick={() => onShareAction(challenge)}
                className={cn(
                  "py-4 px-5 bg-surface-container-high hover:bg-surface-container-highest text-white border border-white/10 rounded-2xl font-headline italic font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer",
                  challenge.isCompleted ? "flex-1" : ""
                )}
              >
                <Share2 size={16} />
                <span>COMPARTILHAR</span>
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
