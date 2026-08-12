import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Activity, Flame, Clock, Heart, ShieldCheck, Info, Calculator, CheckCircle2, AlertTriangle } from 'lucide-react';
import { IGACalculationResult } from '../core/iga/types';
import { formatIGAAuditText } from '../core/iga/audit';

interface IGAAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  auditData?: IGACalculationResult | null;
  userName?: string;
}

export function IGAAuditModal({ isOpen, onClose, auditData, userName }: IGAAuditModalProps) {
  if (!isOpen) return null;

  const data = auditData;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-2xl bg-zinc-900 border border-emerald-500/30 rounded-3xl p-6 md:p-8 shadow-2xl text-white space-y-6 my-8 max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                <Calculator size={22} />
              </div>
              <div>
                <h3 className="font-headline italic font-black text-xl uppercase tracking-tight text-white">
                  Auditoria IGA (Índice Global de Atividade)
                </h3>
                <p className="text-xs text-zinc-400">
                  Desempenho Semanal Transparente • {userName || 'Atleta'}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center cursor-pointer transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {!data ? (
            <div className="py-12 text-center text-zinc-400 space-y-2">
              <Info size={36} className="mx-auto text-zinc-600" />
              <p>Nenhum dado de auditoria IGA disponível para esta semana ainda.</p>
              <p className="text-xs text-zinc-500">Conclua treinos para gerar o relatório científico do seu IGA.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Top Summary Card */}
              <div className="bg-gradient-to-br from-emerald-500/10 via-zinc-900 to-zinc-950 p-6 rounded-2xl border border-emerald-500/30 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-widest text-emerald-400">
                    Pontuação IGA Semanal
                  </span>
                  <span className="text-[10px] bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold px-2.5 py-1 rounded-full">
                    Auditoria Verificada
                  </span>
                </div>

                <div className="flex items-baseline justify-between">
                  <div>
                    <span className="font-headline italic font-black text-5xl text-white">
                      {data.igaRanking}
                    </span>
                    <span className="text-zinc-400 font-bold ml-2">PTS</span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-zinc-400 font-medium">Fórmula Matemática:</p>
                    <p className="font-mono text-xs text-emerald-400 font-bold">100 × (Fn × Tn × In)¹/³</p>
                  </div>
                </div>
              </div>

              {/* Core Variables Grid (F, T, I) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Frequency */}
                <div className="bg-zinc-800/60 p-4 rounded-2xl border border-zinc-700/50 space-y-2">
                  <div className="flex items-center justify-between text-emerald-400">
                    <Activity size={18} />
                    <span className="text-xs font-bold font-mono">Fn = {(data.Fn * 100).toFixed(0)}%</span>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-black text-zinc-400 tracking-wider">Frequência (F)</p>
                    <p className="text-lg font-black text-white">{data.frequency} / 5 <span className="text-xs text-zinc-400 font-normal">sessões</span></p>
                  </div>
                  <p className="text-[10px] text-zinc-500">Máx 5 melhores sessões válidas por semana.</p>
                </div>

                {/* Time */}
                <div className="bg-zinc-800/60 p-4 rounded-2xl border border-zinc-700/50 space-y-2">
                  <div className="flex items-center justify-between text-emerald-400">
                    <Clock size={18} />
                    <span className="text-xs font-bold font-mono">Tn = {(data.Tn * 100).toFixed(0)}%</span>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-black text-zinc-400 tracking-wider">Tempo Total (T)</p>
                    <p className="text-lg font-black text-white">{data.totalTimeMinutes} <span className="text-xs text-zinc-400 font-normal">minutos</span></p>
                  </div>
                  <p className="text-[10px] text-zinc-500">Min: 30min musculação | 20min cardio.</p>
                </div>

                {/* Intensity */}
                <div className="bg-zinc-800/60 p-4 rounded-2xl border border-zinc-700/50 space-y-2">
                  <div className="flex items-center justify-between text-emerald-400">
                    <Heart size={18} />
                    <span className="text-xs font-bold font-mono">In = {(data.In * 100).toFixed(0)}%</span>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-black text-zinc-400 tracking-wider">Intensidade (I)</p>
                    <p className="text-lg font-black text-white">{data.avgHeartRate} <span className="text-xs text-zinc-400 font-normal">bpm méd</span></p>
                  </div>
                  <p className="text-[10px] text-zinc-500">{(data.avgRelativeHR * 100).toFixed(1)}% da FC Max ({data.maxHeartRate} bpm).</p>
                </div>
              </div>

              {/* Calorie Gate Section */}
              <div className="bg-zinc-800/40 p-5 rounded-2xl border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Flame size={18} className="text-amber-400" />
                    <h4 className="font-black text-sm uppercase text-white">Gate de Coerência Calorias</h4>
                  </div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                    data.overallGate === 1.0
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                  }`}>
                    Gate = {data.overallGate.toFixed(2)}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1">
                  <div className="bg-zinc-900/80 p-2.5 rounded-xl border border-zinc-800">
                    <p className="text-[10px] text-zinc-500 font-bold uppercase">Esperadas (MET)</p>
                    <p className="font-bold text-white mt-0.5">{data.expectedCaloriesTotal} kcal</p>
                  </div>
                  <div className="bg-zinc-900/80 p-2.5 rounded-xl border border-zinc-800">
                    <p className="text-[10px] text-zinc-500 font-bold uppercase">Informadas</p>
                    <p className="font-bold text-white mt-0.5">{data.informedCaloriesTotal} kcal</p>
                  </div>
                  <div className="bg-zinc-900/80 p-2.5 rounded-xl border border-zinc-800">
                    <p className="text-[10px] text-zinc-500 font-bold uppercase">Razão (r)</p>
                    <p className="font-bold text-emerald-400 mt-0.5">{data.overallCalorieRatio.toFixed(2)}</p>
                  </div>
                </div>

                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  <ShieldCheck size={14} className="inline mr-1 text-emerald-400" />
                  As calorias <strong className="text-white">NÃO somam pontos</strong>. São utilizadas exclusivamente como gate de segurança. Atividades dentro da faixa fisiológica (0.70 ≤ r ≤ 1.40) possuem Gate = 1.00.
                </p>
              </div>

              {/* Detailed Raw Audit Console Text */}
              <div className="space-y-2">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Extrato Técnico de Auditoria</span>
                <pre className="bg-black p-4 rounded-2xl text-[11px] font-mono text-zinc-300 overflow-x-auto leading-relaxed border border-zinc-800 max-h-48">
                  {formatIGAAuditText(data)}
                </pre>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
