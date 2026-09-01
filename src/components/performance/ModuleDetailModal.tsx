import { motion, AnimatePresence } from 'framer-motion';
import { X, Calculator, Database, Sparkles, AlertTriangle, Cpu } from 'lucide-react';
import { CalculatedMetricValue } from '../../core/performance/performanceEngine';

interface ModuleDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  metricData?: CalculatedMetricValue | null;
}

export function ModuleDetailModal({ isOpen, onClose, metricData }: ModuleDetailModalProps) {
  if (!isOpen || !metricData) return null;

  const def = metricData.def;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-2xl bg-zinc-950 border border-emerald-500/30 rounded-3xl p-6 md:p-8 shadow-2xl text-white space-y-6 my-8 max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 rounded-full">
                  Métrica Oficial Auditada
                </span>
                <span className="text-[10px] font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded-md border border-zinc-800">
                  ID: {def.id}
                </span>
              </div>
              <h3 className="font-headline italic font-black text-2xl uppercase tracking-tight text-white mt-1">
                {def.name}
              </h3>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-zinc-900 text-zinc-400 hover:text-white flex items-center justify-center cursor-pointer transition-colors border border-zinc-800"
            >
              <X size={20} />
            </button>
          </div>

          {/* Current Value Hero Card */}
          <div className="bg-gradient-to-br from-emerald-500/15 via-zinc-900 to-zinc-950 p-6 rounded-2xl border border-emerald-500/30 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-widest text-emerald-400">
                Valor Atual no Período ({metricData.timeRange})
              </span>
              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                metricData.reliability === 'alta'
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                  : 'bg-amber-500/20 border-amber-500/40 text-amber-300'
              }`}>
                Confiabilidade: {metricData.reliability.toUpperCase()}
              </span>
            </div>

            <div className="flex items-baseline justify-between pt-1">
              <div>
                <span className="font-headline italic font-black text-3xl sm:text-4xl md:text-5xl text-white">
                  {metricData.currentValue}
                </span>
                <span className="text-zinc-400 font-bold ml-2 text-lg">{metricData.unit}</span>
              </div>
              {metricData.averageValue !== undefined && metricData.averageValue > 0 && (
                <div className="text-right">
                  <p className="text-[10px] text-zinc-400 font-bold uppercase">Média do Período</p>
                  <p className="font-mono text-base text-emerald-400 font-bold">{metricData.averageValue} {metricData.unit}</p>
                </div>
              )}
            </div>

            {metricData.statusMessage && (
              <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" />
                <span>{metricData.statusMessage}</span>
              </p>
            )}
          </div>

          {/* Statistics Grid (Best, Worst, Average) */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-zinc-900 p-3.5 rounded-2xl border border-zinc-800">
              <p className="text-[10px] text-zinc-500 font-bold uppercase">Melhor Valor</p>
              <p className="font-headline italic font-black text-xl text-emerald-400 mt-1">
                {metricData.bestValue ?? 'N/A'}
              </p>
            </div>
            <div className="bg-zinc-900 p-3.5 rounded-2xl border border-zinc-800">
              <p className="text-[10px] text-zinc-500 font-bold uppercase">Média Geral</p>
              <p className="font-headline italic font-black text-xl text-white mt-1">
                {metricData.averageValue ?? 'N/A'}
              </p>
            </div>
            <div className="bg-zinc-900 p-3.5 rounded-2xl border border-zinc-800">
              <p className="text-[10px] text-zinc-500 font-bold uppercase">Menor Valor</p>
              <p className="font-headline italic font-black text-xl text-zinc-400 mt-1">
                {metricData.worstValue ?? 'N/A'}
              </p>
            </div>
          </div>

          {/* Mathematical Formula & Technical Specification */}
          <div className="space-y-3">
            <h4 className="font-black text-xs uppercase tracking-wider text-zinc-400 flex items-center gap-2">
              <Calculator size={16} className="text-emerald-400" />
              <span>Especificação Técnica & Cálculo</span>
            </h4>

            <div className="bg-black/50 p-4 rounded-2xl border border-zinc-800 space-y-2 font-mono text-xs">
              <p className="text-emerald-400 font-bold">Fórmula: {def.formula}</p>
              <p className="text-zinc-300 text-[11px] leading-relaxed font-sans">{def.technicalDescription}</p>
            </div>
          </div>

          {/* Data Source & Device Hardware */}
          <div className="space-y-3">
            <h4 className="font-black text-xs uppercase tracking-wider text-zinc-400 flex items-center gap-2">
              <Database size={16} className="text-emerald-400" />
              <span>Origem dos Dados & Sensores Compatíveis</span>
            </h4>

            <div className="bg-zinc-900/80 p-4 rounded-2xl border border-zinc-800 space-y-3 text-xs">
              <div className="flex flex-wrap gap-1.5">
                {def.dataSources.map((ds, idx) => (
                  <span key={idx} className="bg-zinc-800 text-emerald-300 font-bold text-[10px] px-2.5 py-1 rounded-lg border border-zinc-700">
                    {ds}
                  </span>
                ))}
              </div>
              <p className="text-zinc-400 text-[11px] flex items-center gap-1">
                <Cpu size={14} className="text-zinc-500" />
                <span>Dispositivos: {def.deviceTypes.join(', ')}</span>
              </p>
            </div>
          </div>

          {/* AI Usage */}
          <div className="bg-emerald-500/10 p-4 rounded-2xl border border-emerald-500/30 text-xs leading-relaxed text-zinc-300 flex items-start gap-2">
            <Sparkles size={16} className="text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-emerald-400 font-bold">Uso pela Invictus Performance AI:</strong>
              <p className="text-zinc-300 mt-0.5">{def.aiUsage}</p>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
