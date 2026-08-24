import React, { useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Flame,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';

type QualityMetric = {
  score?: number;
  resultText?: string;
  explanation?: string;
  suggestion?: string;
};

export interface ScoreReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Dados recebidos da análise homologada no servidor. */
  reportData?: {
    finalScore?: number;
    qualityMetrics?: {
      consistency?: QualityMetric;
      intensity?: QualityMetric;
      efficiency?: QualityMetric;
      technicalQuality?: QualityMetric;
      dataIntegrity?: QualityMetric;
    };
    explanations?: {
      overallSummary?: string;
      mainDragFactor?: string;
    };
    maxScoreSimulation?: {
      currentScore?: number;
      targetScore?: number;
      simulatedImprovements?: Array<{
        action: string;
        pointsGain: number;
        category: string;
      }>;
    };
  };
}

const METRIC_DEFINITIONS = [
  {
    key: 'consistency' as const,
    title: '1. Consistência Semanal',
    icon: <Clock className="w-4 h-4 text-cyan-400" />,
    whatWeAnalyze: 'A frequência de sessões homologadas no período avaliado.',
    whyItMatters: 'Uma rotina consistente ajuda a acompanhar evolução e recuperação com mais segurança.',
  },
  {
    key: 'intensity' as const,
    title: '2. Intensidade Adequada',
    icon: <Flame className="w-4 h-4 text-amber-400" />,
    whatWeAnalyze: 'Os sinais de intensidade que foram efetivamente enviados pelos sensores.',
    whyItMatters: 'Métricas reais ajudam a interpretar a carga sem estimar dados ausentes.',
  },
  {
    key: 'efficiency' as const,
    title: '3. Eficiência e Densidade',
    icon: <Activity className="w-4 h-4 text-emerald-400" />,
    whatWeAnalyze: 'Tempo ativo e intervalos registrados na sessão avaliada.',
    whyItMatters: 'A densidade do treino só é útil quando foi registrada de forma auditável.',
  },
  {
    key: 'technicalQuality' as const,
    title: '4. Qualidade Técnica',
    icon: <CheckCircle2 className="w-4 h-4 text-primary" />,
    whatWeAnalyze: 'Evidências e campos enviados para a validação da atividade.',
    whyItMatters: 'A validação evita que informações não verificadas afetem o desempenho.',
  },
  {
    key: 'dataIntegrity' as const,
    title: '5. Integridade dos Dados',
    icon: <ShieldCheck className="w-4 h-4 text-indigo-400" />,
    whatWeAnalyze: 'O resultado da auditoria antifraude realizado pelo servidor.',
    whyItMatters: 'A integridade protege o ranking e impede que o cliente se autoavalie.',
  },
];

