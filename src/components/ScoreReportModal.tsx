import React, { useState } from 'react';
import { 
  X, 
  Sparkles, 
  Flame, 
  Activity, 
  ShieldCheck, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  ChevronDown, 
  ChevronUp, 
  Zap, 
  TrendingUp,
  HelpCircle
} from 'lucide-react';

export interface ScoreReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportData: {
    finalScore: number;
    qualityMetrics?: {
      consistency?: { score: number; resultText: string; explanation: string; suggestion: string };
      intensity?: { score: number; resultText: string; explanation: string; suggestion: string };
      efficiency?: { score: number; resultText: string; explanation: string; suggestion: string };
      technicalQuality?: { score: number; resultText: string; explanation: string; suggestion: string };
      dataIntegrity?: { score: number; resultText: string; explanation: string; suggestion: string };
    };
    explanations?: {
      overallSummary?: string;
      mainDragFactor?: string;
    };
    maxScoreSimulation?: {
      currentScore: number;
      targetScore: number;
      simulatedImprovements: Array<{
        action: string;
        pointsGain: number;
        category: string;
      }>;
    };
  };
}

export const ScoreReportModal: React.FC<ScoreReportModalProps> = ({
  isOpen,
  onClose,
  reportData
}) => {
  const [activeTab, setActiveTab] = useState<'metrics' | 'simulator'>('metrics');
  const [expandedMetric, setExpandedMetric] = useState<string | null>('efficiency');

  if (!isOpen) return null;

  const finalScore = reportData?.finalScore ?? 85;
  const metrics = reportData?.qualityMetrics;
  const explanations = reportData?.explanations;
  const simulator = reportData?.maxScoreSimulation;

  const toggleMetric = (key: string) => {
    setExpandedMetric(expandedMetric === key ? null : key);
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    if (score >= 75) return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
    return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-2xl bg-surface-dark border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-6 border-b border-white/10 bg-surface-dark/90 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-primary/10 border border-primary/20 text-primary">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black font-headline text-white tracking-wide uppercase">
                Avaliação de Qualidade do Treino
              </h2>
              <p className="text-xs text-on-surface-variant font-medium">
                Transparência total baseada em ciência do esporte
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-on-surface-variant hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Hero Score Badge */}
        <div className="p-6 bg-gradient-to-b from-primary/10 via-surface-dark to-surface-dark border-b border-white/5 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-bold text-primary mb-3">
            <Zap className="w-3.5 h-3.5" />
            <span>Score Focado em Qualidade</span>
          </div>

          <div className="flex items-baseline justify-center gap-1 my-2">
            <span className="text-6xl font-black font-headline tracking-tight text-white">
              {finalScore}
            </span>
            <span className="text-xl font-bold text-on-surface-variant">/100 pts</span>
          </div>

          <p className="text-sm font-medium text-white/90 max-w-md mx-auto leading-relaxed mt-2">
            {explanations?.overallSummary || 'Seu treino teve boa densidade. Confira a análise completa abaixo.'}
          </p>

          {/* Navigation Tabs */}
          <div className="flex justify-center gap-2 mt-6 p-1 bg-white/5 rounded-2xl border border-white/10 max-w-xs mx-auto">
            <button
              onClick={() => setActiveTab('metrics')}
              className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold transition ${
                activeTab === 'metrics'
                  ? 'bg-primary text-black shadow-lg'
                  : 'text-on-surface-variant hover:text-white'
              }`}
            >
              5 Métricas
            </button>
            <button
              onClick={() => setActiveTab('simulator')}
              className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                activeTab === 'simulator'
                  ? 'bg-primary text-black shadow-lg'
                  : 'text-on-surface-variant hover:text-white'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Simulador 100 Pts</span>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {activeTab === 'metrics' ? (
            <div className="space-y-3">
              {/* Metric Item: Consistency */}
              <MetricAccordion
                icon={<Clock className="w-4 h-4 text-cyan-400" />}
                title="1. Consistência Semanal"
                score={metrics?.consistency?.score ?? 85}
                resultText={metrics?.consistency?.resultText || '3 treinos registrados na semana'}
                whatWeAnalyze="Analisamos a frequência de treinos nos últimos 7 dias em relação à meta de 4-5 estímulos por semana."
                whyItMatters="Treinos espaçados de forma consistente mantêm a supercompensação muscular ativa sem sobrecarga."
                suggestion={metrics?.consistency?.suggestion || 'Treine mais 1 dia nesta semana para pontuação máxima.'}
                isExpanded={expandedMetric === 'consistency'}
                onToggle={() => toggleMetric('consistency')}
              />

              {/* Metric Item: Intensity */}
              <MetricAccordion
                icon={<Flame className="w-4 h-4 text-amber-400" />}
                title="2. Intensidade Adequada"
                score={metrics?.intensity?.score ?? 80}
                resultText={metrics?.intensity?.resultText || 'FC Média e gasto calórico aferidos'}
                whatWeAnalyze="Avaliamos seu tempo em zonas cardíacas alvo (Z3/Z4) e gasto energético por quilo corporal."
                whyItMatters="A intensidade correta garante estímulos hipertróficos e cardiovasculares sem causar fadiga crônica."
                suggestion={metrics?.intensity?.suggestion || 'Mantenha a FC na zona-alvo entre 130 e 160 bpm.'}
                isExpanded={expandedMetric === 'intensity'}
                onToggle={() => toggleMetric('intensity')}
              />

              {/* Metric Item: Efficiency */}
              <MetricAccordion
                icon={<Activity className="w-4 h-4 text-emerald-400" />}
                title="3. Eficiência e Densidade"
                score={metrics?.efficiency?.score ?? 75}
                resultText={metrics?.efficiency?.resultText || 'Tempo ativo vs tempo parado'}
                whatWeAnalyze="Comparamos o tempo acumulado em movimento ativo com os descansos prolongados entre séries."
                whyItMatters="Descansos excessivos reduzem a densidade do treino e esfriam a frequência cardíaca ideal."
                suggestion={metrics?.efficiency?.suggestion || 'Reduza 5 minutos de descanso para elevar a nota em +10 pts.'}
                isExpanded={expandedMetric === 'efficiency'}
                onToggle={() => toggleMetric('efficiency')}
              />

              {/* Metric Item: Technical Quality */}
              <MetricAccordion
                icon={<CheckCircle2 className="w-4 h-4 text-primary" />}
                title="4. Qualidade Técnica"
                score={metrics?.technicalQuality?.score ?? 90}
                resultText={metrics?.technicalQuality?.resultText || 'Exercícios cadastrados e fotos anexadas'}
                whatWeAnalyze="Verificamos o registro individual de exercícios, foto comprobatória e validação biométrica por IA."
                whyItMatters="Registros ricos em detalhes permitem auditar a progressão de carga real e execução perfeita."
                suggestion={metrics?.technicalQuality?.suggestion || 'Anexe fotos dos aparelhos para validar com nota máxima.'}
                isExpanded={expandedMetric === 'technicalQuality'}
                onToggle={() => toggleMetric('technicalQuality')}
              />

              {/* Metric Item: Data Integrity */}
              <MetricAccordion
                icon={<ShieldCheck className="w-4 h-4 text-indigo-400" />}
                title="5. Integridade dos Dados"
                score={metrics?.dataIntegrity?.score ?? 100}
                resultText={metrics?.dataIntegrity?.resultText || '100% autêntico - GPS e sensores validados'}
                whatWeAnalyze="Auditoria antifraude de localização, velocidade, acelerômetros e ausência de Mock Location."
                whyItMatters="Garante um ecossistema seguro e justo no ranking geral do Invictus."
                suggestion={metrics?.dataIntegrity?.suggestion || 'Seus dados de telemetria foram 100% aprovados.'}
                isExpanded={expandedMetric === 'dataIntegrity'}
                onToggle={() => toggleMetric('dataIntegrity')}
              />
            </div>
          ) : (
            /* Simulator Tab */
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-primary/10 border border-primary/20 flex items-start gap-3">
                <TrendingUp className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold text-white uppercase tracking-wide">
                    Como eu poderia ter feito 100 pontos?
                  </h4>
                  <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                    O ScoreEngine calculou dinamicamente as melhorias exatas que teriam elevado sua nota nesta sessão de treino:
                  </p>
                </div>
              </div>

              {simulator?.simulatedImprovements && simulator.simulatedImprovements.length > 0 ? (
                <div className="space-y-2.5">
                  {simulator.simulatedImprovements.map((item, idx) => (
                    <div 
                      key={idx}
                      className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-primary/20 text-primary font-bold text-xs flex items-center justify-center shrink-0">
                          +{item.pointsGain}
                        </div>
                        <span className="text-xs font-semibold text-white leading-snug">
                          {item.action}
                        </span>
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-primary px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 whitespace-nowrap">
                        +{item.pointsGain} pts
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center bg-white/5 rounded-2xl border border-white/10">
                  <Sparkles className="w-8 h-8 text-primary mx-auto mb-2" />
                  <p className="text-sm font-bold text-white">Parabéns! Você alcançou a nota máxima!</p>
                  <p className="text-xs text-on-surface-variant mt-1">Seu treino atingiu 100% de qualidade técnica.</p>
                </div>
              )}

              <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between">
                <div>
                  <span className="text-xs text-on-surface-variant">Pontuação Atual</span>
                  <p className="text-lg font-black text-white">{finalScore} pts</p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-primary font-bold">Projeção Máxima</span>
                  <p className="text-lg font-black text-primary">100 pts 🎯</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-surface-dark/95 flex justify-end">
          <button
            onClick={onClose}
            className="w-full sm:w-auto py-3 px-8 rounded-xl bg-primary text-black font-black font-headline uppercase tracking-wider hover:opacity-90 transition"
          >
            Entendi! Aplicar no Próximo Treino
          </button>
        </div>

      </div>
    </div>
  );
};

interface MetricAccordionProps {
  icon: React.ReactNode;
  title: string;
  score: number;
  resultText: string;
  whatWeAnalyze: string;
  whyItMatters: string;
  suggestion: string;
  isExpanded: boolean;
  onToggle: () => void;
}

const MetricAccordion: React.FC<MetricAccordionProps> = ({
  icon,
  title,
  score,
  resultText,
  whatWeAnalyze,
  whyItMatters,
  suggestion,
  isExpanded,
  onToggle
}) => {
  const getBadgeColor = (s: number) => {
    if (s >= 90) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (s >= 75) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
  };

  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 overflow-hidden transition">
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-white/5 transition"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-white/5 border border-white/10">
            {icon}
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">{title}</h4>
            <p className="text-xs text-on-surface-variant font-medium mt-0.5">{resultText}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${getBadgeColor(score)}`}>
            {score}/100
          </span>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-on-surface-variant" />
          ) : (
            <ChevronDown className="w-4 h-4 text-on-surface-variant" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="p-4 border-t border-white/10 bg-black/20 space-y-3 text-xs">
          <div>
            <span className="font-bold text-primary uppercase tracking-wider text-[10px]">O que analisamos</span>
            <p className="text-white/90 mt-0.5 leading-relaxed">{whatWeAnalyze}</p>
          </div>
          <div>
            <span className="font-bold text-cyan-400 uppercase tracking-wider text-[10px]">Por que isso importa</span>
            <p className="text-white/80 mt-0.5 leading-relaxed">{whyItMatters}</p>
          </div>
          <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
            <span className="font-bold text-primary uppercase tracking-wider text-[10px] block mb-0.5">Como melhorar no próximo treino</span>
            <p className="text-white font-medium">{suggestion}</p>
          </div>
        </div>
      )}
    </div>
  );
};
