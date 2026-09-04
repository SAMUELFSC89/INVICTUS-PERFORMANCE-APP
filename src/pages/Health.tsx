import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, AlertCircle, ArrowLeft, CalendarDays, ChevronDown, ChevronRight, Clock3, Download, Dumbbell, FileDown, Flame, Footprints, Heart, HeartPulse, Info, MapPin, Moon, Plus, ShieldCheck, SlidersHorizontal, Trophy, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { API_CONFIG } from '../config';
import { Capacitor } from '@capacitor/core';
import { useUser } from '../UserContext';
import { RawWorkoutSession, processUserPerformance, UserPerformanceState } from '../core/performance/performanceEngine';
import { buildHealthInsights } from '../core/health/healthInsights';
import { TimeRange } from '../core/performance/metricCatalog';
import { cn } from '../lib/utils';
import { normalizeActivityValidationStatus, readActivityTimestamp } from '../lib/workoutData';
import { healthSummaryService, HealthSummaryResponse, PontoTendencia } from '../services/healthSummaryService';
import type { HealthVitalsDiagnostics } from '../services/wearables/HealthVitalsProvider';
import { normalizeHeartRateSamples } from '../services/wearables/heartRateSamples';
import { analyzeHeartRateSamples } from '../core/health/heartRateAnalysis';
import { InvictusLogo } from '../components/InvictusLogo';
import { WearableManager } from '../services/wearables/WearableManager';
import './HealthNew.css';
import './HealthConfidence.css';

const ranges: { id: TimeRange; label: string }[] = [
  { id: 'today', label: 'Hoje' },
  { id: '7days', label: '7 Dias' },
  { id: '30days', label: '30 Dias' },
  { id: '90days', label: '3 Meses' },
  { id: 'all', label: 'Personalizado' }
];

function formatDuration(minutes: number) {
  const total = Math.max(0, Math.round(minutes));
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
}

function metricNumber(state: UserPerformanceState, key: string) {
  return Number(state.computedMetrics[key]?.currentValue || 0);
}

