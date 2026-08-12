import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShieldCheck, Database, Cpu, HelpCircle, Calculator, CheckCircle2, AlertTriangle, FileCode2, Sparkles, Filter } from 'lucide-react';
import { METRIC_CATALOG, PerformanceMetricDef } from '../../core/performance/metricCatalog';

interface MetricMatrixModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMetricId?: string;
}

export function MetricMatrixModal({ isOpen, onClose, initialMetricId }: MetricMatrixModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMetric, setSelectedMetric] = useState<PerformanceMetricDef | null>(
    initialMetricId ? METRIC_CATALOG.find(m => m.id === initialMetricId) || null : null
  );

  if (!isOpen) return null;

  const categories = [
    { id: 'all', label: 'Todas as Métricas' },
    { id: 'performance_volume', label: 'Volume & Treinos' },
    { id: 'cardiovascular', label: 'Cardiovascular' },
    { id: 'energy_load', label: 'Energia & Carga' },
    { id: 'recovery', label: 'Recuperação' },
    { id: 'consistency', label: 'Consistência' },
    { id: 'records_evolution', label: 'Recordes & Evolução' },
    { id: 'ranking_iga', label: 'Ranking & IGA' },
    { id: 'projections', label: 'Projeções' }
  ];

  const filteredMetrics = METRIC_CATALOG.filter(m => {
    const matchesCat = selectedCategory === 'all' || m.category === selectedCategory;
    const matchesSearch = searchQuery === '' || 
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      m.simpleDescription.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.dataSources.some(ds => ds.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCat && matchesSearch;
  });

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-5xl bg-zinc-950 border border-emerald-500/30 rounded-3xl p-6 md:p-8 shadow-2xl text-white space-y-6 my-8 max-h-[90vh] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 pb-4 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
                <FileCode2 size={22} />
              </div>
              <div>
                <h3 className="font-headline italic font-black text-xl uppercase tracking-tight text-white flex items-center gap-2">
                  <span>Matriz Oficial de Métricas Invictus</span>
                  <span className="text-[10px] bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 px-2 py-0.5 rounded-full not-italic font-sans">
                    Dados Reais & Verificáveis
                  </span>
                </h3>
                <p className="text-xs text-zinc-400">
                  Documentação técnica e especificação de coleta biométrica • {METRIC_CATALOG.length} Indicadores Auditados
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center cursor-pointer transition-colors border border-zinc-800"
            >
              <X size={20} />
            </button>
          </div>

          {/* Search and Category Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <input
              type="text"
              placeholder="Buscar por nome, fonte de dados, dispositivo..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 flex-1"
            />
            <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`text-[11px] font-bold px-3 py-1.5 rounded-xl whitespace-nowrap transition-all cursor-pointer ${
                    selectedCategory === cat.id
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-white'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Main Matrix Content (Split Grid or Detailed Inspector) */}
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {filteredMetrics.length === 0 ? (
              <div className="py-12 text-center text-zinc-500">
                Nenhum indicador encontrado para os filtros selecionados.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {filteredMetrics.map((m) => {
                  const isSelected = selectedMetric?.id === m.id;
                  return (
                    <div
                      key={m.id}
                      className={`p-5 rounded-2xl border transition-all ${
                        isSelected
                          ? 'bg-zinc-900 border-emerald-500/50 shadow-lg shadow-emerald-500/5'
                          : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-zinc-800">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black uppercase text-emerald-400 tracking-wider">
                            {m.name}
                          </span>
                          <span className="text-[10px] bg-zinc-800 text-zinc-400 font-mono px-2 py-0.5 rounded-md border border-zinc-700">
                            ID: {m.id}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="bg-emerald-500/10 text-emerald-300 font-bold px-2 py-0.5 rounded-full border border-emerald-500/20">
                            Atualização: {m.updateFrequency}
                          </span>
                          <span className="bg-blue-500/10 text-blue-300 font-bold px-2 py-0.5 rounded-full border border-blue-500/20">
                            Unidade: {m.unit}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 text-xs">
                        <div className="space-y-2">
                          <div>
                            <p className="text-[10px] uppercase font-black text-zinc-500">Objetivo & Descrição</p>
                            <p className="text-zinc-200 font-medium">{m.simpleDescription}</p>
                            <p className="text-zinc-400 text-[11px] mt-1">{m.objective}</p>
                          </div>

                          <div className="bg-black/40 p-3 rounded-xl border border-zinc-800 font-mono text-[11px]">
                            <p className="text-[10px] text-emerald-400 font-bold uppercase mb-1 flex items-center gap-1">
                              <Calculator size={12} /> Fórmula Matemática / Cálculo
                            </p>
                            <p className="text-zinc-300">{m.formula}</p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div>
                            <p className="text-[10px] uppercase font-black text-zinc-500 flex items-center gap-1">
                              <Database size={12} /> Fonte de Dados & Dispositivos
                            </p>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {m.dataSources.map((ds, idx) => (
                                <span key={idx} className="bg-zinc-800 text-zinc-300 text-[10px] font-bold px-2 py-0.5 rounded-md border border-zinc-700">
                                  {ds}
                                </span>
                              ))}
                            </div>
                            <p className="text-[11px] text-zinc-400 mt-1">
                              <Cpu size={12} className="inline mr-1 text-zinc-500" />
                              Dispositivos: {m.deviceTypes.join(', ')}
                            </p>
                          </div>

                          <div className="bg-zinc-950/60 p-2.5 rounded-xl border border-zinc-800 space-y-1">
                            <p className="text-[10px] font-bold text-amber-400 uppercase flex items-center gap-1">
                              <AlertTriangle size={12} /> Em caso de dados insuficientes
                            </p>
                            <p className="text-[11px] text-zinc-400">{m.insufficientDataBehavior}</p>
                          </div>
                        </div>
                      </div>

                      {/* AI Usage Note */}
                      <div className="mt-3 pt-2 border-t border-zinc-800/60 text-[11px] text-zinc-400 flex items-start gap-2">
                        <Sparkles size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                        <div>
                          <strong className="text-emerald-400">Uso pela IA Invictus:</strong> {m.aiUsage}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