export const ScoreReportModal: React.FC<ScoreReportModalProps> = ({ isOpen, onClose, reportData }) => {
  const [activeTab, setActiveTab] = useState<'metrics' | 'simulator'>('metrics');
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);

  const finalScore = reportData?.finalScore;
  const hasFinalScore = typeof finalScore === 'number' && Number.isFinite(finalScore);
  const metrics = reportData?.qualityMetrics;
  const simulator = reportData?.maxScoreSimulation;
  const hasSimulator = Boolean(simulator?.simulatedImprovements?.length);

  const availableMetrics = useMemo(() => METRIC_DEFINITIONS.flatMap(definition => {
    const metric = metrics?.[definition.key];
    return metric && typeof metric.score === 'number' && Number.isFinite(metric.score)
      ? [{ ...definition, metric }]
      : [];
  }), [metrics]);

  if (!isOpen) return null;

  const toggleMetric = (key: string) => {
    setExpandedMetric(current => current === key ? null : key);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-2xl bg-surface-dark border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-white/10 bg-surface-dark/90 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-primary/10 border border-primary/20 text-primary">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black font-headline text-white tracking-wide uppercase">Avaliação de Qualidade do Treino</h2>
              <p className="text-xs text-on-surface-variant font-medium">Dados homologados pelo avaliador</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar relatório" className="p-2 text-on-surface-variant hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 bg-gradient-to-b from-primary/10 via-surface-dark to-surface-dark border-b border-white/5 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-bold text-primary mb-3">
            <Zap className="w-3.5 h-3.5" />
            <span>Score de Qualidade</span>
          </div>

          <div className="flex items-baseline justify-center gap-1 my-2">
            <span className="text-6xl font-black font-headline tracking-tight text-white">{hasFinalScore ? finalScore : '—'}</span>
            {hasFinalScore && <span className="text-xl font-bold text-on-surface-variant">/100 pts</span>}
          </div>

          <p className="text-sm font-medium text-white/90 max-w-md mx-auto leading-relaxed mt-2">
            {reportData?.explanations?.overallSummary || (hasFinalScore
              ? 'A análise abaixo reflete exclusivamente os dados recebidos pelo avaliador.'
              : 'A análise ficará disponível quando esta atividade receber uma avaliação homologada.')}
          </p>

          <div className="flex justify-center gap-2 mt-6 p-1 bg-white/5 rounded-2xl border border-white/10 max-w-xs mx-auto">
            <button onClick={() => setActiveTab('metrics')} className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold transition ${activeTab === 'metrics' ? 'bg-primary text-black shadow-lg' : 'text-on-surface-variant hover:text-white'}`}>
              Métricas
            </button>
            {hasSimulator && <button onClick={() => setActiveTab('simulator')} className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${activeTab === 'simulator' ? 'bg-primary text-black shadow-lg' : 'text-on-surface-variant hover:text-white'}`}>
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Melhorias</span>
            </button>}
          </div>
        </div>

        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {activeTab === 'metrics' || !hasSimulator ? (
            availableMetrics.length ? <div className="space-y-3">
              {availableMetrics.map(({ key, title, icon, whatWeAnalyze, whyItMatters, metric }) => (
                <MetricAccordion
                  key={key}
                  icon={icon}
                  title={title}
                  score={metric.score!}
                  resultText={metric.resultText || 'Resultado disponibilizado sem detalhamento adicional.'}
                  whatWeAnalyze={metric.explanation || whatWeAnalyze}
                  whyItMatters={whyItMatters}
                  suggestion={metric.suggestion}
                  isExpanded={expandedMetric === key}
                  onToggle={() => toggleMetric(key)}
                />
              ))}
            </div> : <EmptyAnalysis />
          ) : (
            <section className="space-y-4">
              <div className="p-4 rounded-2xl bg-primary/10 border border-primary/20 flex items-start gap-3">
                <TrendingUp className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold text-white uppercase tracking-wide">Melhorias sugeridas</h4>
                  <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">Sugestões emitidas pelo avaliador da sessão.</p>
                </div>
              </div>

              <div className="space-y-2.5">
                {simulator?.simulatedImprovements?.map((item, index) => (
                  <div key={`${item.category}-${index}`} className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-primary/20 text-primary font-bold text-xs flex items-center justify-center shrink-0">+{item.pointsGain}</div>
                      <span className="text-xs font-semibold text-white leading-snug">{item.action}</span>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-primary px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 whitespace-nowrap">+{item.pointsGain} pts</span>
                  </div>
                ))}
              </div>

              <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between">
                <div>
                  <span className="text-xs text-on-surface-variant">Pontuação avaliada</span>
                  <p className="text-lg font-black text-white">{hasFinalScore ? `${finalScore} pts` : '—'}</p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-primary font-bold">Meta informada</span>
                  <p className="text-lg font-black text-primary">{typeof simulator?.targetScore === 'number' && Number.isFinite(simulator.targetScore) ? `${simulator.targetScore} pts` : '—'}</p>
                </div>
              </div>
            </section>
          )}
        </div>

        <div className="p-4 border-t border-white/10 bg-surface-dark/95 flex justify-end">
          <button onClick={onClose} className="w-full sm:w-auto py-3 px-8 rounded-xl bg-primary text-black font-black font-headline uppercase tracking-wider hover:opacity-90 transition">Fechar</button>
        </div>
      </div>
    </div>
  );
};

function EmptyAnalysis() {
  return <div className="p-8 text-center bg-white/5 rounded-2xl border border-white/10">
    <Sparkles className="w-8 h-8 text-primary mx-auto mb-2" />
    <p className="text-sm font-bold text-white">Análise indisponível</p>
    <p className="text-xs text-on-surface-variant mt-1">Nenhuma métrica homologada foi recebida para esta atividade.</p>
  </div>;
}

interface MetricAccordionProps {
  icon: React.ReactNode;
  title: string;
  score: number;
  resultText: string;
  whatWeAnalyze: string;
  whyItMatters: string;
  suggestion?: string;
  isExpanded: boolean;
  onToggle: () => void;
}

const MetricAccordion: React.FC<MetricAccordionProps> = ({ icon, title, score, resultText, whatWeAnalyze, whyItMatters, suggestion, isExpanded, onToggle }) => {
  const badgeColor = score >= 90
    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
    : score >= 75
      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      : 'bg-rose-500/10 text-rose-400 border-rose-500/20';

  return <div className="rounded-2xl bg-white/5 border border-white/10 overflow-hidden transition">
    <button onClick={onToggle} className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-white/5 transition">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-white/5 border border-white/10">{icon}</div>
        <div>
          <h4 className="text-sm font-bold text-white">{title}</h4>
          <p className="text-xs text-on-surface-variant font-medium mt-0.5">{resultText}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${badgeColor}`}>{score}/100</span>
        {isExpanded ? <ChevronUp className="w-4 h-4 text-on-surface-variant" /> : <ChevronDown className="w-4 h-4 text-on-surface-variant" />}
      </div>
    </button>

    {isExpanded && <div className="p-4 border-t border-white/10 bg-black/20 space-y-3 text-xs">
      <div>
        <span className="font-bold text-primary uppercase tracking-wider text-[10px]">O que analisamos</span>
        <p className="text-white/90 mt-0.5 leading-relaxed">{whatWeAnalyze}</p>
      </div>
      <div>
        <span className="font-bold text-cyan-400 uppercase tracking-wider text-[10px]">Por que isso importa</span>
        <p className="text-white/80 mt-0.5 leading-relaxed">{whyItMatters}</p>
      </div>
      <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
        <span className="font-bold text-primary uppercase tracking-wider text-[10px] block mb-0.5">Próximo passo</span>
        <p className="text-white font-medium">{suggestion || 'Nenhuma recomendação adicional foi disponibilizada pelo avaliador.'}</p>
      </div>
    </div>}
  </div>;
};