function formatUltimaLeitura(timestamp?: string | null): string {
  if (!timestamp) return '';
  const data = new Date(timestamp);
  if (Number.isNaN(data.getTime())) return '';
  return data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function trendPontos(entradas: Array<{ timestamp: string; value: number }>, maxPontos = 14): { value: number; label: string }[] {
  return entradas.slice(-maxPontos).map((item) => {
    const data = new Date(item.timestamp);
    const label = Number.isNaN(data.getTime()) ? '' : data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return { value: item.value, label };
  });
}

// #69: comparação simples "valor mais recente vs média dos 7 dias
// anteriores", usada nos cards e no bloco de tendências. Exige pelo menos
// 2 pontos ANTES da janela dos últimos 7 dias -- sem isso, retorna null em
// vez de inventar uma comparação a partir de amostra insuficiente (mesma
// filosofia de mediaAntesDepois() em healthSummaryService.ts).
interface DeltaInfo { direction: 'up' | 'down' | 'neutral'; diff: number; media: number; }

function deltaVs7Dias(pontos: Array<{ timestamp: string; value: number }> | undefined, valorAtual: number | null): DeltaInfo | null {
  if (!pontos || pontos.length < 3 || valorAtual === null || !Number.isFinite(valorAtual)) return null;
  const seteDiasAtras = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const anteriores = pontos.filter((p) => {
    const t = new Date(p.timestamp).getTime();
    return Number.isFinite(t) && t < seteDiasAtras;
  });
  if (anteriores.length < 2) return null;
  const media = anteriores.reduce((soma, p) => soma + p.value, 0) / anteriores.length;
  if (!Number.isFinite(media) || media === 0) return null;
  const diff = valorAtual - media;
  const direction = Math.abs(diff) < media * 0.01 ? 'neutral' : diff > 0 ? 'up' : 'down';
  return { direction, diff, media };
}

// #291: média dos pontos de tendência dentro dos últimos 7 dias -- usada
// pelos "Indicadores dos últimos 7 dias" da tela Saúde. Sem pontos na
// janela, retorna null em vez de usar um valor de fora do período.
function media7Dias(pontos: Array<{ timestamp: string; value: number }> | undefined): number | null {
  if (!pontos || !pontos.length) return null;
  const seteDiasAtras = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentes = pontos.filter((p) => {
    const t = new Date(p.timestamp).getTime();
    return Number.isFinite(t) && t >= seteDiasAtras;
  });
  if (!recentes.length) return null;
  return recentes.reduce((soma, p) => soma + p.value, 0) / recentes.length;
}

function formatDeltaCurto(delta: DeltaInfo, unidade: string, casasDecimais = 0): string {
  const seta = delta.direction === 'up' ? '↑' : delta.direction === 'down' ? '↓' : '→';
  const valorAbs = Math.abs(delta.diff).toLocaleString('pt-BR', { maximumFractionDigits: casasDecimais });
  return `${seta} ${valorAbs}${unidade ? ` ${unidade}` : ''}`;
}

// #69: "Melhorando/Estável/Observar" -- rótulo textual do bloco de
// Tendências. `direcaoBoa` indica qual direção do delta é considerada
// favorável para aquela métrica especificamente (ex.: FC repouso menor é
// tipicamente favorável, então direcaoBoa='down'; HRV e sono maiores são
// tipicamente favoráveis, então direcaoBoa='up'). Isso é só um rótulo
// visual de referência rápida, não uma avaliação clínica.
function statusPalavra(delta: DeltaInfo | null, direcaoBoa: 'up' | 'down'): string {
  if (!delta) return 'Sem dados';
  if (delta.direction === 'neutral') return 'Estável';
  return delta.direction === direcaoBoa ? 'Melhorando' : 'Observar';
}

function formatRelativo(timestamp?: string | null): string {
  if (!timestamp) return '';
  const data = new Date(timestamp);
  if (Number.isNaN(data.getTime())) return '';
  const diffMin = Math.floor((Date.now() - data.getTime()) / 60000);
  if (diffMin < 2) return 'agora há pouco';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffDias = Math.floor(diffH / 24);
  return diffDias === 1 ? 'há 1 dia' : `há ${diffDias} dias`;
}

interface EstadoHojeResultado { status: string; descricao: string; cor: string; }

// #69: heurística simples e NÃO-CLÍNICA para resumir o "estado de hoje" a
// partir de 3 sinais que já temos (FC repouso, HRV, sono), comparando o
// valor mais recente com a média dos 7 dias anteriores. NÃO é diagnóstico
// nem substitui orientação profissional -- é só um resumo visual rápido,
// e a própria tela deixa isso explícito. Com menos de 2 sinais disponíveis,
// mostra "sem dados suficientes" em vez de inventar um status.
function calcularEstadoDeHoje(fcDelta: DeltaInfo | null, hrvDelta: DeltaInfo | null, sonoDelta: DeltaInfo | null): EstadoHojeResultado {
  const sinaisDisponiveis = [fcDelta, hrvDelta, sonoDelta].filter((d) => d !== null).length;
  if (sinaisDisponiveis < 2) {
    return {
      status: 'SEM DADOS SUFICIENTES',
      descricao: 'Sincronize mais alguns dias de FC de repouso, HRV ou sono para ver um resumo do seu estado de hoje.',
      cor: '#8a8580'
    };
  }
  let pontos = 0;
  if (fcDelta) pontos += fcDelta.direction === 'down' ? 1 : fcDelta.direction === 'up' ? -1 : 0;
  if (hrvDelta) pontos += hrvDelta.direction === 'up' ? 1 : hrvDelta.direction === 'down' ? -1 : 0;
  if (sonoDelta) pontos += sonoDelta.direction === 'up' ? 1 : sonoDelta.direction === 'down' ? -1 : 0;

  if (pontos >= 2) return { status: 'MUITO BOM', descricao: 'Seus sinais recentes de FC de repouso, HRV e sono estão melhores do que a sua média dos últimos dias.', cor: '#46d47b' };
  if (pontos === 1) return { status: 'BOM', descricao: 'A maioria dos seus sinais recentes está estável ou melhorando em relação à sua média dos últimos dias.', cor: '#8fd47b' };
  if (pontos === 0) return { status: 'ESTÁVEL', descricao: 'Seus sinais recentes estão próximos da sua média dos últimos dias, sem grandes variações.', cor: '#ffb000' };
  return { status: 'ATENÇÃO', descricao: 'Alguns sinais recentes (FC de repouso, HRV ou sono) estão piores do que a sua média dos últimos dias. Considere priorizar recuperação.', cor: '#ff8a5b' };
}

function MiniSparkline({ points, color = '#ffb000' }: { points: number[]; color?: string }) {
  if (!points || points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points, min + 1);
  const largura = 100;
  const altura = 28;
  const coords = points.map((valor, indice) => {
    const x = (indice / (points.length - 1)) * largura;
    const y = altura - ((valor - min) / (max - min || 1)) * (altura - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg className="health-metric-spark" viewBox={`0 0 ${largura} ${altura}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={coords.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// #253: leitura da Health Data Layer (health_samples) -- FC repouso, HRV,
// sono e passos. Puramente leitura, atualiza sozinho depois do primeiro
// carregamento, sem bloquear a tela (o RESUMO já mostra o que vier de
// `workouts`/performanceEngine enquanto isso).
function useHealthSummary() {
  const [summary, setSummary] = useState<HealthSummaryResponse | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [syncDiagnostics, setSyncDiagnostics] = useState<HealthVitalsDiagnostics | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (Capacitor.isNativePlatform()) {
        const manager = WearableManager.getInstance();
        await Promise.all([
          manager.syncAll().catch((error) => {
            console.warn('[Health] Sincronização de atividades ao abrir a tela não foi concluída:', error);
          }),
          manager.syncVitals().then((result) => {
            if (active && result.diagnostics) setSyncDiagnostics(result.diagnostics);
          }).catch((error) => {
            console.warn('[Health] Sincronização de vitais ao abrir a tela não foi concluída:', error);
          })
        ]);
      }
      const data = await healthSummaryService.fetchSummary();
      if (active) { setSummary(data); setLoadingSummary(false); }
    };
    void load();
    return () => { active = false; };
  }, []);

  return { summary, loadingSummary, syncDiagnostics };
}

const HEALTH_GLOSSARY = [
  ['HRV', 'Variação do tempo entre batimentos. Ajuda a acompanhar recuperação e estresse quando comparada à sua própria média.'],
  ['FC em repouso', 'Batimentos por minuto quando o corpo está descansando. A tendência pessoal costuma ser mais útil que uma leitura isolada.'],
  ['VO₂ máx.', 'Estimativa de quanto oxigênio seu corpo consegue usar no esforço. É um indicador de condicionamento aeróbico.'],
  ['Oxigenação', 'Percentual de oxigênio transportado no sangue. Relógios fornecem estimativas e não substituem equipamento médico.'],
  ['Sono', 'Tempo reconhecido pelo dispositivo como sono. Horários, estágios e qualidade dependem do sensor usado.'],
  ['Gasto energético estimado', 'Estimativa de energia além do gasto básico do corpo. Pode variar conforme dispositivo, algoritmo e contexto.'],
  ['Frequência respiratória', 'Quantidade de respirações por minuto. Compare principalmente com seu padrão habitual.'],
  ['Cobertura', 'Mostra quantos dias e leituras sustentam a análise; pouca cobertura reduz a confiança da tendência.']
];

function HealthGlossary() {
  const [permissionStatus, setPermissionStatus] = useState('');
  const updatePermissions = async () => {
    setPermissionStatus('Abrindo permissões…');
    try {
      const updated = await WearableManager.getInstance().refreshHealthPermissions();
      setPermissionStatus(updated ? 'Permissões e leituras atualizadas.' : 'Conecte o Apple Health ou Health Connect no Perfil.');
    } catch {
      setPermissionStatus('Não foi possível atualizar as permissões agora.');
    }
  };
  return <section className="health-glossary"><div className="health-section-name">ENTENDA SEUS DADOS <Info /></div><div>{HEALTH_GLOSSARY.map(([term, explanation]) => <article key={term}><strong>{term}</strong><p>{explanation}</p></article>)}</div><small>Estas informações são educativas e não constituem diagnóstico ou orientação médica.</small>{Capacitor.isNativePlatform() ? <button className="health-permission-update" onClick={updatePermissions}>ATUALIZAR PERMISSÕES DE SAÚDE</button> : null}{permissionStatus ? <p className="health-permission-status" role="status">{permissionStatus}</p> : null}</section>;
}

function HealthSyncStatus({ diagnostics, loading }: { diagnostics: HealthVitalsDiagnostics | null; loading: boolean }) {
  if (!Capacitor.isNativePlatform()) return null;
  if (loading && !diagnostics) return <section className="health-sync-status is-loading" aria-live="polite"><Activity /> <span>Atualizando dados do Apple Health/Health Connect…</span></section>;
  if (!diagnostics) return <section className="health-sync-status" aria-live="polite"><AlertCircle /> <span>Não foi possível confirmar agora se o dispositivo entregou batimentos e passos. Toque em “Atualizar permissões de saúde” para tentar novamente.</span></section>;

  const heartRate = diagnostics.reads.find((read) => read.dataType === 'heartRate');
  const steps = diagnostics.reads.find((read) => read.dataType === 'steps');
  const hasErrors = diagnostics.failedTypes.includes('heartRate') || diagnostics.failedTypes.includes('steps');
  const missingCoreData = heartRate?.status !== 'ok' || steps?.status !== 'ok';
  const statusText = hasErrors
    ? 'Houve uma falha ao consultar uma das métricas principais.'
    : missingCoreData
      ? 'O dispositivo respondeu, mas não entregou batimentos e/ou passos nesta janela.'
      : 'Batimentos e passos foram lidos ativamente do dispositivo.';
  return <section className={cn('health-sync-status', missingCoreData && 'has-warning')} aria-live="polite"><div><span className="health-sync-status-icon">{missingCoreData ? <AlertCircle /> : <ShieldCheck />}</span><strong>{statusText}</strong></div><p><span>Batimentos: {heartRate?.status === 'ok' ? `${heartRate.count} leituras` : heartRate?.status === 'error' ? 'erro de leitura' : 'nenhuma leitura'}</span><span>Passos: {steps?.status === 'ok' ? `${steps.count} dias agregados` : steps?.status === 'error' ? 'erro de leitura' : 'nenhum dia'}</span></p>{missingCoreData ? <small>Verifique no app Saúde se o Invictus tem acesso a “Batimentos” e “Passos”. O Invictus não cria valores quando a fonte não entrega a leitura.</small> : <small>Última consulta: {formatUltimaLeitura(diagnostics.until)} · valores exibidos abaixo vêm dessa leitura.</small>}</section>;
}

function HealthInsightsSection({ summary, state }: { summary: HealthSummaryResponse | null; state: UserPerformanceState }) {
  const insights = useMemo(() => buildHealthInsights({
    summary,
    workouts: state.healthTimeframeWorkouts.map((workout) => ({
      timestamp: workout.timestamp,
      durationMinutes: workout.durationMinutes,
      avgHeartRate: workout.avgHeartRate,
      distanceKm: workout.distanceKm,
      workoutType: workout.workoutType
    }))
  }), [summary, state.healthTimeframeWorkouts]);
  if (!insights.length) return null;
  return <section className="health-insights" aria-label="Análises da Invictus"><div className="health-section-name"><HeartPulse /> LEITURAS DA INVICTUS</div><div className="health-insights-list">{insights.map((insight) => <article key={insight.id} className={`is-${insight.kind}`}><div className="health-insight-heading"><strong>{insight.title}</strong><span>{insight.kind === 'congratulations' ? 'PARABÉNS' : insight.kind === 'alert' ? 'ATENÇÃO' : insight.kind === 'decline' ? 'OBSERVE' : 'EVOLUÇÃO'}</span></div><p>{insight.message}</p><small>{insight.evidence}</small></article>)}</div><small className="health-insights-note">As mensagens descrevem tendências dos seus próprios dados; não são diagnóstico nem substituem avaliação profissional.</small></section>;
}

const HEALTH_METRIC_LABELS: Record<string, string> = {
  heart_rate: 'Batimentos', heart_rate_resting: 'FC em repouso', hrv_rmssd: 'HRV',
  sleep_duration_min: 'Sono', steps_daily: 'Passos', weight_kg: 'Peso',
  calories_active: 'Gasto energético estimado', distance_km: 'Distância', respiratory_rate: 'Respiração',
  oxygen_saturation: 'Oxigenação', vo2max_estimate: 'VO₂ máx.',
  blood_pressure_systolic: 'Pressão sistólica', blood_pressure_diastolic: 'Pressão diastólica',
  body_fat_percent: 'Gordura corporal', hydration_l: 'Hidratação'
};

const CONFIDENCE_LABELS: Record<string, string> = { A: 'Alta confiança', B: 'Boa confiança', C: 'Confiança moderada', D: 'Confiança limitada', E: 'Evidência insuficiente' };

function ConfidenceDetails({ sample, metric, onClose }: { sample: NonNullable<HealthSummaryResponse['latest'][keyof HealthSummaryResponse['latest']]>; metric: string; onClose: () => void }) {
  const confidence = sample.confidenceAtMeasurement || sample.currentEvidenceConfidence;
  const [catalog, setCatalog] = useState<Array<{ brand?: string; family?: string; models?: string[] }>>([]);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [status, setStatus] = useState('');
  const unknown = confidence?.provenanceStatus === 'UNKNOWN_DEVICE' || confidence?.provenanceStatus === 'LEGACY_UNKNOWN_SOURCE';
  useEffect(() => {
    if (!unknown) return;
    auth.currentUser?.getIdToken().then((token) => fetch(`${API_CONFIG.baseUrl || ''}/api/health-confidence?action=catalog`, { headers: { Authorization: `Bearer ${token}` } }))
      .then((response) => response.json()).then((payload) => setCatalog(Array.isArray(payload.catalog) ? payload.catalog : [])).catch(() => setCatalog([]));
  }, [unknown]);
  const selected = catalog.find((item) => item.brand === brand);
  const saveDevice = async () => {
    if (!brand || !model || !auth.currentUser) return;
    setStatus('Salvando identificação…');
    try {
      const token = await auth.currentUser.getIdToken();
      const response = await fetch(`${API_CONFIG.baseUrl || ''}/api/health-confidence`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'declare-device', integration: sample.provenance?.integration, dataOrigin: sample.provenance?.dataOrigin, brand, model, effectiveFrom: sample.timestamp }) });
      setStatus(response.ok ? 'Dispositivo identificado para novas leituras compatíveis.' : 'Não foi possível salvar agora.');
    } catch { setStatus('Não foi possível salvar agora.'); }
  };
  return createPortal(<div className="health-confidence-overlay" role="dialog" aria-modal="true" aria-label="Confiança da medição" onClick={onClose}><section onClick={(event) => event.stopPropagation()}>
    <button className="health-confidence-close" onClick={onClose} aria-label="Fechar">×</button>
    <span className={`health-confidence-badge level-${confidence?.confidenceLevel || 'E'}`}>{confidence?.confidenceLevel || 'E'} — {CONFIDENCE_LABELS[confidence?.confidenceLevel || 'E']}</span>
    <h2>{HEALTH_METRIC_LABELS[metric] || metric}</h2><p>{confidence?.confidenceReason || 'Esta leitura histórica não possui proveniência completa.'}</p>
    <dl><div><dt>Dispositivo</dt><dd>{sample.provenance?.deviceName || sample.provenance?.deviceModel || sample.device || 'Não identificado'}</dd></div><div><dt>Origem</dt><dd>{sample.provenance?.dataOrigin || sample.source || 'Desconhecida'}</dd></div><div><dt>Integração</dt><dd>{sample.provenance?.integration || 'Desconhecida'}</dd></div><div><dt>Contexto</dt><dd>{confidence?.measurementContext || sample.measurementContext || 'Não identificado'}</dd></div><div><dt>Versão</dt><dd>{confidence?.confidenceEngineVersion || 'legado'}</dd></div></dl>
    <h3>O que pode afetar a medição?</h3><ul>{(confidence?.limitations?.length ? confidence.limitations : ['Dispositivo, contexto e qualidade do sinal não estão completamente identificados.']).map((item) => <li key={item}>{item}</li>)}</ul>
    {confidence?.evidenceReferences?.length ? <><h3>Evidências científicas</h3>{confidence.evidenceReferences.map((reference) => <a key={reference.id} href={reference.url} target="_blank" rel="noreferrer">{reference.title} · {reference.scope}</a>)}</> : <p>Não há evidência específica associada a esta combinação de dispositivo, métrica e contexto.</p>}
    {unknown && catalog.length > 0 ? <div className="health-device-identify"><h3>Ajude a identificar seu dispositivo</h3><p>Informe seu relógio ou dispositivo para melhorarmos a avaliação. Essa declaração não é verificação técnica.</p><select value={brand} onChange={(event) => { setBrand(event.target.value); setModel(''); }}><option value="">Marca</option>{catalog.map((item) => <option key={`${item.brand}-${item.family}`} value={item.brand}>{item.brand} · {item.family}</option>)}</select><select value={model} onChange={(event) => setModel(event.target.value)} disabled={!brand}><option value="">Modelo</option>{(selected?.models || ['Não sei meu modelo']).map((item) => <option key={item}>{item}</option>)}</select><button onClick={saveDevice} disabled={!brand || !model}>CONFIRMAR</button>{status && <small role="status">{status}</small>}</div> : null}
    <small>O nível representa a confiança na medição e não constitui diagnóstico médico.</small>
  </section></div>, document.body);
}

function HealthMetricLibrary({ summary }: { summary: HealthSummaryResponse | null }) {
  const [selected, setSelected] = useState<{ metric: string; sample: NonNullable<HealthSummaryResponse['latest'][keyof HealthSummaryResponse['latest']]> } | null>(null);
  const rows = Object.entries(summary?.latest || {}).filter((entry) => entry[1]);
  if (!rows.length) return null;
  return <section className="health-metric-library"><div className="health-section-name">ÚLTIMAS LEITURAS <Info /></div><div>{rows.map(([metric, sample]) => sample ? <article key={metric}><div><strong>{HEALTH_METRIC_LABELS[metric] || metric}</strong><b>{sample.value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} <small>{sample.unit}</small></b></div><p>{formatUltimaLeitura(sample.endDate || sample.timestamp)} · {sample.device || (sample.source === 'apple_health' ? 'Apple Health' : sample.source === 'health_connect' ? 'Health Connect' : 'Fonte sincronizada')}</p><button className={`health-confidence-badge level-${(sample.confidenceAtMeasurement || sample.currentEvidenceConfidence)?.confidenceLevel || 'E'}`} onClick={() => setSelected({ metric, sample })}>{(sample.confidenceAtMeasurement || sample.currentEvidenceConfidence)?.confidenceLevel || 'E'} — {CONFIDENCE_LABELS[(sample.confidenceAtMeasurement || sample.currentEvidenceConfidence)?.confidenceLevel || 'E']}</button><code title="Identificador da leitura">{sample.sampleId ? `ID ${sample.sampleId.slice(0, 24)}` : 'ID derivado da data e origem'}</code></article> : null)}</div>{selected && <ConfidenceDetails metric={selected.metric} sample={selected.sample} onClose={() => setSelected(null)} />}</section>;
}

function useHealthData(range: TimeRange) {
  const { user } = useUser();
  const [state, setState] = useState<UserPerformanceState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const snapshot = await getDocs(query(collection(db, 'workouts'), where('userId', '==', user.uid)));
        const workouts = snapshot.docs.reduce<RawWorkoutSession[]>((result, entry) => {
          const item = entry.data();
          const timestamp = readActivityTimestamp(item.timestamp) ?? readActivityTimestamp(item.createdAt);
          const validationStatus = normalizeActivityValidationStatus(item.validationStatus ?? item.status ?? item.validation?.status);
          const isWearable = item.source === 'apple_health' || item.source === 'health_connect';
          const heartRateSamples = normalizeHeartRateSamples(item.heartRateSamples);
          const hasHealthTelemetry = heartRateSamples.length > 0
            || Number(item.steps) > 0 || Number(item.avgHeartRate || item.averageHeartRate) > 0
            || Number(item.maxHeartRate || item.maxHr) > 0 || Number(item.calories || item.caloriesBurned) > 0
            || Number(item.distance || item.distanceKm) > 0;
          const isHealthOnly = isWearable && validationStatus !== 'validated'
            && item.nonScoringReason !== 'DUPLICATE_ACTIVITY' && hasHealthTelemetry;
          // A tela de Saúde aceita uma atividade health_only quando veio do
          // dispositivo com telemetria real. Ela não entra nas métricas/IGA
          // competitivos; serve para curva, zonas e contexto pessoal.
          if (!timestamp || (validationStatus !== 'validated' && !isHealthOnly)) return result;
          result.push({
            id: entry.id,
            userId: item.userId || user.uid,
            timestamp,
            durationMinutes: Number(item.durationMinutes) || Number(item.duration) || 0,
            avgHeartRate: Number(item.avgHeartRate) || Number(item.avgHr) || 0,
            maxHeartRate: Number(item.maxHeartRate) || Number(item.maxHr) || 0,
            steps: Number(item.steps) > 0 ? Math.round(Number(item.steps)) : undefined,
            heartRateSamples: heartRateSamples.length ? heartRateSamples : undefined,
            caloriesBurned: Number(item.caloriesBurned) || Number(item.calories) || 0,
            distanceKm: Number(item.distanceKm) || Number(item.distance) || 0,
            workoutType: item.workoutType || item.type || 'activity',
            workoutName: item.workoutName || item.title || item.cardioTypeLabel || 'Atividade registrada',
            validationStatus: isHealthOnly ? 'health_only' : validationStatus || 'pending',
            source: typeof item.source === 'string' ? item.source : undefined,
            hasSensorData: Boolean(item.avgHeartRate || item.maxHeartRate || heartRateSamples?.length),
            hasGPSData: Boolean(item.distanceKm || item.distance || item.gpsTracked)
          });
          return result;
        }, []);
        if (active) setState(processUserPerformance(workouts, { ...user, uid: user.uid, name: user.name || user.displayName }, range));
      } catch (error) {
        console.error('[Health] Não foi possível carregar os dados de saúde:', error);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [range, user]);

  return { user, state, loading };
}

function HealthHeader({ title, subtitle, onBack, right }: { title: string; subtitle: string; onBack: () => void; right?: React.ReactNode }) {
  return <><div className="health-brand"><InvictusLogo size={42} /><span><b>INVICTUS</b><small>PERFORMANCE</small></span></div><header className="health-header"><button aria-label="Voltar" onClick={onBack} className="health-back"><ArrowLeft /></button><div className="health-heading"><div><h1>{title}</h1><span className="health-pro">PRO</span></div><p>{subtitle}</p></div>{right}</header></>;
}

export function HealthFooter({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  return <nav className="health-new-footer"><button onClick={() => navigate('/')}><InvictusLogo size={24} /><span>Início</span></button><button onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button><button className="is-plus" onClick={() => navigate('/activity')} aria-label="Escolher modalidade"><Plus /></button><button onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button><button className="is-active" onClick={() => navigate('/profile')}><UserRound /><span>Perfil</span></button></nav>;
}

function PeriodControl({ value, onChange, compact = false }: { value: TimeRange; onChange: (value: TimeRange) => void; compact?: boolean }) {
  if (compact) return <div className="health-period-bar"><span>PERÍODO</span>{ranges.map((range) => <button key={range.id} onClick={() => onChange(range.id)} className={cn(value === range.id && 'is-selected')}>{range.label}</button>)}<CalendarDays aria-hidden="true" /></div>;
  const selected = ranges.find((item) => item.id === value) || ranges[1];
  return <button className="health-period-picker" onClick={() => onChange(value === '7days' ? '30days' : '7days')}><CalendarDays />{selected.label.toUpperCase()}<ChevronDown /></button>;
}

const CORES_POR_TOM: Record<string, string> = { gold: '#ffb000', red: '#ff515b', violet: '#b98bff', blue: '#4d9fff', green: '#46d47b' };

function MetricCard({
  icon, label, value, unit, detail, tone = 'gold', progress, onTap, delta, deltaUnit = '', deltaDecimais = 0, sparklinePoints
}: {
  icon: React.ReactNode; label: string; value: string | number; unit?: string; detail: string;
  tone?: 'gold' | 'red' | 'violet' | 'blue' | 'green'; progress?: number; onTap?: () => void;
  delta?: DeltaInfo | null; deltaUnit?: string; deltaDecimais?: number; sparklinePoints?: number[];
}) {
  const cor = CORES_POR_TOM[tone] || CORES_POR_TOM.gold;
  const conteudo = <>
    <div className="health-metric-top">
      <div className={cn('health-metric-icon', tone === 'red' && 'is-red')} style={{ color: cor }}>{icon}</div>
      {onTap && <ChevronRight className="health-metric-chevron" aria-hidden="true" />}
    </div>
    <span>{label}</span>
    <strong>{value}<small>{unit}</small></strong>
    <p>{detail}</p>
    {delta && (
      <div className="health-metric-delta" style={{ color: cor }}>
        {formatDeltaCurto(delta, deltaUnit, deltaDecimais)} vs média 7 dias
      </div>
    )}
    {progress !== undefined && <div className="health-small-progress"><b style={{ width: `${Math.min(100, progress)}%` }} /></div>}
    {sparklinePoints && sparklinePoints.length >= 2 && <MiniSparkline points={sparklinePoints} color={cor} />}
  </>;
  if (onTap) {
    return <article role="button" tabIndex={0} onClick={onTap} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); } }} className="health-metric is-tappable">{conteudo}</article>;
  }
  return <article className="health-metric">{conteudo}</article>;
}

function ChartBars({ points, color = 'gold' }: { points: { value: number; label: string }[]; color?: 'gold' | 'violet' }) {
  if (!points.length) return <p className="health-empty">Sem dados registrados para este gráfico.</p>;
  const max = Math.max(...points.map((item) => item.value), 1);
  return <div className={cn('health-chart-bars', color === 'violet' && 'is-violet')} aria-label="Gráfico de tendência">{points.map((point, index) => <div key={`${point.label}-${index}`}><i style={{ height: `${Math.max(4, Math.round((point.value / max) * 100))}%` }} /><span>{point.label}</span></div>)}</div>;
}

function HeartRateCurve({ state }: { state: UserPerformanceState }) {
  const workout = [...state.healthTimeframeWorkouts]
    .sort((a, b) => b.timestamp - a.timestamp)
    .find((item) => (item.heartRateSamples?.length || 0) >= 2);
  const samples = workout?.heartRateSamples || [];
  if (!workout || samples.length < 2) {
    return <article className="health-heart-curve"><div className="health-section-name">CURVA DE BATIMENTOS <Info /></div><p className="health-empty">A atividade sincronizada não trouxe pontos suficientes de batimentos para desenhar a curva.</p></article>;
  }

  const curveAnalysis = analyzeHeartRateSamples(samples);
  if (curveAnalysis.coverageSeconds <= 0) {
    return <article className="health-heart-curve"><div className="health-section-name">CURVA DE BATIMENTOS <Info /></div><p className="health-empty">As leituras chegaram, mas não há dois pontos consecutivos próximos o suficiente para desenhar uma curva confiável.</p></article>;
  }

  const maxPoints = 180;
  const displaySamples = samples.length > maxPoints
    ? Array.from({ length: maxPoints }, (_, index) => samples[Math.round((index * (samples.length - 1)) / (maxPoints - 1))])
    : samples;
  const width = 360;
  const height = 140;
  const padding = 12;
  const values = displaySamples.map((sample) => sample.bpm);
  const min = Math.max(30, Math.floor(Math.min(...values) / 5) * 5 - 5);
  const max = Math.min(240, Math.ceil(Math.max(...values) / 5) * 5 + 5);
  const segments: string[][] = [[]];

  displaySamples.forEach((sample, index) => {
    const previous = displaySamples[index - 1];
    const gapSeconds = previous
      ? (new Date(sample.timestamp).getTime() - new Date(previous.timestamp).getTime()) / 1000
      : 0;
    if (previous && (!Number.isFinite(gapSeconds) || gapSeconds <= 0 || gapSeconds > 60)) segments.push([]);
    const x = padding + (index / Math.max(1, displaySamples.length - 1)) * (width - padding * 2);
    const y = height - padding - ((sample.bpm - min) / Math.max(1, max - min)) * (height - padding * 2);
    segments[segments.length - 1].push([x.toFixed(1), y.toFixed(1)].join(','));
  });

  const visibleSegments = segments.filter((segment) => segment.length >= 2);
  const firstLabel = new Date(displaySamples[0].timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const lastLabel = new Date(displaySamples[displaySamples.length - 1].timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return <article className="health-heart-curve"><div className="health-section-name">CURVA DE BATIMENTOS <Info /></div><div className="health-heart-curve-heading"><strong>{Math.round(curveAnalysis.coverageSeconds / 60)} min</strong><span>{workout.workoutName || 'Último treino'} · {samples.length} pontos reais</span></div><svg className="health-heart-curve-chart" viewBox={'0 0 ' + width + ' ' + height} role="img" aria-label={'Curva de frequência cardíaca com ' + samples.length + ' pontos reais'}><line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} />{visibleSegments.map((segment, index) => <polyline key={'hr-segment-' + index} points={segment.join(' ')} fill="none" stroke="#ff515b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />)}</svg><div className="health-heart-curve-labels"><span>{firstLabel}</span><span>{lastLabel}</span></div><small>O gráfico usa somente leituras recebidas do dispositivo; lacunas longas não são conectadas.</small></article>;
}


function ZoneChart({ state, onDetails }: { state: UserPerformanceState; onDetails?: () => void }) {
  const total = state.heartRateCoverageMinutes || 0;
  const zones = state.hrZones;
  const hasZoneData = Boolean(state.computedMetrics.hr_zones_distribution?.hasEnoughData);
  if (!hasZoneData) return <article className="health-zone-card"><div className="health-section-name">DISTRIBUIÇÃO DE ZONAS CARDÍACAS <Info /></div><p className="health-empty">Conecte um sensor que registre zonas cardíacas para visualizar esta distribuição.</p></article>;
  const stops = zones.reduce<string[]>((result, zone, index) => {
    const previous = zones.slice(0, index).reduce((sum, item) => sum + item.percent, 0);
    return [...result, `${zone.color} ${previous}% ${previous + zone.percent}%`];
  }, []);
  return <article className="health-zone-card"><div className="health-section-name">DISTRIBUIÇÃO DE ZONAS CARDÍACAS <Info /></div><div className="health-zone-body"><div className="health-donut" style={{ background: `conic-gradient(${stops.join(',')})` }}><div><small>Tempo coberto</small><strong>{formatDuration(total)}</strong></div></div><div className="health-zone-list">{zones.map((zone) => <div key={zone.zoneName}><i style={{ background: zone.color, boxShadow: `0 0 9px ${zone.color}` }} /><span>{zone.zoneName.replace(/ \(.+\)/, '')}</span><b>{formatDuration(zone.minutes)}</b><em>{zone.percent}%</em></div>)}</div></div>{onDetails && <button onClick={onDetails} className="health-card-link">VER DETALHES <ChevronRight /></button>}</article>;
}

function LatestWorkouts({ state, expanded, onToggle }: { state: UserPerformanceState; expanded: boolean; onToggle: () => void }) {
  const allWorkouts = [...state.healthTimeframeWorkouts].sort((a, b) => b.timestamp - a.timestamp);
  const workouts = expanded ? allWorkouts : allWorkouts.slice(0, 2);
  return <article id="health-activities" className="health-latest"><div className="health-section-line"><div>ÚLTIMAS ATIVIDADES RECEBIDAS</div><button type="button" onClick={onToggle}>{expanded ? 'MOSTRAR MENOS' : 'VER TODOS'}</button></div>{workouts.length ? workouts.map((workout) => { const isRun = /corrida|run/i.test(workout.workoutType || ''); const healthOnly = workout.validationStatus === 'health_only'; return <div className="health-workout" key={workout.id}><span className={cn('health-workout-icon', isRun && 'is-run')}>{isRun ? <Footprints /> : <Dumbbell />}</span><div><b>{workout.workoutName}</b><small>{new Date(workout.timestamp).toLocaleDateString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}{workout.steps ? ` · ${workout.steps.toLocaleString('pt-BR')} passos` : ''}{healthOnly ? ' · Saúde · fora do ranking' : ''}</small></div><span><Clock3 />{formatDuration(workout.durationMinutes)}</span><span><Flame />{Math.round(workout.caloriesBurned || 0)} kcal</span><span><Heart />{workout.avgHeartRate || '—'} bpm</span><ChevronRight /></div>; }) : <p className="health-empty">Quando o dispositivo sincronizar uma atividade, ela aparecerá aqui. A homologação competitiva é uma etapa separada.</p>}</article>;
}

type SaudeTab = 'saude' | 'atividades' | 'recuperacao' | 'tendencias';

// #291: 5 abas conforme a imagem de referência (SAÚDE/ATIVIDADES/
// RECUPERAÇÃO/TENDÊNCIAS/RELATÓRIO). "TENDÊNCIAS" consolida o conteúdo que
// antes vivia em 3 abas separadas (CORAÇÃO, ENERGIA, PERFORMANCE) -- nada
// foi apagado, só reorganizado sob o nome que a referência usa. RELATÓRIO
// não é uma aba com conteúdo próprio: é um atalho para a rota /health/report
// já existente (evita duplicar o relatório completo dentro da aba).
const SAUDE_TABS: { id: SaudeTab; label: string }[] = [
  { id: 'saude', label: 'SAÚDE' },
  { id: 'atividades', label: 'ATIVIDADES' },
  { id: 'recuperacao', label: 'RECUPERAÇÃO' },
  { id: 'tendencias', label: 'TENDÊNCIAS' }
];

// #291: "Seu Corpo × Seus Treinos". Carga recente e prontidão NÃO são
// inventadas aqui -- o backend (performanceEngine.ts, métricas
// acute_chronic_workload_ratio/recovery_index) já deixa essas duas
// explicitamente "Indisponível" até existir uma sessão de atividade
// server-authoritative auditada (backlog #129). Mostramos isso com
// honestidade em vez de calcular um número paralelo que contradiga o motor
// oficial. "Recuperação" reaproveita a MESMA heurística já usada no card
// "Estado de Hoje" (calcularEstadoDeHoje) -- não é um segundo cálculo.
function SeuCorpoXSeusTreinosCard({ activityCount72h, estadoHoje, onVerAnalise }: {
  activityCount72h: number; estadoHoje: EstadoHojeResultado; onVerAnalise: () => void;
}) {
  const semDados = estadoHoje.status === 'SEM DADOS SUFICIENTES';
  return (
    <article className="health-overview health-body-card">
      <div className="health-section-name">SEU CORPO × SEUS TREINOS <Info /></div>
      <p className="health-body-summary">
        {activityCount72h > 0 ? `${activityCount72h} atividade${activityCount72h > 1 ? 's' : ''} nas últimas 72h. ` : 'Sem atividades sincronizadas nas últimas 72h. '}
        {semDados ? 'Ainda não há sinais suficientes para comparar sua recuperação com o seu padrão.' : `Seus indicadores de recuperação estão ${estadoHoje.status.toLowerCase()} em relação ao seu padrão.`}
      </p>
      <div className="health-body-grid">
        <div className="health-body-rows">
          <div><span>CARGA RECENTE</span><b className="is-muted">Indisponível</b></div>
          <div><span>RECUPERAÇÃO</span><b style={{ color: semDados ? '#8a8580' : estadoHoje.cor }}>{semDados ? 'Sem dados' : estadoHoje.status}</b></div>
          <div><span>PRONTIDÃO</span><b className="is-muted">Indisponível</b></div>
        </div>
        <div className="health-body-illustration" role="img" aria-label="Ilustração corporal de recuperação (em preparação)">
          <UserRound aria-hidden="true" />
          <small>Ilustração em preparação</small>
        </div>
      </div>
      <button type="button" className="health-card-link" onClick={onVerAnalise}>VER ANÁLISE COMPLETA <ChevronRight /></button>
    </article>
  );
}

// #291: "Último Treino" -- um card único com o treino mais recente
// (diferente de LatestWorkouts, que é a lista). Volume e séries de
// musculação são mostrados como "Não registrado" porque o Invictus hoje
// não persiste carga/repetições executadas por série (confirmado: não há
// esse campo em RawWorkoutSession nem na coleção `workouts`) -- mostrar um
// número aqui seria inventar dado. Para cardio, usamos distância/ritmo reais
// quando o treino tem GPS.
function UltimoTreinoCard({ workout, onVerDetalhes }: { workout: RawWorkoutSession | null; onVerDetalhes: () => void }) {
  if (!workout) {
    return <article className="health-overview health-last-workout"><div className="health-section-name">ÚLTIMO TREINO <Info /></div><p className="health-empty">Quando o dispositivo sincronizar um treino, ele aparecerá aqui.</p></article>;
  }
  const isRun = /corrida|run|cardio|bike|ciclismo|caminhada/i.test(workout.workoutType || '');
  const dataLabel = `${new Date(workout.timestamp).toLocaleDateString('pt-BR', { weekday: 'short' })} · ${new Date(workout.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  const ritmoMin = isRun && workout.distanceKm && workout.distanceKm > 0 && workout.durationMinutes > 0 ? workout.durationMinutes / workout.distanceKm : null;
  const ritmoLabel = ritmoMin ? `${Math.floor(ritmoMin)}:${String(Math.round((ritmoMin % 1) * 60)).padStart(2, '0')} min/km` : null;
  return (
    <article className="health-overview health-last-workout">
      <div className="health-section-line"><div>ÚLTIMO TREINO</div><span className="health-badge">{isRun ? 'CARDIO' : 'MUSCULAÇÃO'}</span></div>
      <p className="health-last-workout-date">{dataLabel}</p>
      <div className="health-last-workout-duration">{formatDuration(workout.durationMinutes)}</div>
      <div className="health-last-workout-grid">
        {isRun ? <>
          <div><span>DISTÂNCIA</span><b>{workout.distanceKm ? `${workout.distanceKm.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km` : '—'}</b></div>
          <div><span>RITMO</span><b>{ritmoLabel || '—'}</b></div>
        </> : <>
          <div><span>VOLUME</span><b className="is-muted">Não registrado</b></div>
          <div><span>SÉRIES</span><b className="is-muted">Não registrado</b></div>
        </>}
        <div><span>FC MÉDIA</span><b>{workout.avgHeartRate ? `${workout.avgHeartRate} bpm` : '—'}</b></div>
        <div><span>FC MÁXIMA</span><b>{workout.maxHeartRate ? `${workout.maxHeartRate} bpm` : '—'}</b></div>
        <div><span>CALORIAS</span><b>{workout.caloriesBurned ? `${Math.round(workout.caloriesBurned)} kcal` : '—'}</b></div>
      </div>
      <button type="button" className="health-card-link" onClick={onVerDetalhes}>VER DETALHES DO TREINO <ChevronRight /></button>
    </article>
  );
}

// #291: "Resposta ao Treino" -- compara o treino mais recente com FC contra
// a média dos outros treinos com FC do mesmo período (mesma fonte de dados
// já usada por avg_heart_rate no performanceEngine). Sem pelo menos 2
// treinos com FC no período, mostra estado vazio em vez de comparar contra
// amostra insuficiente.
function RespostaAoTreinoCard({ state }: { state: UserPerformanceState }) {
  const hrWorkouts = state.healthTimeframeWorkouts.filter((w) => w.avgHeartRate && w.avgHeartRate > 0).sort((a, b) => b.timestamp - a.timestamp);
  if (hrWorkouts.length < 2) {
    return <article className="health-overview health-response-card"><div className="health-section-name">RESPOSTA AO TREINO <Info /></div><p className="health-empty">Precisamos de pelo menos 2 treinos com frequência cardíaca no período para comparar com sua média.</p></article>;
  }
  const [latest, ...rest] = hrWorkouts;
  const baselineHR = rest.reduce((soma, w) => soma + (w.avgHeartRate || 0), 0) / rest.length;
  const hrDiffPercent = baselineHR > 0 ? Math.round((((latest.avgHeartRate || 0) - baselineHR) / baselineHR) * 100) : 0;
  const baselineDuration = rest.reduce((soma, w) => soma + (w.durationMinutes || 0), 0) / rest.length;
  const durationDiffMin = Math.round(latest.durationMinutes - baselineDuration);
  const caloriasComDado = rest.filter((w) => w.caloriesBurned && w.caloriesBurned > 0);
  const baselineCalorias = caloriasComDado.length ? caloriasComDado.reduce((soma, w) => soma + (w.caloriesBurned || 0), 0) / caloriasComDado.length : null;
  const caloriasDiff = baselineCalorias !== null && latest.caloriesBurned ? Math.round(latest.caloriesBurned - baselineCalorias) : null;
  return (
    <article className="health-overview health-response-card">
      <div className="health-section-name">RESPOSTA AO TREINO <Info /></div>
      <p>Comparado aos outros {rest.length} treino{rest.length > 1 ? 's' : ''} com frequência cardíaca do período.</p>
      <div className="health-response-grid">
        <div><span>FC MÉDIA</span><b style={{ color: hrDiffPercent > 0 ? '#ff8a5b' : '#46d47b' }}>{hrDiffPercent > 0 ? '+' : ''}{hrDiffPercent}%</b><small>vs sua média</small></div>
        <div><span>DURAÇÃO</span><b style={{ color: durationDiffMin >= 0 ? '#46d47b' : '#ff8a5b' }}>{durationDiffMin >= 0 ? '+' : ''}{durationDiffMin} min</b><small>vs sua média</small></div>
        <div><span>CALORIAS</span><b>{caloriasDiff !== null ? `${caloriasDiff >= 0 ? '+' : ''}${caloriasDiff} kcal` : '—'}</b><small>vs sua média</small></div>
      </div>
    </article>
  );
}

// #291: "Evolução · 30 dias" -- pace médio e sessões de cardio calculados só
// a partir de treinos com distância+duração reais (GPS); frequência semanal
// de musculação é contagem real de sessões / semanas da janela;
// consistência reaproveita consistency_index já calculado pelo
// performanceEngine (não recalcula em paralelo).
function Evolucao30DiasCard({ state }: { state: UserPerformanceState }) {
  const cardioWorkouts = state.healthTimeframeWorkouts.filter((w) => /corrida|run|cardio|bike|ciclismo|caminhada/i.test(w.workoutType || ''));
  const forcaWorkouts = state.healthTimeframeWorkouts.filter((w) => !/corrida|run|cardio|bike|ciclismo|caminhada/i.test(w.workoutType || ''));
  const cardioComDistancia = cardioWorkouts.filter((w) => w.distanceKm && w.distanceKm > 0 && w.durationMinutes > 0);
  const paceMedio = cardioComDistancia.length ? cardioComDistancia.reduce((soma, w) => soma + w.durationMinutes / (w.distanceKm || 1), 0) / cardioComDistancia.length : null;
  const paceLabel = paceMedio ? `${Math.floor(paceMedio)}:${String(Math.round((paceMedio % 1) * 60)).padStart(2, '0')} min/km` : null;
  const consistency = state.computedMetrics.consistency_index;
  return (
    <article className="health-overview health-evolution-card">
      <div className="health-section-name">EVOLUÇÃO · 30 DIAS <Info /></div>
      <div className="health-evolution-grid">
        <div>
          <span className="health-evolution-label"><Footprints aria-hidden="true" /> CARDIO</span>
          {cardioWorkouts.length ? <>
            <p>Pace médio<b>{paceLabel || '—'}</b></p>
            <p>Sessões no período<b>{cardioWorkouts.length}</b></p>
          </> : <p className="health-empty">Sem sessões de cardio homologadas no período.</p>}
        </div>
        <div>
          <span className="health-evolution-label"><Dumbbell aria-hidden="true" /> MUSCULAÇÃO</span>
          {forcaWorkouts.length ? <>
            <p>Frequência semanal<b>{(forcaWorkouts.length / 4.3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x</b></p>
            <p>Consistência<b>{consistency?.hasEnoughData ? `${consistency.currentValue}%` : '—'}</b></p>
          </> : <p className="health-empty">Sem sessões de musculação homologadas no período.</p>}
        </div>
      </div>
    </article>
  );
}

// #291: "Sono × Performance" -- correlação REAL, calculada em código, entre
// a série de sono (health_samples) e a série de minutos de exercício por dia
// (duration_min, já usada como "exercicioTrend" no RESUMO). Casa os dois
// sinais pelo dia calendário e compara a média de tempo ativo em dias com
// sono >= 7h vs < 7h. Exige pelo menos 3 dias em CADA grupo -- abaixo disso,
// mostra o texto padrão "precisamos de mais dados" em vez de uma correlação
// não confiável. Nenhuma chamada de rede/IA -- só aritmética sobre dados já
// carregados.
function SonoXPerformanceCard({ sonoTrend, performanceTrend }: { sonoTrend: PontoTendencia[]; performanceTrend: PontoTendencia[] }) {
  const porDia = new Map<string, { sono?: number; performance?: number }>();
  sonoTrend.forEach((p) => { const dia = p.timestamp.slice(0, 10); porDia.set(dia, { ...(porDia.get(dia) || {}), sono: p.value }); });
  performanceTrend.forEach((p) => { const dia = p.timestamp.slice(0, 10); porDia.set(dia, { ...(porDia.get(dia) || {}), performance: p.value }); });
  const pares = Array.from(porDia.values()).filter((item): item is { sono: number; performance: number } => item.sono !== undefined && item.performance !== undefined);
  const comSonoBom = pares.filter((p) => p.sono >= 420);
  const comSonoRuim = pares.filter((p) => p.sono < 420);
  if (comSonoBom.length < 3 || comSonoRuim.length < 3) {
    return <article className="health-overview health-sleep-performance-card"><div className="health-section-name">SONO × PERFORMANCE <Info /></div><p className="health-empty">Precisamos de mais dias com sono e atividade registrados no mesmo período para identificar sua relação entre sono e desempenho.</p></article>;
  }
  const mediaBoa = comSonoBom.reduce((soma, p) => soma + p.performance, 0) / comSonoBom.length;
  const mediaRuim = comSonoRuim.reduce((soma, p) => soma + p.performance, 0) / comSonoRuim.length;
  const diffPercent = mediaRuim > 0 ? Math.round(((mediaBoa - mediaRuim) / mediaRuim) * 100) : 0;
  return (
    <article className="health-overview health-sleep-performance-card">
      <div className="health-section-name">SONO × PERFORMANCE <Info /></div>
      <p>Nos dias após sono de 7h ou mais ({comSonoBom.length} dias no período), seu tempo ativo médio foi {Math.abs(diffPercent)}% {diffPercent >= 0 ? 'maior' : 'menor'} do que nos dias com menos de 7h de sono ({comSonoRuim.length} dias).</p>
      <small>Correlação calculada com seus próprios dados sincronizados; não é uma recomendação médica.</small>
    </article>
  );
}

// #291: banner "Insight Invictus IA" -- reaproveita o PRIMEIRO insight já
// calculado deterministicamente por buildHealthInsights (mesma função da
// seção "Leituras da Invictus", sem chamada nova). O botão "Conversar com
// Invictus IA" só NAVEGA para /ai -- não dispara Gemini ao renderizar esta
// tela. A chamada real só acontece se o usuário decidir conversar lá.
function InvictusIACTA({ insights, onOpenChat }: { insights: ReturnType<typeof buildHealthInsights>; onOpenChat: () => void }) {
  const primeiro = insights[0];
  return (
    <article className="health-overview health-ia-cta">
      <div className="health-ia-cta-text">
        <div className="health-section-line"><div>INSIGHT INVICTUS IA</div><span className="health-pro">PRO</span></div>
        <p>{primeiro ? primeiro.message : 'Continue sincronizando seus dados para receber leituras personalizadas da Invictus IA.'}</p>
      </div>
      <button type="button" className="health-ia-cta-button" onClick={onOpenChat}>CONVERSAR COM<br />INVICTUS IA</button>
    </article>
  );
}

// #253/#53: bloco de Gasto Energético -- SEMPRE com o disclaimer. Regra
// explícita do usuário: nunca chamar isso de "kg perdidos". É só uma
// equivalência energética (1kg de gordura ≈ 7700kcal), não uma medida real
// de emagrecimento (que depende de ingestão, hidratação, sono, hormônios...).
const KCAL_POR_KG_GORDURA = 7700;

function EnergyBlock({ calories, deviceCalories = 0 }: { calories: number; deviceCalories?: number }) {
  const hasCalories = calories > 0;
  const kgEquivalente = hasCalories ? calories / KCAL_POR_KG_GORDURA : 0;
  return (
    <article className="health-overview health-energy-card">
      <div className="health-section-line"><div><Flame /> GASTO ENERGÉTICO</div></div>
      <div className="health-energy-row">
        <div className="health-energy-icon"><Flame /></div>
        <div className="health-energy-values">
          <div className="health-energy-value"><strong>{hasCalories ? calories.toLocaleString('pt-BR') : '—'}</strong><span>{hasCalories ? 'kcal no período' : 'Sem calorias de treino no período'}</span></div>
          {hasCalories
            ? <div className="health-energy-kg">≈ {kgEquivalente.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg de gordura*</div>
            : <div className="health-energy-kg">O dispositivo pode fornecer gasto ativo diário abaixo.</div>}
        </div>
      </div>
      {deviceCalories > 0 && <div className="health-energy-device"><strong>{Math.round(deviceCalories).toLocaleString('pt-BR')} kcal</strong><span>Gasto ativo diário mais recente recebido do dispositivo</span></div>}
      <div className="health-energy-disclaimer">
        <AlertCircle />
        <span>*Equivalência energética, não peso realmente perdido — depende de ingestão, hidratação, sono e hormônios.</span>
      </div>
    </article>
  );
}

// #69: bloco "Estado de Hoje" -- combina o status calculado (ver
// calcularEstadoDeHoje, heurística simples e não-clínica) com a arte
// oficial enviada pelo usuário (public/estado-de-hoje.webp), posicionada ao
// lado do texto em vez de como imagem de topo isolada.
function EstadoDeHojeCard({ fcDelta, hrvDelta, sonoDelta, ultimaAtualizacao }: {
  fcDelta: DeltaInfo | null; hrvDelta: DeltaInfo | null; sonoDelta: DeltaInfo | null; ultimaAtualizacao: string | null;
}) {
  const resultado = calcularEstadoDeHoje(fcDelta, hrvDelta, sonoDelta);
  const relativo = formatRelativo(ultimaAtualizacao);
  return (
    <article className="health-hoje-card">
      <div className="health-hoje-text">
        <span className="health-hoje-label">ESTADO DE HOJE</span>
        <div className="health-hoje-status" style={{ color: resultado.cor }}>
          <ShieldCheck aria-hidden="true" /> {resultado.status}
        </div>
        <p>{resultado.descricao}</p>
        {relativo && <span className="health-hoje-updated">Atualizado {relativo}</span>}
      </div>
      <img src="/estado-de-hoje.webp" alt="Invictus" className="health-hoje-art" />
    </article>
  );
}

function HealthSummaryContent({ state, summary, loadingSummary, syncDiagnostics, onGenerateReport, onOpenLegacyReport, onOpenChat }: {
  state: UserPerformanceState;
  summary: HealthSummaryResponse | null;
  loadingSummary: boolean;
  syncDiagnostics: HealthVitalsDiagnostics | null;
  onGenerateReport: () => void;
  onOpenLegacyReport: () => void;
  onOpenChat: () => void;
}) {
  const [activeTab, setActiveTab] = useState<SaudeTab>('saude');
  const [activitiesExpanded, setActivitiesExpanded] = useState(false);

  const calories = metricNumber(state, 'total_calories_burned');
  const minutes = metricNumber(state, 'total_volume_time');
  const workouts = metricNumber(state, 'workout_count');
  const heartRateAvg = metricNumber(state, 'avg_heart_rate');

  const fcRepouso = summary?.latest.heart_rate_resting || null;
  const hrv = summary?.latest.hrv_rmssd || null;
  const sono = summary?.latest.sleep_duration_min || null;
  const passos = summary?.latest.steps_daily || null;
  const caloriasAtivas = summary?.latest.calories_active || null;

  const semDado = loadingSummary ? 'Carregando…' : 'Sem dados sincronizados';

  // #69: séries de tendência (health_samples) usadas para os deltas "vs
  // média 7 dias" e as mini-sparklines dos cards, além da aba Tendências.
  // Cada uma vem direto de /api/health-summary -- nenhum valor é inventado
  // aqui, só comparado.
  const fcTrend = summary?.trends.heart_rate_resting || [];
  const hrvTrend = summary?.trends.hrv_rmssd || [];
  const sonoTrend = summary?.trends.sleep_duration_min || [];
  const passosTrend = summary?.trends.steps_daily || [];
  const exercicioTrend = summary?.trends.duration_min || [];
  const freqRespTrend = summary?.trends.respiratory_rate || [];
  const spo2Trend = summary?.trends.oxygen_saturation || [];

  const fcDelta = deltaVs7Dias(fcTrend, fcRepouso ? fcRepouso.value : null);
  const hrvDelta = deltaVs7Dias(hrvTrend, hrv ? hrv.value : null);
  const sonoDelta = deltaVs7Dias(sonoTrend, sono ? sono.value : null);
  const passosDelta = deltaVs7Dias(passosTrend, passos ? passos.value : null);
  // Exercício: usa o próprio último ponto da série de tendência como
  // "atual" (não o total do período do performanceEngine, que é uma janela
  // diferente) -- assim a comparação fica dentro da mesma fonte de dado.
  const exercicioUltimoPonto = exercicioTrend.length ? exercicioTrend[exercicioTrend.length - 1].value : null;
  const exercicioDelta = deltaVs7Dias(exercicioTrend, exercicioUltimoPonto);

  const ultimaAtualizacaoHoje = [fcRepouso?.timestamp, hrv?.timestamp, sono?.timestamp]
    .filter((t): t is string => Boolean(t))
    .sort()
    .pop() || null;

  // #291: "Seu Corpo × Seus Treinos" -- contagem real de atividades
  // sincronizadas nas últimas 72h (não inventa, só filtra por timestamp).
  const agora = Date.now();
  const activityCount72h = state.healthTimeframeWorkouts.filter((w) => agora - w.timestamp <= 72 * 60 * 60 * 1000).length;
  const estadoHoje = calcularEstadoDeHoje(fcDelta, hrvDelta, sonoDelta);
  const ultimoTreino = [...state.healthTimeframeWorkouts].sort((a, b) => b.timestamp - a.timestamp)[0] || null;

  // #291: insight reaproveitado (mesmo cálculo determinístico de
  // HealthInsightsSection) só para o texto do banner "Insight Invictus IA" --
  // nenhuma chamada de rede/IA é feita aqui.
  const insightsParaIA = useMemo(() => buildHealthInsights({
    summary,
    workouts: state.healthTimeframeWorkouts.map((workout) => ({
      timestamp: workout.timestamp,
      durationMinutes: workout.durationMinutes,
      avgHeartRate: workout.avgHeartRate,
      distanceKm: workout.distanceKm,
      workoutType: workout.workoutType
    }))
  }), [summary, state.healthTimeframeWorkouts]);

  return (
    <>
      <HealthSyncStatus diagnostics={syncDiagnostics} loading={loadingSummary} />
      <div className="health-tabs">
        {SAUDE_TABS.map((tab) => (
          <button key={tab.id} className={activeTab === tab.id ? 'is-active' : ''} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>
        ))}
        <button className="health-tab-relatorio" onClick={onGenerateReport}>RELATÓRIO <span className="health-pro">PRO</span></button>
      </div>

      {activeTab === 'saude' && (
        <>
          <EstadoDeHojeCard fcDelta={fcDelta} hrvDelta={hrvDelta} sonoDelta={sonoDelta} ultimaAtualizacao={ultimaAtualizacaoHoje} />
          <SeuCorpoXSeusTreinosCard activityCount72h={activityCount72h} estadoHoje={estadoHoje} onVerAnalise={() => setActiveTab('recuperacao')} />
          <UltimoTreinoCard workout={ultimoTreino} onVerDetalhes={() => setActiveTab('atividades')} />
          <RespostaAoTreinoCard state={state} />
          <Evolucao30DiasCard state={state} />
          <SonoXPerformanceCard sonoTrend={sonoTrend} performanceTrend={exercicioTrend} />

          <section id="health-overview" className="health-overview">
            <div className="health-section-line"><div><Activity /> INDICADORES DOS ÚLTIMOS 7 DIAS</div></div>
            <div className="health-metrics-grid-3">
              <MetricCard icon={<Heart />} label="FC REPOUSO" value={media7Dias(fcTrend) !== null ? Math.round(media7Dias(fcTrend)!) : '—'} unit={media7Dias(fcTrend) !== null ? 'bpm' : ''} detail="Média" tone="red" onTap={() => setActiveTab('tendencias')} delta={fcDelta} deltaUnit="bpm" sparklinePoints={fcTrend.map((p) => p.value)} />
              <MetricCard icon={<HeartPulse />} label="HRV" value={media7Dias(hrvTrend) !== null ? Math.round(media7Dias(hrvTrend)!) : '—'} unit={media7Dias(hrvTrend) !== null ? 'ms' : ''} detail="Média" tone="violet" onTap={() => setActiveTab('tendencias')} delta={hrvDelta} deltaUnit="ms" sparklinePoints={hrvTrend.map((p) => p.value)} />
              <MetricCard icon={<Moon />} label="SONO" value={media7Dias(sonoTrend) !== null ? formatDuration(media7Dias(sonoTrend)!) : '—'} detail="Média" tone="blue" onTap={() => setActiveTab('recuperacao')} delta={sonoDelta} deltaUnit="min" sparklinePoints={sonoTrend.map((p) => p.value)} />
              <MetricCard icon={<Footprints />} label="PASSOS" value={media7Dias(passosTrend) !== null ? Math.round(media7Dias(passosTrend)!).toLocaleString('pt-BR') : '—'} detail="Média" tone="green" onTap={() => setActiveTab('atividades')} delta={passosDelta} sparklinePoints={passosTrend.map((p) => p.value)} />
              <MetricCard icon={<Activity />} label="FREQ. RESP." value={media7Dias(freqRespTrend) !== null ? media7Dias(freqRespTrend)!.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'} unit={media7Dias(freqRespTrend) !== null ? 'rpm' : ''} detail="Média" onTap={() => setActiveTab('tendencias')} sparklinePoints={freqRespTrend.map((p) => p.value)} />
              <MetricCard icon={<HeartPulse />} label="SpO₂" value={media7Dias(spo2Trend) !== null ? `${Math.round(media7Dias(spo2Trend)!)}` : '—'} unit={media7Dias(spo2Trend) !== null ? '%' : ''} detail="Média" onTap={() => setActiveTab('tendencias')} sparklinePoints={spo2Trend.map((p) => p.value)} />
            </div>
            <p className="health-tap-hint">Toque em um indicador para ver mais detalhes</p>
          </section>

          <InvictusIACTA insights={insightsParaIA} onOpenChat={onOpenChat} />

          <div className="health-report-cta">
            <div><strong>Relatório Saúde &amp; Performance</strong><p>7, 30, 90 dias ou personalizado.</p></div>
            <button onClick={onGenerateReport}><FileDown /> GERAR RELATÓRIO</button>
          </div>

          <LatestWorkouts state={state} expanded={activitiesExpanded} onToggle={() => setActivitiesExpanded(value => !value)} />
        </>
      )}

      {activeTab === 'atividades' && (
        <>
          <section className="health-overview">
            <div className="health-section-line"><div><Footprints /> ATIVIDADES</div></div>
            <div className="health-metrics-grid">
              <MetricCard icon={<Footprints />} label="PASSOS" value={passos ? passos.value.toLocaleString('pt-BR') : '—'} detail={passos ? `Registrado: ${formatUltimaLeitura(passos.timestamp)}` : semDado} />
              <MetricCard icon={<Dumbbell />} label="TREINOS" value={workouts} detail="Sessões homologadas no período" progress={workouts ? Math.min(100, Number(state.computedMetrics.weekly_active_days?.currentValue || 0) * 20) : 0} />
              <MetricCard icon={<Clock3 />} label="TEMPO ATIVO" value={formatDuration(minutes)} detail={workouts ? `Média por sessão: ${formatDuration(minutes / workouts)}` : 'Sem sessões homologadas'} />
            </div>
          </section>
          <LatestWorkouts state={state} expanded={activitiesExpanded} onToggle={() => setActivitiesExpanded(value => !value)} />
        </>
      )}

      {activeTab === 'recuperacao' && (
        <>
          <section className="health-overview">
            <div className="health-section-line"><div><Moon /> RECUPERAÇÃO</div></div>
            <div className="health-metrics-grid">
              <MetricCard icon={<Moon />} label="SONO" value={sono ? formatDuration(sono.value) : '—'} detail={sono ? `Última noite: ${formatUltimaLeitura(sono.timestamp)}` : semDado} />
              <MetricCard icon={<Activity />} label="ÍNDICE DE RECUPERAÇÃO" value={state.computedMetrics.recovery_index?.hasEnoughData ? `${metricNumber(state, 'recovery_index')}%` : '—'} detail={state.computedMetrics.recovery_index?.hasEnoughData ? (state.readinessStatus || '') : 'Requer sessão de atividade auditada pelo servidor (em desenvolvimento)'} />
            </div>
          </section>
          <SeuCorpoXSeusTreinosCard activityCount72h={activityCount72h} estadoHoje={estadoHoje} onVerAnalise={() => setActiveTab('tendencias')} />
          <article className="health-overview" style={{ marginTop: '1rem' }}>
            <div className="health-section-line"><div>SONO (30 DIAS)</div></div>
            {summary?.trends.sleep_duration_min?.length ? <ChartBars points={trendPontos(summary.trends.sleep_duration_min.map((p) => ({ timestamp: p.timestamp, value: Math.round(p.value / 60 * 10) / 10 })))} color="violet" /> : <p className="health-empty">Conecte um dispositivo compatível com sono para ver esta tendência.</p>}
          </article>
        </>
      )}

      {activeTab === 'tendencias' && (
        <>
          <article className="health-overview health-trends-compact">
            <div className="health-section-line"><div><Activity /> RESUMO DOS ÚLTIMOS 30 DIAS</div></div>
            <div className="health-trend-cols">
              <div>
                <span>FC REPOUSO</span>
                <b style={{ color: fcDelta ? CORES_POR_TOM.red : '#65605a' }}>{fcDelta ? formatDeltaCurto(fcDelta, 'bpm') : '—'}</b>
                <em>{statusPalavra(fcDelta, 'down')}</em>
              </div>
              <div>
                <span>HRV</span>
                <b style={{ color: hrvDelta ? CORES_POR_TOM.violet : '#65605a' }}>{hrvDelta ? formatDeltaCurto(hrvDelta, 'ms') : '—'}</b>
                <em>{statusPalavra(hrvDelta, 'up')}</em>
              </div>
              <div>
                <span>SONO</span>
                <b style={{ color: sonoDelta ? CORES_POR_TOM.blue : '#65605a' }}>{sonoDelta ? formatDeltaCurto(sonoDelta, 'min') : '—'}</b>
                <em>{statusPalavra(sonoDelta, 'up')}</em>
              </div>
              <div>
                <span>EXERCÍCIO</span>
                <b style={{ color: exercicioDelta ? CORES_POR_TOM.gold : '#65605a' }}>{exercicioDelta ? formatDeltaCurto(exercicioDelta, 'min') : '—'}</b>
                <em>{statusPalavra(exercicioDelta, 'up')}</em>
              </div>
            </div>
          </article>

          <section className="health-overview" style={{ marginTop: '1rem' }}>
            <div className="health-section-line"><div><Heart /> CORAÇÃO</div></div>
            <div className="health-metrics-grid">
              <MetricCard icon={<Heart />} label="FC REPOUSO" value={fcRepouso ? fcRepouso.value : '—'} unit={fcRepouso ? 'bpm' : ''} detail={fcRepouso ? `Última leitura: ${formatUltimaLeitura(fcRepouso.timestamp)}` : semDado} tone="red" />
              <MetricCard icon={<HeartPulse />} label="HRV" value={hrv ? hrv.value : '—'} unit={hrv ? 'ms' : ''} detail={hrv ? `Última leitura: ${formatUltimaLeitura(hrv.timestamp)}` : semDado} />
              <MetricCard icon={<Heart />} label="FC MÉDIA" value={heartRateAvg || '—'} unit={heartRateAvg ? 'bpm' : ''} detail={heartRateAvg ? 'Média dos treinos do período' : 'Conecte um sensor cardíaco'} tone="red" />
            </div>
          </section>
          <HeartRateCurve state={state} />
          <div className="health-dual">
            <ZoneChart state={state} />
            <article className="health-trend-card">
              <div className="health-section-name">FC REPOUSO (30 DIAS) <Info /></div>
              <strong>{fcRepouso ? fcRepouso.value : '—'} <small>{fcRepouso ? 'bpm' : ''}</small></strong>
              <p>{summary?.trends.heart_rate_resting?.length ? 'Leituras sincronizadas do relógio/app de saúde' : 'Conecte um dispositivo compatível com FC de repouso'}</p>
              <ChartBars points={trendPontos(summary?.trends.heart_rate_resting || [])} color="violet" />
            </article>
          </div>
          <article className="health-overview" style={{ marginTop: '1rem' }}>
            <div className="health-section-line"><div><HeartPulse /> HRV (30 DIAS)</div></div>
            {summary?.trends.hrv_rmssd?.length ? <ChartBars points={trendPontos(summary.trends.hrv_rmssd)} /> : <p className="health-empty">Conecte um dispositivo compatível com HRV para ver esta tendência.</p>}
          </article>

          <EnergyBlock calories={calories} deviceCalories={caloriasAtivas?.value || 0} />
          <article className="health-overview" style={{ marginTop: '1rem' }}>
            <div className="health-section-line"><div>GASTO ENERGÉTICO ESTIMADO (30 DIAS)</div></div>
            {summary?.trends.calories_active?.length ? <ChartBars points={trendPontos(summary.trends.calories_active)} /> : <p className="health-empty">Ainda não há histórico suficiente para mostrar tendência.</p>}
          </article>

          <section className="health-advanced" style={{ marginTop: '1rem' }}>
            <div className="health-section-name">MÉTRICAS AVANÇADAS <Info /></div>
            <div>
              <span>VO₂ MÁX. ESTIMADO <b>{state.computedMetrics.vo2max_estimate?.hasEnoughData ? metricNumber(state, 'vo2max_estimate').toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'}</b><small>{state.computedMetrics.vo2max_estimate?.hasEnoughData ? 'ml/kg/min (estimado)' : (state.computedMetrics.vo2max_estimate?.statusMessage || 'Requer corrida/caminhada com GPS + FC')}</small></span>
              <span>COBERTURA DE FC <b>{Math.round(state.heartRateCoverageMinutes || 0)} min</b><small>Tempo com leituras reais da curva</small></span>
              <span>RECUPERAÇÃO <b>{state.computedMetrics.recovery_index?.hasEnoughData ? `${metricNumber(state, 'recovery_index')}%` : '—'}</b><small>{state.readinessStatus}</small></span>
              <span>ÍNDICE DE CONSISTÊNCIA <b>{state.computedMetrics.consistency_index?.hasEnoughData ? `${metricNumber(state, 'consistency_index')}%` : '—'}</b><small>{state.computedMetrics.consistency_index?.hasEnoughData ? 'da meta de 5 dias/semana' : (state.computedMetrics.consistency_index?.statusMessage || 'Requer métrica auditada')}</small></span>
            </div>
            <button onClick={onOpenLegacyReport} className="health-tab-note" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginTop: '1rem', color: '#ffad00', fontFamily: 'Anton,sans-serif', fontSize: 14, fontStyle: 'italic', cursor: 'pointer' }}>VER RELATÓRIO DETALHADO EM TELA <ChevronRight /></button>
          </section>
        </>
      )}
    </>
  );
}

export function Health() {
  const navigate = useNavigate();
  const [range, setRange] = useState<TimeRange>('7days');
  const { user, state, loading } = useHealthData(range);
  const { summary, loadingSummary, syncDiagnostics } = useHealthSummary();

  if (!user) return null;
  if (loading || !state) return createPortal(<div className="health-screen health-new-shell health-loading">Preparando os seus dados de saúde…</div>, document.body);

  return createPortal(
    <main className="health-screen health-new-shell">
      <div className="health-content">
        <HealthHeader
          title="SAÚDE"
          subtitle="Sua saúde. Seus dados. Seu desempenho."
          onBack={() => navigate('/profile')}
          right={<PeriodControl value={range} onChange={setRange} />}
        />
        <HealthSummaryContent
          state={state}
          summary={summary}
          loadingSummary={loadingSummary}
          syncDiagnostics={syncDiagnostics}
          onGenerateReport={() => navigate('/health/report')}
          onOpenLegacyReport={() => navigate('/health/report')}
          onOpenChat={() => navigate('/ai')}
        />
        <HealthMetricLibrary summary={summary} />
        <HealthGlossary />
      </div><HealthFooter navigate={navigate} />
    </main>
  , document.body);
}

export function HealthReportContent() {
  const navigate = useNavigate();
  const [range, setRange] = useState<TimeRange>('30days');
  const [filterOpen, setFilterOpen] = useState(false);
  const [activitiesExpanded, setActivitiesExpanded] = useState(false);
  const [heartDetailsExpanded, setHeartDetailsExpanded] = useState(false);
  const { user, state, loading } = useHealthData(range);
  const { summary, loadingSummary, syncDiagnostics } = useHealthSummary();
  const weeklyRows = useMemo(() => state?.healthTimeframeWorkouts.slice(-6).reverse() || [], [state]);
  if (!user) return null;
  if (loading || !state) return createPortal(<div className="health-screen health-new-shell health-loading">Gerando relatório de saúde…</div>, document.body);
  const calories = metricNumber(state, 'total_calories_burned');
  const active = metricNumber(state, 'total_volume_time');
  const heartRate = metricNumber(state, 'avg_heart_rate');
  const workoutCount = metricNumber(state, 'workout_count');
  const points = state.computedMetrics.total_calories_burned?.historyPoints.map((item) => ({ label: item.date, value: item.value })) || [];
  const allActivities = [...state.healthTimeframeWorkouts].sort((a, b) => b.timestamp - a.timestamp);
  const distance = state.timeframeWorkouts.reduce((sum, workout) => sum + (workout.distanceKm || 0), 0);
  const heartPoints = state.computedMetrics.avg_heart_rate?.historyPoints.map((item) => ({ label: item.date, value: item.value })) || [];
  const latestSteps = summary?.latest.steps_daily?.value || 0;
  const latestSleep = summary?.latest.sleep_duration_min?.value || 0;
  const latestActiveCalories = summary?.latest.calories_active?.value || 0;
  return <main className="health-screen"><div className="health-content health-report"><HealthHeader title="RELATÓRIO DE SAÚDE" subtitle="Análise completa do seu desempenho e evolução." onBack={() => navigate('/health')} right={<div className="health-report-actions"><button onClick={() => window.print()}><Download />EXPORTAR</button><button onClick={() => setFilterOpen(value => !value)} aria-expanded={filterOpen}><SlidersHorizontal />FILTRAR</button></div>} />{filterOpen && <div className="health-period-bar">{ranges.map(item => <button key={item.id} className={range === item.id ? 'is-selected' : ''} onClick={() => { setRange(item.id); setFilterOpen(false); }}>{item.label}</button>)}</div>}<PeriodControl value={range} onChange={setRange} compact /><HealthSyncStatus diagnostics={syncDiagnostics} loading={loadingSummary} /><HealthInsightsSection summary={summary} state={state} /><section className="health-report-metrics"><MetricCard icon={<Flame />} label="GASTO ENERGÉTICO ESTIMADO" value={state.computedMetrics.total_calories_burned?.hasEnoughData ? calories.toLocaleString('pt-BR') : '—'} unit={state.computedMetrics.total_calories_burned?.hasEnoughData ? 'kcal' : ''} detail="Total de sessões homologadas no período" /><MetricCard icon={<Clock3 />} label="TEMPO ATIVO" value={formatDuration(active)} detail="Total do período" /><MetricCard icon={<Dumbbell />} label="TREINOS" value={workoutCount} detail="Sessões homologadas" /><MetricCard icon={<Heart />} label="FC MÉDIA" value={heartRate || '—'} unit={heartRate ? 'bpm' : ''} detail="Dados do sensor" tone="red" /><MetricCard icon={<MapPin />} label="DISTÂNCIA" value={distance > 0 ? distance.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—'} unit={distance > 0 ? 'km' : ''} detail={distance > 0 ? 'GPS registrado' : 'Sem percurso GPS no período'} /></section><section className="health-overview health-report-crossed-metrics"><div className="health-section-name">DADOS CRUZADOS DO DISPOSITIVO <Info /></div><div className="health-metrics-grid"><MetricCard icon={<Footprints />} label="PASSOS" value={latestSteps ? latestSteps.toLocaleString('pt-BR') : '—'} detail={latestSteps ? 'Último total diário recebido' : 'Sem passos sincronizados'} tone="green" /><MetricCard icon={<Moon />} label="SONO" value={latestSleep ? formatDuration(latestSleep) : '—'} detail={latestSleep ? 'Última noite recebida' : 'Sem sono sincronizado'} tone="blue" /><MetricCard icon={<Flame />} label="GASTO ATIVO DO DISPOSITIVO" value={latestActiveCalories ? Math.round(latestActiveCalories).toLocaleString('pt-BR') : '—'} unit={latestActiveCalories ? 'kcal' : ''} detail={latestActiveCalories ? 'Último total diário recebido' : 'Sem gasto ativo sincronizado'} tone="gold" /></div></section><section className="health-report-chart"><div><h2>TENDÊNCIA DO GASTO ESTIMADO <Info /></h2><strong>{state.computedMetrics.total_calories_burned?.hasEnoughData ? calories.toLocaleString('pt-BR') : '—'} <small>{state.computedMetrics.total_calories_burned?.hasEnoughData ? 'kcal' : ''}</small></strong><p>Estimativa total registrada no período</p></div><ChartBars points={points} /></section><HeartRateCurve state={state} /><section className="health-dual health-report-dual"><ZoneChart state={state} onDetails={() => document.getElementById('health-report-heart')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} /><article id="health-report-heart" className="health-trend-card"><div className="health-section-name">FC MÉDIA (POR DIA) <Info /></div><strong>{heartRate || '—'} <small>{heartRate ? 'bpm' : ''}</small></strong><p>{heartRate ? 'Média dos dados sincronizados' : 'Conecte um sensor cardíaco'}</p><ChartBars points={heartPoints} color="violet" />{heartDetailsExpanded && <p className="health-empty">A frequência cardíaca exibida é a média dos registros sincronizados no período. Leituras ausentes ou incompletas não são estimadas.</p>}<button onClick={() => setHeartDetailsExpanded(value => !value)} aria-expanded={heartDetailsExpanded} className="health-card-link">{heartDetailsExpanded ? 'OCULTAR DETALHES DE FC' : 'VER DETALHES DE FC'} <ChevronRight /></button></article></section><section className="health-dual"><article className="health-activity-card"><div className="health-section-name">ATIVIDADE POR TIPO <Info /></div><div className="health-activity-total"><strong>{workoutCount}</strong><span>Treinos</span></div><button onClick={() => setActivitiesExpanded(value => !value)} className="health-card-link">{activitiesExpanded ? 'MOSTRAR MENOS' : 'VER TODOS OS TREINOS'} <ChevronRight /></button></article><article className="health-weekly-card"><div className="health-section-name">RESUMO SEMANAL <Info /></div>{weeklyRows.length ? weeklyRows.map((workout) => <div key={workout.id}><span>{new Date(workout.timestamp).toLocaleDateString('pt-BR')}</span><b>{workout.caloriesBurned ? `${Math.round(workout.caloriesBurned)} kcal` : '—'}</b><span>{formatDuration(workout.durationMinutes)}</span></div>) : <p className="health-empty">Nenhuma atividade no período.</p>}</article></section>{activitiesExpanded && <LatestWorkouts state={{ ...state, timeframeWorkouts: allActivities } as UserPerformanceState} expanded onToggle={() => setActivitiesExpanded(false)} />}<section className="health-advanced"><div className="health-section-name">MÉTRICAS AVANÇADAS <Info /></div><div><span>VO₂ MÁX. ESTIMADO <b>{state.computedMetrics.vo2max_estimate?.hasEnoughData ? metricNumber(state, 'vo2max_estimate').toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'}</b><small>{state.computedMetrics.vo2max_estimate?.hasEnoughData ? 'ml/kg/min (estimado)' : (state.computedMetrics.vo2max_estimate?.statusMessage || 'Requer corrida/caminhada com GPS + FC')}</small></span><span>COBERTURA DE FC <b>{Math.round(state.heartRateCoverageMinutes || 0)} min</b><small>Tempo com leituras reais da curva</small></span><span>RECUPERAÇÃO <b>{state.computedMetrics.recovery_index?.hasEnoughData ? `${metricNumber(state, 'recovery_index')}%` : '—'}</b><small>{state.readinessStatus}</small></span><span>ÍNDICE DE CONSISTÊNCIA <b>{state.computedMetrics.consistency_index?.hasEnoughData ? `${metricNumber(state, 'consistency_index')}%` : '—'}</b><small>{state.computedMetrics.consistency_index?.hasEnoughData ? 'da meta de 5 dias/semana' : (state.computedMetrics.consistency_index?.statusMessage || 'Requer métrica auditada')}</small></span></div></section></div></main>;
}
