import React, { useState, useEffect, useCallback } from 'react';
import {
  Target, Lock, CheckCircle2, TrendingUp, X, Loader2, Flame,
  ChevronRight, Sparkles, AlertCircle, Trophy, Share2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import {
  getActiveHabit,
  createHabit,
  cancelHabit,
  revealNextMilestone,
  HabitGoal,
  HabitGoalType,
} from '../services/habitService';
import { HabitShareCard } from './HabitShareCard';

const GOAL_TYPE_OPTIONS: { value: HabitGoalType; label: string }[] = [
  { value: 'start_running', label: 'Começar a correr' },
  { value: 'walk_regularly', label: 'Caminhar com regularidade' },
  { value: 'cycling', label: 'Pedalar' },
  { value: 'improve_conditioning', label: 'Melhorar o condicionamento' },
  { value: 'reach_distance', label: 'Alcançar uma distância' },
  { value: 'custom', label: 'Meu próprio objetivo' },
];

/**
 * Self-contained section for the "Criar Hábito" feature, meant to be dropped
 * into the existing Cardio/Desafios area without touching the CORE_CHALLENGES
 * grid or any existing cardio submission flow. It only reads/writes via
 * habitService (/api/habits) and never touches scoring directly — progress is
 * applied server-side, inside the same transaction that commits cardio score.
 */
export function HabitTrackerSection() {
  const [loading, setLoading] = useState(true);
  const [habit, setHabit] = useState<HabitGoal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
const [revealing, setRevealing] = useState(false);
const [celebrationText, setCelebrationText] = useState<string | null>(null);
const [showShareCard, setShowShareCard] = useState(false);

  const [goalType, setGoalType] = useState<HabitGoalType>('start_running');
  const [targetDistanceKm, setTargetDistanceKm] = useState('5');
  const [deadlineDays, setDeadlineDays] = useState('30');
  const [weeklyFrequency, setWeeklyFrequency] = useState('3');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const active = await getActiveHabit();
      setHabit(active);
    } catch (e: any) {
      setError(e?.message || 'Não foi possível carregar seu hábito.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const created = await createHabit({
        goalType,
        targetDistanceKm: parseFloat(targetDistanceKm) || 1,
        deadlineDays: parseInt(deadlineDays, 10) || 30,
        weeklyFrequency: parseInt(weeklyFrequency, 10) || 3,
      });
      setHabit(created);
      setCreating(false);
    } catch (e: any) {
      setError(e?.message || 'Não foi possível criar o hábito.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!habit) return;
    setCancelling(true);
    setError(null);
    try {
      await cancelHabit(habit.id);
      setHabit(null);
      setConfirmCancel(false);
    } catch (e: any) {
      setError(e?.message || 'Não foi possível cancelar o hábito.');
    } finally {
      setCancelling(false);
    }
  };

  const handleReveal = async () => {
    if (!habit) return;
    setRevealing(true);
    setError(null);
    try {
      const result = await revealNextMilestone(habit.id);
      setHabit(result.habit);
      setCelebrationText(result.celebrationText);
    } catch (e: any) {
      setError(e?.message || 'Não foi possível revelar o próximo desafio.');
    } finally {
      setRevealing(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-surface-card border border-white/10 rounded-2xl p-5 flex items-center gap-3 text-text-secondary text-sm">
        <Loader2 size={16} className="animate-spin" />
        Carregando seu hábito de cardio...
      </div>
    );
  }

  // ACTIVE HABIT VIEW
  if (habit) {
    const currentMilestone = habit.milestones.find(m => m.order === habit.currentMilestoneIndex);
    const totalMilestones = habit.milestones.length;

    return (
      <div className="bg-surface-card border border-primary/20 rounded-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/10 rounded-xl border border-primary/20">
              <Target size={20} className="text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Hábito de Cardio</h3>
              <p className="text-xs text-text-secondary">
                {GOAL_TYPE_OPTIONS.find(g => g.value === habit.goalType)?.label || 'Objetivo pessoal'}
              </p>
            </div>
          </div>
          {!confirmCancel ? (
            <button
              onClick={() => setConfirmCancel(true)}
              className="text-[11px] text-text-secondary hover:text-red-400 transition-colors"
            >
              Cancelar
            </button>
          ) : (
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-text-secondary">Tem certeza?</span>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="text-red-400 font-semibold hover:underline"
              >
                {cancelling ? '...' : 'Sim'}
              </button>
              <button onClick={() => setConfirmCancel(false)} className="text-text-secondary hover:underline">
                Não
              </button>
            </div>
          )}
        </div>

        {/* Milestone stepper: locked milestones only show a lock icon — never their target. */}
        <div className="flex items-center gap-1.5">
          {habit.milestones.map((m) => (
            <div
              key={m.order}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors',
                m.status === 'completed'
                  ? 'bg-emerald-500'
                  : m.status === 'active'
                  ? 'bg-primary'
                  : 'bg-white/10'
              )}
            />
          ))}
        </div>

        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span>
            Marco {habit.currentMilestoneIndex + 1} de {totalMilestones}
          </span>
          <span className="flex items-center gap-1">
            <Flame size={12} className="text-orange-400" />
            {habit.totalSessionsCompleted} sessões registradas
          </span>
        </div>

        {currentMilestone && currentMilestone.status === 'active' && (
          <div className="bg-black/20 border border-white/5 rounded-xl p-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-secondary">Meta do marco atual</span>
              <span className="text-white font-semibold">
                {currentMilestone.targetDistanceKm?.toFixed(1)} km
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-secondary">Sessões</span>
              <span className="text-white font-semibold">
                {currentMilestone.completedSessions || 0} / {currentMilestone.requiredSessions}
              </span>
            </div>
            <p className="text-[11px] text-text-secondary/80 pt-1">
              Os próximos marcos permanecem em segredo — continue registrando seu cardio normalmente.
            </p>
          </div>
        )}

        {habit.pendingReveal && !celebrationText && (
          <div className="bg-gradient-to-br from-primary/20 to-black/20 border border-primary/30 rounded-xl p-4 space-y-3 text-center">
            <Trophy size={28} className="mx-auto text-yellow-400" />
            <p className="text-sm font-bold text-white">🎉 Meta concluída! Você acaba de desbloquear uma nova etapa da sua evolução.</p>
            <button
              onClick={handleReveal}
              disabled={revealing}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-sm transition-colors disabled:opacity-60"
            >
              {revealing ? <Loader2 size={14} className="animate-spin" /> : '[ REVELAR PRÓXIMA META ]'}
            </button>
          </div>
        )}

        {celebrationText && (
          <div className="bg-black/20 border border-primary/20 rounded-xl p-4 space-y-2 text-center">
            <Sparkles size={24} className="mx-auto text-primary" />
            <p className="text-[11px] font-bold text-primary uppercase tracking-wide">Novo desafio</p>
            <p className="text-sm text-white">{celebrationText}</p>
            <button
              onClick={() => setCelebrationText(null)}
              className="text-xs text-text-secondary hover:text-white underline"
            >
              Continuar
            </button>
          </div>
        )}

        {(habit.status === 'active' || habit.status === 'completed') && (
          <button
            onClick={() => setShowShareCard(true)}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-white/10 text-text-secondary hover:text-white hover:bg-white/5 text-xs font-semibold transition-colors"
          >
            <Share2 size={14} /> COMPARTILHAR EVOLUÇÃO
          </button>
        )}

        {habit.status === 'completed' && (
          <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-xl p-3 flex items-center gap-2 text-emerald-400 text-xs font-semibold">
            <CheckCircle2 size={14} />
            Hábito concluído! Crie um novo objetivo quando quiser.
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-xs text-red-400">
            <AlertCircle size={12} /> {error}
          </div>
        )}
      {showShareCard && (
        <HabitShareCard habit={habit} onClose={() => setShowShareCard(false)} />
      )}
      </div>
    );
  }

  // NO ACTIVE HABIT — CTA / CREATION FORM VIEW
  return (
    <div className="bg-surface-card border border-white/10 rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-white/5 rounded-xl border border-white/10">
          <Sparkles size={20} className="text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-white">Criar Hábito de Cardio</h3>
          <p className="text-xs text-text-secondary">
            Defina um objetivo e receba um plano de marcos adaptado ao seu ritmo.
          </p>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {!creating ? (
          <motion.button
            key="cta"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setCreating(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary/10 border border-primary/20 text-primary text-sm font-semibold hover:bg-primary/20 transition-colors"
          >
            Criar meu hábito
            <ChevronRight size={16} />
          </motion.button>
        ) : (
          <motion.div
            key="form"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-3 overflow-hidden"
          >
            <div>
              <label className="text-[11px] text-text-secondary block mb-1">Objetivo</label>
              <select
                value={goalType}
                onChange={(e) => setGoalType(e.target.value as HabitGoalType)}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              >
                {GOAL_TYPE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[11px] text-text-secondary block mb-1">Meta (km)</label>
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={targetDistanceKm}
                  onChange={(e) => setTargetDistanceKm(e.target.value)}
                  className="w-full bg-black/20 border border-white/10 rounded-lg px-2 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-[11px] text-text-secondary block mb-1">Prazo (dias)</label>
                <input
                  type="number"
                  min="7"
                  max="365"
                  value={deadlineDays}
                  onChange={(e) => setDeadlineDays(e.target.value)}
                  className="w-full bg-black/20 border border-white/10 rounded-lg px-2 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-[11px] text-text-secondary block mb-1">Vezes/semana</label>
                <input
                  type="number"
                  min="1"
                  max="7"
                  value={weeklyFrequency}
                  onChange={(e) => setWeeklyFrequency(e.target.value)}
                  className="w-full bg-black/20 border border-white/10 rounded-lg px-2 py-2 text-sm text-white"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-xs text-red-400">
                <AlertCircle size={12} /> {error}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => { setCreating(false); setError(null); }}
                className="flex-1 py-2 rounded-xl border border-white/10 text-text-secondary text-sm hover:bg-white/5 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={submitting}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-primary text-black font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : 'Começar'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
