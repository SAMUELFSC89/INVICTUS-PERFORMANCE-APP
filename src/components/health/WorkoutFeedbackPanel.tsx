import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, CheckCircle2, Heart, Info, LockKeyhole, RefreshCw } from 'lucide-react';
import { usePro } from '../../ProContext';
import { buildWorkoutFeedback } from '../../core/health/workoutFeedback';
import type { WorkoutHealthRecord } from '../../core/health/workoutHealthTypes';
import type { WorkoutFeedbackHistory } from '../../services/workoutFeedbackHistoryService';
import './WorkoutFeedbackPanel.css';

export interface WorkoutFeedbackPanelProps {
  record: WorkoutHealthRecord | null;
  fallbackAverageBpm?: number;
  onRefresh?: () => Promise<WorkoutHealthRecord | null>;
  history?: readonly WorkoutHealthRecord[];
  historyStatus?: Pick<WorkoutFeedbackHistory, 'status' | 'reviewedCount' | 'limitReached'> | null;
  isPro: boolean;
}

const format = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const formatTime = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Horário indisponível';
};

/** Private, evidence-based post-workout feedback. No generative AI or scoring input. */
export function WorkoutFeedbackPanel({ record, fallbackAverageBpm, onRefresh, history = [], historyStatus, isPro }: WorkoutFeedbackPanelProps) {
  const { showProInvitation } = usePro();
  const [updated, setUpdated] = useState<WorkoutHealthRecord | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [visibleSamples, setVisibleSamples] = useState(30);
  const revision = useRef(0);
  useEffect(() => {
    revision.current += 1;
    setUpdated(null); setMessage(null); setRefreshing(false); setVisibleSamples(30);
    return () => { revision.current += 1; };
  }, [record]);
  const current = updated?.sessionId === record?.sessionId ? updated ?? record : record;
  const feedback = useMemo(() => current ? buildWorkoutFeedback(current, isPro ? history : []) : null, [current, history, isPro]);
  const samples = useMemo(() => {
    if (!current) return [];
    const start = Date.parse(current.startedAt), end = Date.parse(current.endedAt);
    return current.heartRate.samples.filter(sample => {
      const time = Date.parse(sample.timestamp);
      return Number.isFinite(time) && time >= start && time <= end && Number.isFinite(sample.bpm) && sample.bpm >= 30 && sample.bpm <= 240;
    }).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  }, [current]);
  const hasLegacyAverage = Number.isFinite(fallbackAverageBpm) && fallbackAverageBpm! >= 30 && fallbackAverageBpm! <= 240;
  const hasSessionAverage = feedback?.session.averageBpm !== null && feedback?.session.averageBpm !== undefined;
  const statusLabel = current?.heartRate.status === 'pending' ? 'Aguardando sincronização'
    : !samples.length ? 'Sem FC pontual'
    : !hasSessionAverage ? 'Leituras incompletas' : 'Leituras disponíveis';
  const sourceLabel = current?.heartRate.source === 'apple_health' ? 'Apple Saúde'
    : current?.heartRate.source === 'health_connect' ? 'Health Connect' : 'Origem não identificada';
  const allowedInsights = feedback?.insights.filter(insight => isPro || insight.kind === 'insufficient') ?? [];
  const deferredInsufficient = !samples.length ? allowedInsights.filter(insight => insight.kind === 'insufficient') : [];
  const visibleInsights = allowedInsights.filter(insight => !deferredInsufficient.includes(insight));

  const refresh = async () => {
    if (!onRefresh || refreshing) return;
    const requestRevision = revision.current;
    setRefreshing(true); setMessage(null);
    try {
      const next = await onRefresh();
      if (requestRevision !== revision.current) return;
      if (next && next.sessionId === current?.sessionId) {
        setUpdated(next);
        setMessage(next.heartRate.status === 'available' ? 'Leituras atualizadas. A análise verifica a cobertura antes de comparar.' : 'A consulta terminou, mas ainda não há cobertura completa. Seus registros foram mantidos.');
      } else setMessage('Não foi possível atualizar agora. Seus registros anteriores foram mantidos.');
    } catch (error) {
      if (requestRevision === revision.current) setMessage(error instanceof Error && error.message.trim() && error.message.length <= 250
        ? error.message
        : 'Não foi possível atualizar agora. Confira a conexão e sincronize seu dispositivo antes de tentar novamente.');
    } finally {
      if (requestRevision === revision.current) setRefreshing(false);
    }
  };

  return (
    <section className="workout-feedback" aria-label="Saúde neste treino">
      <div className="workout-feedback__heading">
        <div><p className="workout-feedback__eyebrow"><Heart size={14} /> Saúde neste treino</p><h3>O que seus registros mostram</h3></div>
        <span className="workout-feedback__private"><LockKeyhole size={12} /> Privado</span>
      </div>
      <p className="workout-feedback__status"><Activity size={14} /> {statusLabel}</p>
      <div className="workout-feedback__metrics">
        <div><span>{hasSessionAverage ? 'Média das leituras' : hasLegacyAverage ? 'Média salva no treino' : 'Média das leituras'}</span><strong>{hasSessionAverage ? format(feedback!.session.averageBpm!) : hasLegacyAverage ? format(fallbackAverageBpm!) : '—'}{(hasSessionAverage || hasLegacyAverage) && <small>bpm</small>}</strong></div>
        <div><span>Maior leitura</span><strong>{feedback?.session.maxBpm !== null && feedback?.session.maxBpm !== undefined ? <>{format(feedback.session.maxBpm)}<small>bpm</small></> : '—'}</strong></div>
        <div><span>Cobertura temporal</span><strong>{feedback && samples.length ? `${feedback.session.coveragePercent}%` : '—'}</strong></div>
      </div>
      {!samples.length && <p className="workout-feedback__explanation">{hasLegacyAverage ? 'A média salva resume o treino; ela não informa em qual exercício os batimentos variaram.' : 'Ainda não recebemos batimentos com horário para este treino.'} Para relacionar batimentos aos exercícios, precisamos dessas leituras e do início e fim de cada série.</p>}
      {samples.length > 0 && <p className="workout-feedback__explanation">{sourceLabel} · {feedback?.session.sampleCount ?? 0} leituras aceitas. A cobertura considera intervalos curtos entre leituras; não preenche lacunas.{!hasSessionAverage && ' Cobertura insuficiente para resumir os batimentos da sessão.'}</p>}
      {onRefresh && current && <button type="button" className="workout-feedback__refresh" onClick={refresh} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />{refreshing ? 'Consultando batimentos…' : 'Atualizar batimentos deste treino'}</button>}
      {message && <p className="workout-feedback__message" role="status">{message}</p>}

      {visibleInsights.length > 0 && <div className="workout-feedback__insights">{visibleInsights.map(insight => (
        <article key={insight.id} className={`workout-feedback__insight workout-feedback__insight--${insight.kind}`}>
          <h4>{insight.kind === 'achievement' ? <CheckCircle2 size={16} /> : <Info size={16} />}{insight.title}</h4>
          <p>{insight.evidence}</p><p className="workout-feedback__meaning">{insight.meaning}</p><p className="workout-feedback__next"><strong>Na próxima sessão:</strong> {insight.nextStep}</p>
        </article>
      ))}</div>}
      {!isPro && <div className="workout-feedback__pro"><div><strong>Contexto para seus próximos treinos <span>PRO</span></strong><p>Compare séries e resultados do seu histórico quando houver dados suficientes. Seus registros e orientações de segurança continuam acessíveis.</p></div><button type="button" onClick={() => showProInvitation('Entenda os registros de cada exercício e acompanhe resultados comparáveis do seu histórico.')}>Conhecer o Pro</button></div>}
      {isPro && historyStatus && <p className="workout-feedback__scope">{historyStatus.status === 'unavailable' ? 'O histórico não pôde ser consultado. Nenhuma comparação com sessões anteriores foi feita.' : `A consulta considerou ${historyStatus.reviewedCount} registros recentes. A comparação usa apenas sessões anteriores compatíveis, dentro de 90 dias.${historyStatus.limitReached ? ' Limite de 30 registros atingido; não representa todo o seu histórico.' : ''}`}</p>}

      {current && current.sets.length > 0 && <details className="workout-feedback__details"><summary>Suas séries registradas ({current.sets.length})</summary><ul className="workout-feedback__sets">{current.sets.map((set, index) => <li key={`${set.id}:${index}`}><strong>{set.exerciseName}</strong><span>{set.status === 'interrupted' ? 'Interrompida' : 'Marcada como concluída'} · {formatTime(set.startedAt)}–{formatTime(set.endedAt)}</span><span>{Number.isFinite(set.reps) && set.reps !== null ? `${format(set.reps)} repetições` : 'Repetições não informadas'} · {Number.isFinite(set.loadKg) && set.loadKg !== null ? `${format(set.loadKg)} kg` : 'Carga não informada'}</span></li>)}</ul></details>}
      {samples.length > 0 && <details className="workout-feedback__details"><summary>Leituras recebidas ({samples.length})</summary><p className="workout-feedback__scope">Horários locais do dispositivo. As leituras abaixo não são batimentos em tempo real; valores conflitantes no mesmo horário são excluídos da análise.</p><ol className="workout-feedback__samples">{samples.slice(0, visibleSamples).map((sample, index) => <li key={`${sample.timestamp}:${index}`}><time dateTime={sample.timestamp}>{formatTime(sample.timestamp)}</time><strong>{format(sample.bpm)} bpm</strong></li>)}</ol>{visibleSamples < samples.length && <button type="button" className="workout-feedback__refresh" onClick={() => setVisibleSamples(count => count + 30)}>Mostrar mais leituras</button>}</details>}
      <details className="workout-feedback__details"><summary>Como interpretar e quando buscar ajuda</summary><p>A frequência cardíaca isolada não confirma evolução, técnica ou segurança do exercício. Um batimento mais alto não significa um treino melhor.</p>{deferredInsufficient.map(insight => <div key={insight.id}><p><strong>{insight.title}</strong></p><p>{insight.evidence} {insight.meaning}</p><p>{insight.nextStep}</p></div>)}{feedback?.limitations.map((limitation, index) => <p key={index}>{limitation}</p>)}<p>Se estiver com dor súbita no peito, falta de ar intensa ou desmaio, interrompa o exercício e procure atendimento de emergência. No Brasil, ligue 192. <a href="https://www.gov.br/saude/pt-br/composicao/saes/samu-192" target="_blank" rel="noreferrer">Orientações do SAMU</a>.</p></details>
    </section>
  );
}
