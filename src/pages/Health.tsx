import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Accessibility, AudioLines, Activity, AlertCircle, ArrowLeft, CalendarDays, ChevronDown, ChevronRight, Clock3, Download, Droplet, Dumbbell, FileDown, Flame, Footprints, Heart, HeartPulse, Info, MapPin, Moon, Plus, ShieldCheck, SlidersHorizontal, Trophy, UserRound, Wind } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { API_CONFIG } from '../config';
import { Capacitor } from '@capacitor/core';
import { useUser } from '../UserContext';
import { RawWorkoutSession, processUserPerformance, UserPerformanceState } from '../core/performance/performanceEngine';
import { buildHealthInsights } from '../core/health/healthInsights';
import { TimeRange } from '../core/performance/metricCatalog';
import { cn } from '../lib/utils';
import { normalizeActivityValidationStatus, readActivityTimestamp } from '../lib/workoutData';
import { healthSummaryService, HealthSummaryResponse } from '../services/healthSummaryService';
import type { HealthVitalsDiagnostics } from '../services/wearables/HealthVitalsProvider';
import { normalizeHeartRateSamples } from '../services/wearables/heartRateSamples';
import { readWorkoutHealthRecord } from '../services/workoutFeedbackHistoryService';
import { buildWorkoutFeedback } from '../core/health/workoutFeedback';
import { aggregateHeartRateSamples, analyzeHeartRateSamples } from '../core/health/heartRateAnalysis';
import { InvictusLogo } from '../components/InvictusLogo';
import { HealthBodyIllustration } from '../components/health/HealthBodyIllustration';
import { WearableManager } from '../services/wearables/WearableManager';
import { getModalityConfig } from '../config/cardioConfig';
import { buildHealthViewModel, healthLocalDate, type HealthViewModel, type HealthInterpretation, type PersonalBaseline } from '../core/health/healthViewModel';
import { buildHealthPeriodSummary } from '../core/health/healthPeriodSummary';
import './HealthNew.css';
import './HealthConfidence.css';

const ranges: { id: TimeRange; label: string }[] = [
  { id: '7days', label: '7 Dias' },
  { id: '30days', label: '30 Dias' },
  { id: '90days', label: '90 Dias' }
];

const daysForRange = (range: TimeRange) => range === '7days' ? 7 : range === '90days' ? 90 : 30;
type HealthWorkout = RawWorkoutSession & { cardioType?: string; muscleGroup?: string };

function formatDuration(minutes: number) {
  const total = Math.max(0, Math.round(minutes));
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
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

interface DeltaInfo { direction: 'up' | 'down' | 'neutral'; diff: number; media: number; }

function deltaVs7Dias(pontos: Array<{ timestamp: string; value: number }> | undefined, valorAtual: number | null): DeltaInfo | null {
  if (!pontos || valorAtual === null || !Number.isFinite(valorAtual)) return null;
  const now = Date.now();
  const valid = pontos.filter((p) => Number.isFinite(p.value) && Number.isFinite(Date.parse(p.timestamp)) && Date.parse(p.timestamp) <= now);
  const latestTime = Math.max(...valid.map((p) => Date.parse(p.timestamp)));
  if (!Number.isFinite(latestTime) || now - latestTime > 48 * 3600000) return null;
  const start = new Date(latestTime); start.setHours(0, 0, 0, 0);
  const anteriores = valid.filter((p) => Date.parse(p.timestamp) < start.getTime() && Date.parse(p.timestamp) >= start.getTime() - 7 * 86400000);
  if (anteriores.length < 3) return null;
  const media = anteriores.reduce((sum, p) => sum + p.value, 0) / anteriores.length;
  if (!(media > 0)) return null;
  const diff = valorAtual - media;
  return { direction: Math.abs(diff) < media * 0.01 ? 'neutral' : diff > 0 ? 'up' : 'down', diff, media };
}

function isInLastSevenDays(point: { timestamp: string; value: number; localDate?: string }): boolean {
  const now = Date.now();
  if (!Number.isFinite(point.value) || !Number.isFinite(Date.parse(point.timestamp)) || Date.parse(point.timestamp) > now) return false;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const day = point.localDate || healthLocalDate(point.timestamp, timeZone);
  return day >= healthLocalDate(now - 6 * 86400000, timeZone) && day <= healthLocalDate(now, timeZone);
}

function media7Dias(pontos: Array<{ timestamp: string; value: number; localDate?: string }> | undefined): number | null {
  const recent = (pontos || []).filter(isInLastSevenDays);
  return recent.length ? recent.reduce((sum, point) => sum + point.value, 0) / recent.length : null;
}

function formatDeltaCurto(delta: DeltaInfo, unidade: string, casasDecimais = 0): string {
  const seta = delta.direction === 'up' ? '↑' : delta.direction === 'down' ? '↓' : '→';
  const valorAbs = Math.abs(delta.diff).toLocaleString('pt-BR', { maximumFractionDigits: casasDecimais });
  return `${seta} ${valorAbs}${unidade ? ` ${unidade}` : ''}`;
}

function formatDeltaPercentCurto(delta: DeltaInfo): string {
  const seta = delta.direction === 'up' ? '↑' : delta.direction === 'down' ? '↓' : '→';
  const percent = delta.media > 0 ? Math.abs(Math.round((delta.diff / delta.media) * 100)) : 0;
  return `${seta} ${percent}%`;
}

function statusPalavra(delta: DeltaInfo | null): string {
  if (!delta) return 'Sem comparação';
  return delta.direction === 'neutral' ? 'Sem mudança relevante' : delta.direction === 'up' ? 'Acima da referência' : 'Abaixo da referência';
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

function statusParaHoje(value: HealthInterpretation): EstadoHojeResultado {
  return { status: value.label.toLocaleUpperCase('pt-BR'), descricao: value.description,
    cor: value.status === 'ABOVE_BASELINE' ? '#46d47b' : value.status === 'BELOW_BASELINE' ? '#ff8a5b' : value.status === 'WITHIN_BASELINE' ? '#ffb000' : '#8a8580' };
}

function deltaFromBaseline(baseline: PersonalBaseline): DeltaInfo | null {
  if (baseline.status !== 'READY' || baseline.value === null || baseline.delta === null) return null;
  return { media: baseline.value, diff: baseline.delta, direction: baseline.direction === 'within' ? 'neutral' : baseline.direction === 'above' ? 'up' : 'down' };
}

function smoothPathFromPoints(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  if (points.length === 2) return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function MiniSparkline({ points, color = '#ffb000' }: { points: number[]; color?: string }) {
  const gradientId = useId();
  if (!points || points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points, min + 1);
  const largura = 100;
  const altura = 28;
  const coords = points.map((valor, indice) => ({
    x: (indice / (points.length - 1)) * largura,
    y: altura - ((valor - min) / (max - min || 1)) * (altura - 4) - 2
  }));
  const linePath = smoothPathFromPoints(coords);
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)},${altura} L ${coords[0].x.toFixed(1)},${altura} Z`;
  return (
    <svg className="health-metric-spark" viewBox={`0 0 ${largura} ${altura}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`spark-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.38" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="health-spark-area" d={areaPath} fill={`url(#spark-${gradientId})`} stroke="none" />
      <path className="health-spark-line" d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color }} />
    </svg>
  );
}

function useHealthSummary(days: number) {
  const { user } = useUser();
  const [summary, setSummary] = useState<HealthSummaryResponse | null>(null);
  const [summaryOwner, setSummaryOwner] = useState<string | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [syncDiagnostics, setSyncDiagnostics] = useState<HealthVitalsDiagnostics | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [syncRevision, setSyncRevision] = useState(0);
  const synced = useRef('');
  const uid = user?.uid;
  useEffect(() => {
    let active = true;
    setLoadingSummary(true);
    setSummary(null);
    const load = async () => {
      if (!uid || auth.currentUser?.uid !== uid) { if (active) setLoadingSummary(false); return; }
      const syncKey = `${uid}:${refreshVersion}`;
      if (synced.current !== syncKey) {
        if (Capacitor.isNativePlatform()) {
          const manager = WearableManager.getInstance();
          await Promise.all([
            manager.syncAll().catch(() => undefined),
            manager.syncVitals().then((result) => {
              if (active && result.diagnostics) setSyncDiagnostics(result.diagnostics);
            }).catch(() => undefined)
          ]);
          healthSummaryService.invalidate();
        }
        if (active) { synced.current = syncKey; setSyncRevision((value) => value + 1); }
      }
      const data = await healthSummaryService.fetchSummary(days);
      if (active && auth.currentUser?.uid === uid) { setSummaryOwner(uid); setSummary(data); setLoadingSummary(false); }
    };
    void load();
    return () => { active = false; };
  }, [uid, days, refreshVersion]);
  const refresh = () => { healthSummaryService.invalidate(); setRefreshVersion((value) => value + 1); };
  return { summary: summaryOwner === uid ? summary : null, loadingSummary, syncDiagnostics: summaryOwner === uid ? syncDiagnostics : null, syncRevision, refresh };
}

function SummaryAvailability({ summary, trainingPartial, error, onRetry }: {
  summary: HealthSummaryResponse | null; trainingPartial?: boolean; error?: string | null; onRetry?: () => void;
}) {
  const message = error || summary?.errorMessage || (summary?.availability === 'partial'
    ? 'Parte do histórico de saúde ficou fora desta consulta. As análises que exigem cobertura completa ficam indisponíveis.'
    : trainingPartial ? 'Histórico de treinos parcial: esta consulta atingiu o limite de atividades. Carga e prontidão não serão estimadas.'
      : summary?.availability === 'empty' ? 'Nenhuma leitura de saúde recebida neste período. Suas atividades continuam disponíveis.' : null);
  if (!message) return null;
  return <section className="health-data-notice" role="status"><AlertCircle /><div><p>{message}</p>{onRetry && <button type="button" onClick={onRetry}>TENTAR ATUALIZAR</button>}</div></section>;
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

function HealthGlossary({ onUpdated }: { onUpdated?: () => void }) {
  const [permissionStatus, setPermissionStatus] = useState('');
  const updatePermissions = async () => {
    setPermissionStatus('Abrindo permissões…');
    try {
      const updated = await WearableManager.getInstance().refreshHealthPermissions();
      if (updated) { healthSummaryService.invalidate(); onUpdated?.(); }
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

function HealthInsightsSection({ summary, state, trainingPartial = false }: { summary: HealthSummaryResponse | null; state: UserPerformanceState; trainingPartial?: boolean }) {
  const insights = useMemo(() => buildHealthInsights({
    summary, trainingPartial,
    workouts: state.healthTimeframeWorkouts.map((workout) => ({
      timestamp: workout.timestamp,
      durationMinutes: workout.durationMinutes,
      avgHeartRate: workout.avgHeartRate,
      distanceKm: workout.distanceKm,
      workoutType: workout.workoutType
    }))
  }), [summary, state.healthTimeframeWorkouts, trainingPartial]);
  if (!insights.length) return null;
  return <section className="health-insights" aria-label="Análises da Invictus"><div className="health-section-name"><HeartPulse /> LEITURAS DA INVICTUS</div><div className="health-insights-list">{insights.map((insight) => <article key={insight.id} className={`is-${insight.kind}`}><div className="health-insight-heading"><strong>{insight.title}</strong><span>{insight.kind === 'congratulations' ? 'PARABÉNS' : insight.kind === 'alert' ? 'ATENÇÃO' : insight.kind === 'decline' ? 'OBSERVE' : insight.kind === 'tip' ? 'OBSERVAÇÃO' : 'EVOLUÇÃO'}</span></div><p>{insight.message}</p><small>{insight.evidence}</small></article>)}</div><small className="health-insights-note">As mensagens descrevem tendências dos seus próprios dados; não são diagnóstico nem substituem avaliação profissional.</small></section>;
}

const HEALTH_METRIC_LABELS: Record<string, string> = {
  heart_rate: 'Batimentos', heart_rate_resting: 'FC em repouso', hrv_rmssd: 'HRV · RMSSD', hrv_sdnn: 'HRV · SDNN',
  sleep_duration_min: 'Sono', steps_daily: 'Passos', weight_kg: 'Peso',
  calories_active: 'Gasto energético estimado', distance_km: 'Distância', respiratory_rate: 'Respiração',
  oxygen_saturation: 'Oxigenação', vo2max_estimate: 'VO₂ máx.',
  blood_pressure_systolic: 'Pressão sistólica', blood_pressure_diastolic: 'Pressão diastólica',
  body_fat_percent: 'Gordura corporal', hydration_l: 'Água registrada',
  heart_rate_avg: 'FC média do treino', heart_rate_max: 'Maior FC registrada no treino',
  calories_total: 'Gasto total estimado', calories_basal: 'Gasto basal estimado',
  exercise_duration_min: 'Tempo de exercício registrado', mindfulness_duration_min: 'Atenção plena registrada',
  stand_hours: 'Horas em pé registradas', distance_cycling_km: 'Distância de ciclismo',
  steps_activity: 'Passos no treino', duration_min: 'Duração do treino'
};

const CONFIDENCE_LABELS: Record<string, string> = { A: 'Alta confiança', B: 'Boa confiança', C: 'Confiança moderada', D: 'Confiança limitada', E: 'Evidência insuficiente' };

function effectiveConfidence(sample: NonNullable<HealthSummaryResponse['latest']['heart_rate']> | null) {
  return [sample?.confidenceAtMeasurement, sample?.currentEvidenceConfidence]
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .sort((a, b) => 'ABCDE'.indexOf(b.confidenceLevel) - 'ABCDE'.indexOf(a.confidenceLevel))[0];
}

function ConfidenceDetails({ sample, metric, onClose }: { sample: NonNullable<HealthSummaryResponse['latest'][keyof HealthSummaryResponse['latest']]>; metric: string; onClose: () => void }) {
  const confidence = effectiveConfidence(sample);
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
  return <section className="health-metric-library"><div className="health-section-name">ÚLTIMAS LEITURAS <Info /></div><div>{rows.map(([metric, sample]) => sample ? <article key={metric}><div><strong>{HEALTH_METRIC_LABELS[metric] || metric}</strong><b>{sample.value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} <small>{sample.unit}</small></b></div><p>{formatUltimaLeitura(sample.endDate || sample.timestamp)} · {sample.device || (sample.source === 'apple_health' ? 'Apple Health' : sample.source === 'health_connect' ? 'Health Connect' : 'Fonte sincronizada')}</p><button className={`health-confidence-badge level-${effectiveConfidence(sample)?.confidenceLevel || 'E'}`} onClick={() => setSelected({ metric, sample })}>{effectiveConfidence(sample)?.confidenceLevel || 'E'} — {CONFIDENCE_LABELS[effectiveConfidence(sample)?.confidenceLevel || 'E']}</button></article> : null)}</div>{selected && <ConfidenceDetails metric={selected.metric} sample={selected.sample} onClose={() => setSelected(null)} />}</section>;
}

function useHealthData(range: TimeRange, revision: number, ready: boolean) {
  const { user } = useUser();
  const [workouts, setWorkouts] = useState<HealthWorkout[]>([]);
  const [loading, setLoading] = useState(true);
  const [trainingPartial, setTrainingPartial] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef('');
  const uid = user?.uid;
  useEffect(() => {
    if (!uid || !ready) return;
    const key = `${uid}:${revision}`;
    if (loaded.current === key) return;
    let active = true;
    setLoading(true);
    const load = async () => {
      try {
        const snapshot = await getDocs(query(collection(db, 'workouts'), where('userId', '==', uid), limit(501)));
        const since = Date.now() - 90 * 86400000;
        const rows = snapshot.docs.slice(0, 500).reduce<HealthWorkout[]>((result, entry) => {
          const item = entry.data();
          const timestamp = readActivityTimestamp(item.timestamp) ?? readActivityTimestamp(item.startTime) ?? readActivityTimestamp(item.createdAt);
          const validationStatus = normalizeActivityValidationStatus(item.validationStatus ?? item.status ?? item.validation?.status);
          const isWearable = item.source === 'apple_health' || item.source === 'health_connect';
          const healthRecord = readWorkoutHealthRecord(item.healthSession);
          const sessionReadings = healthRecord ? buildWorkoutFeedback(healthRecord).session : null;
          const heartRateSamples = normalizeHeartRateSamples(healthRecord && sessionReadings?.averageBpm !== null
            ? healthRecord.heartRate.samples : item.heartRateSamples);
          const telemetry = item.healthTelemetry || {};
          const avgHeartRate = Number(sessionReadings?.averageBpm ?? item.avgHeartRate ?? item.averageHeartRate ?? item.avgHr ?? telemetry.avgHeartRate);
          const hasHealthTelemetry = heartRateSamples.length > 0 || Number(item.steps) > 0 || avgHeartRate > 0
            || Number(item.maxHeartRate ?? item.maxHr ?? telemetry.maxHeartRate) > 0 || Number(item.calories ?? item.caloriesBurned) > 0 || Number(item.distance ?? item.distanceKm) > 0;
          const isHealthOnly = isWearable && validationStatus !== 'validated' && item.nonScoringReason !== 'DUPLICATE_ACTIVITY' && hasHealthTelemetry;
          if (!timestamp || timestamp < since || timestamp > Date.now() || (validationStatus !== 'validated' && !isHealthOnly)) return result;
          result.push({
            id: entry.id, userId: uid, timestamp,
            durationMinutes: Number(item.durationMinutes ?? item.duration ?? 0),
            avgHeartRate: Number.isFinite(avgHeartRate) && avgHeartRate > 0 ? avgHeartRate : undefined,
            maxHeartRate: sessionReadings?.maxBpm ?? (Number(item.maxHeartRate ?? item.maxHr ?? telemetry.maxHeartRate) || undefined),
            steps: Number(item.steps) > 0 ? Math.round(Number(item.steps)) : undefined,
            heartRateSamples: heartRateSamples.length ? heartRateSamples : undefined,
            caloriesBurned: Number(item.caloriesBurned ?? item.calories) > 0 ? Number(item.caloriesBurned ?? item.calories) : undefined,
            distanceKm: Number(item.distanceKm ?? item.distance) > 0 ? Number(item.distanceKm ?? item.distance) : undefined,
            workoutType: item.cardioType || item.workoutType || item.type || 'activity',
            cardioType: item.cardioType, muscleGroup: item.muscleGroup,
            workoutName: item.workoutName || item.title || item.cardioTypeLabel || (item.muscleGroup ? `Treino de ${item.muscleGroup}` : 'Atividade registrada'),
            validationStatus: isHealthOnly ? 'health_only' : validationStatus || 'pending',
            source: typeof item.source === 'string' ? item.source : undefined,
            hasSensorData: Boolean(avgHeartRate > 0 || heartRateSamples.length),
            hasGPSData: Boolean(item.requiresGpsDistance || item.gpsTracked || item.trajectory?.length)
          });
          return result;
        }, []);
        if (active && auth.currentUser?.uid === uid) {
          loaded.current = key; setWorkouts(rows); setTrainingPartial(snapshot.size > 500); setError(null);
        }
      } catch {
        if (active) { setWorkouts([]); setTrainingPartial(true); setError('Não foi possível carregar as atividades. Nenhum resultado de treino será inferido desta consulta.'); }
      } finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [uid, revision, ready]);
  const ownedWorkouts = useMemo(() => workouts.filter((workout) => workout.userId === uid), [workouts, uid]);
  const state = useMemo(() => user ? processUserPerformance(ownedWorkouts, { ...user, name: user.name || user.displayName }, range) : null, [ownedWorkouts, user, range]);
  return { user, state, workouts: ownedWorkouts, loading, trainingPartial, error };
}

function useHealthScreen(range: TimeRange) {
  const periodDays = daysForRange(range);
  const health = useHealthSummary(Math.max(30, periodDays));
  const activity = useHealthData(range, health.syncRevision, !health.loadingSummary);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const periodSummary = useMemo(() => buildHealthPeriodSummary(activity.state?.healthAllWorkouts || [], Date.now(), periodDays, timeZone, activity.trainingPartial), [activity.state, periodDays, timeZone, activity.trainingPartial]);
  const summary = useMemo(() => {
    if (!health.summary) return null;
    const firstDay = periodSummary.startDate;
    const lastDay = periodSummary.endDate;
    return { ...health.summary, windowDays: periodDays,
      trends: Object.fromEntries(Object.entries(health.summary.trends).map(([metric, points]) => [metric, (points || []).filter((point) => {
        const day = point.localDate || healthLocalDate(point.timestamp, timeZone);
        return day >= firstDay && day <= lastDay;
      })])) } as HealthSummaryResponse;
  }, [health.summary, periodDays, timeZone, periodSummary.startDate, periodSummary.endDate]);
  const viewModel = useMemo(() => buildHealthViewModel({
    summary: health.summary?.availability === 'error' || health.summary?.availability === 'stale' ? null : health.summary,
    workouts: activity.workouts,
    timeZone, periodDays, trainingPartial: activity.trainingPartial || Boolean(activity.error)
  }), [health.summary, activity.workouts, activity.trainingPartial, activity.error, timeZone, periodDays]);
  // The private health screen uses the same local-day period for lists, totals and curves.
  // Competitive metrics remain untouched in their original engine.
  const state = useMemo<UserPerformanceState | null>(() => {
    if (!activity.state) return null;
    const curves = aggregateHeartRateSamples(periodSummary.workouts, Number(activity.user?.maxHeartRate) || 0);
    return { ...activity.state, healthTimeframeWorkouts: periodSummary.workouts, hrZones: curves.zones,
      heartRateCoverageMinutes: curves.coverageSeconds / 60,
      computedMetrics: { ...activity.state.computedMetrics, hr_zones_distribution: { ...activity.state.computedMetrics.hr_zones_distribution, hasEnoughData: curves.hasEnoughData, statusMessage: curves.reason } } };
  }, [activity.state, activity.user?.maxHeartRate, periodSummary]);
  return { ...health, ...activity, state, summary, viewModel, periodDays, periodSummary };
}

export function WeeklyReviewCard({ viewModel, isPro }: { viewModel: HealthViewModel; isPro: boolean }) {
  return <section className="health-overview health-weekly-review"><div className="health-section-name">SUA SEMANA EM CONTEXTO <span className="health-pro">PRO</span></div>
    {isPro ? <><p>{viewModel.weeklyReview.status === 'INSUFFICIENT_DATA' ? 'Sua revisão está em formação. Veja quais registros faltam para começar.' : viewModel.weeklyReview.status === 'PARTIAL' ? 'Revisão parcial: alguns registros ainda não chegaram. Os pontos abaixo mostram o que já pode ser observado.' : 'O que seus registros permitem observar e acompanhar a seguir.'}</p>
      <div className="health-review-highlights">{viewModel.weeklyReview.highlights.map((item) => <article key={item.id}><strong>{item.title}</strong><p>{item.detail}</p></article>)}</div>
      {viewModel.weeklyReview.nextSteps.length > 0 && <><h3 className="health-review-next-title">O QUE OBSERVAR A SEGUIR</h3><ol>{viewModel.weeklyReview.nextSteps.map((step) => <li key={step}>{step}</li>)}</ol></>}
      <small>Análise calculada pelo Invictus · {viewModel.methodologyVersion}. Dados ausentes não são substituídos por estimativas.</small>
    </> : <p>O Pro reúne sinais do corpo, volume registrado e próximos pontos de observação numa revisão semanal. Seus dados, histórico e relatório continuam disponíveis abaixo.</p>}
  </section>;
}

export function HealthHeader({ title, subtitle, onBack, right }: { title: string; subtitle: string; onBack: () => void; right?: React.ReactNode }) {
  // #248: a tela Saude inteira e gratuita (rota /health sem gate de plano) --
  // essa badge "PRO" fixa ao lado do titulo era enganosa, sugeria que a tela
  // toda exigia assinatura. As coisas que sao PRO de verdade (chat "Insight
  // Invictus IA", botao "Relatorio", "Sua Semana em Contexto", "Seu Ponto de
  // Atencao") ja tem sua propria badge "PRO" no local certo -- essa generica
  // no topo so foi removida.
  return <><div className="health-brand"><InvictusLogo size={42} /><span><b>INVICTUS</b><small>PERFORMANCE</small></span></div><header className="health-header"><button aria-label="Voltar" onClick={onBack} className="health-back"><ArrowLeft /></button><div className="health-heading"><div><h1>{title}</h1></div><p>{subtitle}</p></div>{right}</header></>;
}

export function HealthFooter({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  return <nav className="health-new-footer"><button onClick={() => navigate('/')}><InvictusLogo size={24} /><span>Início</span></button><button onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button><button className="is-plus" onClick={() => navigate('/activity')} aria-label="Escolher modalidade"><Plus /></button><button onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button><button className="is-active" onClick={() => navigate('/profile')}><UserRound /><span>Perfil</span></button></nav>;
}

function PeriodControl({ value, onChange, compact = false }: { value: TimeRange; onChange: (value: TimeRange) => void; compact?: boolean }) {
  if (compact) return <div className="health-period-bar"><span>PERÍODO</span>{ranges.map((range) => <button key={range.id} onClick={() => onChange(range.id)} className={cn(value === range.id && 'is-selected')}>{range.label}</button>)}<CalendarDays aria-hidden="true" /></div>;
  const selected = ranges.find((item) => item.id === value) || ranges[1];
  return <button className="health-period-picker" onClick={() => onChange(ranges[(ranges.findIndex((range) => range.id === value) + 1) % ranges.length].id)}><CalendarDays />{selected.label.toUpperCase()}<ChevronDown /></button>;
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
      <div className={cn('health-metric-icon', tone === 'red' && 'is-red')} style={{ color: cor }}>{icon}</div><span>{label}</span>
      {onTap && <ChevronRight className="health-metric-chevron" aria-hidden="true" />}
    </div>
    <strong>{value}<small>{unit}</small></strong>
    <p>{detail}</p>
    {delta && (
      <div className="health-metric-delta" style={{ color: cor }}>
        {formatDeltaCurto(delta, deltaUnit, deltaDecimais)} vs referência
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
  if (!hasZoneData) return <article className="health-zone-card"><div className="health-section-name">DISTRIBUIÇÃO DE ZONAS CARDÍACAS <Info /></div><p className="health-empty">{state.computedMetrics.hr_zones_distribution?.statusMessage || 'Precisamos da curva de batimentos e da sua FC máxima cadastrada para calcular as zonas.'}</p></article>;
  const stops = zones.reduce<string[]>((result, zone, index) => {
    const previous = zones.slice(0, index).reduce((sum, item) => sum + item.percent, 0);
    return [...result, `${zone.color} ${previous}% ${previous + zone.percent}%`];
  }, []);
  return <article className="health-zone-card"><div className="health-section-name">DISTRIBUIÇÃO DE ZONAS CARDÍACAS <Info /></div><div className="health-zone-body"><div className="health-donut" style={{ background: `conic-gradient(${stops.join(',')})` }}><div><small>Tempo coberto</small><strong>{formatDuration(total)}</strong></div></div><div className="health-zone-list">{zones.map((zone) => <div key={zone.zoneName}><i style={{ background: zone.color, boxShadow: `0 0 9px ${zone.color}` }} /><span>{zone.zoneName.replace(/ \(.+\)/, '')}</span><b>{formatDuration(zone.minutes)}</b><em>{zone.percent}%</em></div>)}</div></div>{onDetails && <button onClick={onDetails} className="health-card-link">VER DETALHES <ChevronRight /></button>}</article>;
}

function LatestWorkouts({ state, expanded, onToggle }: { state: UserPerformanceState; expanded: boolean; onToggle: () => void }) {
  const allWorkouts = [...state.healthTimeframeWorkouts].sort((a, b) => b.timestamp - a.timestamp);
  const workouts = expanded ? allWorkouts : allWorkouts.slice(0, 2);
  return <article id="health-activities" className="health-latest"><div className="health-section-line"><div>ÚLTIMAS ATIVIDADES RECEBIDAS</div><button type="button" onClick={onToggle}>{expanded ? 'MOSTRAR MENOS' : 'VER TODOS'}</button></div>{workouts.length ? workouts.map((workout) => { const isRun = /corrida|run/i.test(workout.workoutType || ''); const healthOnly = workout.validationStatus === 'health_only'; return <div className="health-workout" key={workout.id}><span className={cn('health-workout-icon', isRun && 'is-run')}>{isRun ? <Footprints /> : <Dumbbell />}</span><div><b>{workout.workoutName}</b><small>{new Date(workout.timestamp).toLocaleDateString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}{workout.steps ? ` · ${workout.steps.toLocaleString('pt-BR')} passos` : ''}{healthOnly ? ' · Saúde · fora do ranking' : ''}</small></div><span><Clock3 />{formatDuration(workout.durationMinutes)}</span><span><Flame />{workout.caloriesBurned ? Math.round(workout.caloriesBurned) : '—'} kcal</span><span><Heart />{workout.avgHeartRate || '—'} bpm</span><ChevronRight /></div>; }) : <p className="health-empty">Quando o dispositivo sincronizar uma atividade, ela aparecerá aqui. A homologação competitiva é uma etapa separada.</p>}</article>;
}

type SaudeTab = 'saude' | 'atividades' | 'recuperacao' | 'tendencias';

const SAUDE_TABS: { id: SaudeTab; label: string }[] = [
  { id: 'saude', label: 'SAÚDE' },
  { id: 'atividades', label: 'ATIVIDADES' },
  { id: 'recuperacao', label: 'RECUPERAÇÃO' },
  { id: 'tendencias', label: 'TENDÊNCIAS' }
];

function recoveryDisplayLabel(recovery: HealthViewModel['recovery']): string {
  switch (recovery.status) {
    case 'BELOW_BASELINE': return 'Abaixo do seu padrão';
    case 'ABOVE_BASELINE': return 'Acima do seu padrão';
    case 'WITHIN_BASELINE': return 'No seu padrão';
    default: return 'Dados insuficientes';
  }
}

function SeuCorpoXSeusTreinosCard({ activityCount72h, viewModel, onVerAnalise }: {
  activityCount72h: number; viewModel: HealthViewModel; onVerAnalise: () => void;
}) {
  const estadoHoje = statusParaHoje(viewModel.recovery);
  const semDados = viewModel.recovery.status === 'INSUFFICIENT_DATA';
  return <article className="health-overview health-body-card">
    <div className="health-section-name">SEU CORPO × SEUS TREINOS <Info /></div>
    <div className="health-body-layout">
      <div className="health-body-information"><p className="health-body-summary">{activityCount72h > 0 ? `${activityCount72h} atividade${activityCount72h > 1 ? 's' : ''} nas últimas 72h.` : 'Sem atividades registradas nas últimas 72h.'}<br />{semDados ? 'Mais sinais recentes ajudam a entender seu padrão de recuperação.' : viewModel.recovery.label + ' em relação à sua referência.'}</p>
        <div className="health-body-rows">
          <div><span>VOLUME · 7D</span><b>{viewModel.load.status === 'PARTIAL' ? 'Histórico parcial' : viewModel.load.sessions7d ? `${Math.round(viewModel.load.minutes7d)} min` : 'Sem registro'}</b></div>
          <div><span>RECUPERAÇÃO</span><b style={{ color: estadoHoje.cor }}>{recoveryDisplayLabel(viewModel.recovery).replace('seu ', '')}</b></div>
          <div><span>PRONTIDÃO</span><b>{viewModel.readiness.status === 'INSUFFICIENT_DATA' ? 'Dados insuficientes' : viewModel.readiness.status === 'BELOW_BASELINE' ? 'Pede atenção' : 'No seu padrão'}</b></div>
        </div>
      </div>
      <figure className="health-body-illustration"><HealthBodyIllustration /></figure>
    </div>
    <p className="health-body-caption">Volume por duração registrada. Ilustração de referência, sem medição muscular.</p>
    <button type="button" className="health-inline-link health-card-bottom-link" onClick={onVerAnalise}>VER ANÁLISE COMPLETA <ChevronRight /></button>
  </article>;
}

function UltimoTreinoCard({ workout, onVerDetalhes }: { workout: RawWorkoutSession | null; onVerDetalhes: () => void }) {
  const modality = getModalityConfig(workout?.workoutType);
  const isCardio = Boolean(modality) || /corrida|run|cardio|bike|ciclismo|caminhada/i.test(workout?.workoutType || '');
  const isStrength = /^(workout|strength|strength_training|traditional_strength_training|functional_strength_training|musculação|musculacao|weightlifting)$/i.test(workout?.workoutType || '');
  const hasPace = modality?.hasPace ?? /corrida|run|caminhada|walk/i.test(workout?.workoutType || '');
  const paceSeconds = hasPace && workout?.distanceKm && workout.durationMinutes > 0 ? Math.round(workout.durationMinutes / workout.distanceKm * 60) : null;
  const paceLabel = paceSeconds ? `${Math.floor(paceSeconds / 60)}:${String(paceSeconds % 60).padStart(2, '0')}` : null;
  const date = workout ? new Date(workout.timestamp) : null;
  const dayLabel = date ? (date.toDateString() === new Date().toDateString() ? 'Hoje' : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })) : null;
  return <article className="health-overview health-last-workout">
    <div className="health-section-line"><div>ÚLTIMO TREINO</div><span className="health-badge">{isCardio ? 'CARDIO' : isStrength ? 'MUSCULAÇÃO' : 'ATIVIDADE'}</span></div>
    <p className="health-last-workout-date"><CalendarDays />{date ? `${dayLabel} · ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Aguardando primeira atividade'}</p>
    <div className="health-last-session-summary">
      <div className="health-last-workout-duration"><strong>{workout && workout.durationMinutes > 0 ? Math.round(workout.durationMinutes) : '—'}</strong><small>min</small></div>
      <div><span>{isCardio ? 'Distância' : 'Volume'}</span><b>{isCardio && workout?.distanceKm ? <>{workout.distanceKm.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}<small> km</small></> : '—'}</b>{!isCardio && <small>Não registrado</small>}</div>
      <div><span>{isCardio ? hasPace ? 'Ritmo' : 'Velocidade' : 'Séries'}</span><b>{isCardio ? hasPace ? paceLabel || '—' : workout?.distanceKm && workout.durationMinutes > 0 ? (workout.distanceKm / workout.durationMinutes * 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—' : '—'}</b><small>{isCardio ? hasPace ? 'min/km' : 'km/h' : 'Não registradas'}</small></div>
    </div>
    <div className="health-last-workout-grid">
      <div><span>FC MÉDIA</span><b><HeartPulse />{workout?.avgHeartRate ? Math.round(workout.avgHeartRate) : '—'}<small>bpm</small></b></div>
      <div><span>FC MÁXIMA</span><b>{workout?.maxHeartRate ? Math.round(workout.maxHeartRate) : '—'}<small>bpm</small></b></div>
      <div><span>GASTO ESTIMADO</span><b>{workout?.caloriesBurned ? Math.round(workout.caloriesBurned) : '—'}<small>kcal</small></b></div>
    </div>
    <button type="button" className="health-inline-link health-card-bottom-link" onClick={onVerDetalhes}>VER SESSÕES REGISTRADAS <ChevronRight /></button>
  </article>;
}

function RespostaAoTreinoChart({ samples, baselineHR }: { samples: { timestamp: string; bpm: number }[]; baselineHR: number | null }) {
  const gradientId = useId();
  const width = 360; const height = 155; const padding = 25;
  const values = samples.map((s) => s.bpm);
  const min = Math.floor(Math.min(...values, baselineHR ?? Infinity) / 10) * 10;
  const max = Math.ceil(Math.max(...values, baselineHR ?? 0) / 10) * 10;
  const firstTime = Date.parse(samples[0].timestamp);
  const fullTime = Math.max(1, Date.parse(samples[samples.length - 1].timestamp) - firstTime);
  const span = Math.max(1, max - min);
  const segments: { x: number; y: number }[][] = [[]];
  samples.forEach((sample, index) => {
    const previous = samples[index - 1];
    const gapSeconds = previous ? (new Date(sample.timestamp).getTime() - new Date(previous.timestamp).getTime()) / 1000 : 0;
    if (previous && (!Number.isFinite(gapSeconds) || gapSeconds <= 0 || gapSeconds > 60)) segments.push([]);
    const x = padding + ((Date.parse(sample.timestamp) - firstTime) / fullTime) * (width - padding - 8);
    const y = height - padding - ((sample.bpm - min) / span) * (height - padding * 2);
    segments[segments.length - 1].push({ x, y });
  });
  const baselineY = baselineHR !== null ? height - padding - ((baselineHR - min) / span) * (height - padding * 2) : null;
  return (
    <svg className="health-response-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Curva de frequência cardíaca do treino mais recente comparada à média dos demais treinos">
      <defs>
        <linearGradient id={`resposta-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff515b" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#ff515b" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[min, (min + max) / 2, max].map((value) => { const y = height - padding - ((value - min) / span) * (height - padding * 2); return <g key={value}><line className="health-chart-gridline" x1={padding} y1={y} x2={width - 8} y2={y} /><text x={padding - 5} y={y + 3} textAnchor="end">{Math.round(value)}</text></g>; })}
      {baselineY !== null && <line className="health-chart-baseline" x1={padding} y1={baselineY} x2={width - 8} y2={baselineY} strokeDasharray="3 3" />}
      <text x={padding} y={height - 5}>0′</text><text x={width - 8} y={height - 5} textAnchor="end">{Math.round(fullTime / 60000)}′</text>
      {segments.filter((s) => s.length >= 2).map((segment, index) => {
        const linePath = segment.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
        const areaPath = `${linePath} L ${segment[segment.length - 1].x.toFixed(1)},${height - padding} L ${segment[0].x.toFixed(1)},${height - padding} Z`;
        return <g key={index}>
          <path className="health-response-area" d={areaPath} fill={`url(#resposta-${gradientId})`} stroke="none" />
          <path className="health-response-line" d={linePath} fill="none" stroke="#ff515b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>;
      })}
    </svg>
  );
}

function RespostaAoTreinoCard({ state }: { state: UserPerformanceState }) {
  const all = state.healthTimeframeWorkouts.filter((w) => w.avgHeartRate && w.avgHeartRate > 0).sort((a, b) => b.timestamp - a.timestamp);
  const reference = all[0];
  const hrWorkouts = reference ? all.filter((w) => {
    if (w.workoutType !== reference.workoutType || w.durationMinutes <= 0 || reference.durationMinutes <= 0) return false;
    if (Math.abs(w.durationMinutes / reference.durationMinutes - 1) > 0.2) return false;
    if (!w.distanceKm || !reference.distanceKm) return false;
    const pace = w.durationMinutes / w.distanceKm;
    const referencePace = reference.durationMinutes / reference.distanceKm;
    return Math.abs(pace / referencePace - 1) <= 0.1;
  }) : [];
  if (hrWorkouts.length < 3) {
    return <article className="health-overview health-response-card"><div className="health-section-name">RESPOSTA AO TREINO <Info /></div><p>A comparação precisa de 3 sessões da mesma modalidade, com FC registrada, duração e ritmo semelhantes.</p>{reference?.heartRateSamples && reference.heartRateSamples.length >= 4 ? <><div className="health-chart-legend"><span>Seu treino mais recente</span></div><RespostaAoTreinoChart samples={reference.heartRateSamples} baselineHR={null} /></> : <div className="health-chart-empty"><Activity /><span>Aguardando curva de batimentos</span><small>Somente leituras reais do dispositivo aparecem aqui.</small></div>}<div className="health-response-grid"><div><b>—</b><span>FC média</span></div><div><b>—</b><span>Duração</span></div><div><b>—</b><span>Gasto estimado</span></div></div><small className="health-comparison-note">Sem base comparável, não inferimos melhora da resposta ao treino.</small></article>;
  }
  const [latest, ...rest] = hrWorkouts;
  const baselineHR = rest.reduce((soma, w) => soma + (w.avgHeartRate || 0), 0) / rest.length;
  const hrDiffPercent = baselineHR > 0 ? Math.round((((latest.avgHeartRate || 0) - baselineHR) / baselineHR) * 100) : 0;
  const baselineDuration = rest.reduce((soma, w) => soma + (w.durationMinutes || 0), 0) / rest.length;
  const durationDiffMin = Math.round(latest.durationMinutes - baselineDuration);
  const caloriasComDado = rest.filter((w) => w.caloriesBurned && w.caloriesBurned > 0);
  const baselineCalorias = caloriasComDado.length ? caloriasComDado.reduce((soma, w) => soma + (w.caloriesBurned || 0), 0) / caloriasComDado.length : null;
  const caloriasDiff = baselineCalorias !== null && latest.caloriesBurned ? Math.round(latest.caloriesBurned - baselineCalorias) : null;
  const samples = latest.heartRateSamples && latest.heartRateSamples.length >= 4 ? latest.heartRateSamples : null;
  return (
    <article className="health-overview health-response-card">
      <div className="health-section-name">RESPOSTA AO TREINO <Info /></div>
      <p>Comparação com {rest.length} sessões da mesma modalidade, com duração e ritmo semelhantes.</p>
      <div className="health-chart-legend"><span>Seu treino</span><span>Média das sessões comparáveis</span></div>
      {samples ? <RespostaAoTreinoChart samples={samples} baselineHR={baselineHR} /> : <div className="health-chart-empty"><Activity /><span>Curva não recebida</span></div>}
      <div className="health-response-grid">
        <div><span>FC MÉDIA</span><b style={{ color: '#ddd' }}>{hrDiffPercent > 0 ? '+' : ''}{hrDiffPercent}%</b><small>vs sua média</small></div>
        <div><span>DURAÇÃO</span><b style={{ color: '#ddd' }}>{durationDiffMin >= 0 ? '+' : ''}{durationDiffMin} min</b><small>vs sua média</small></div>
        <div><span>GASTO ESTIMADO</span><b>{caloriasDiff !== null ? `${caloriasDiff >= 0 ? '+' : ''}${caloriasDiff} kcal` : '—'}</b><small>vs sua média</small></div>
      </div>
    </article>
  );
}

function EvolucaoMiniChart({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null;
  return <div className="health-evolution-spark"><MiniSparkline points={points} color={color} /></div>;
}

function Evolucao30DiasCard({ state, periodDays, onDetails }: { state: UserPerformanceState; periodDays: number; onDetails: () => void }) {
  const cardioWorkouts = state.healthTimeframeWorkouts.filter((w) => Boolean(getModalityConfig(w.workoutType)) || /corrida|run|cardio|bike|ciclismo|caminhada/i.test(w.workoutType || ''));
  const forcaWorkouts = state.healthTimeframeWorkouts.filter((w) => /^(workout|strength|strength_training|traditional_strength_training|functional_strength_training|musculação|musculacao|weightlifting)$/i.test(w.workoutType || ''));
  const cardioComDistancia = cardioWorkouts
    .filter((w) => w.distanceKm && w.distanceKm > 0 && w.durationMinutes > 0 && (getModalityConfig(w.workoutType)?.hasPace ?? /corrida|run|walk|caminhada/i.test(w.workoutType || '')))
    .sort((a, b) => a.timestamp - b.timestamp);
  const paceMedio = cardioComDistancia.length ? cardioComDistancia.reduce((soma, w) => soma + w.durationMinutes / (w.distanceKm || 1), 0) / cardioComDistancia.length : null;
  const paceSeconds = paceMedio ? Math.round(paceMedio * 60) : null;
  const paceLabel = paceSeconds ? `${Math.floor(paceSeconds / 60)}:${String(paceSeconds % 60).padStart(2, '0')} min/km` : null;
  const paceSerie = cardioComDistancia.map((w) => w.durationMinutes / (w.distanceKm || 1));
  const paceSerieInvertida = paceSerie.length ? (() => { const max = Math.max(...paceSerie); return paceSerie.map((v) => max - v + Math.min(...paceSerie)); })() : [];

  const semanaDe = (timestamp: number) => Math.floor(timestamp / (7 * 24 * 60 * 60 * 1000));
  const porSemana = new Map<number, number>();
  forcaWorkouts.forEach((w) => { const semana = semanaDe(w.timestamp); porSemana.set(semana, (porSemana.get(semana) || 0) + 1); });
  const sessoesPorSemana = Array.from(porSemana.entries()).sort((a, b) => a[0] - b[0]).map(([, count]) => count);

  const strengthDays = new Set(forcaWorkouts.map(w => healthLocalDate(w.timestamp, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'))).size;
  return (
    <article className="health-overview health-evolution-card">
      <div className="health-section-name">EVOLUÇÃO · {periodDays} DIAS <Info /></div>
      <div className="health-evolution-grid">
        <div>
          <span className="health-evolution-label"><Footprints aria-hidden="true" /> CARDIO</span>
          {cardioWorkouts.length ? <>
            <p>Ritmo registrado<b>{paceLabel || '—'}</b></p>
            <p>Sessões no período<b>{cardioWorkouts.length}</b></p>
            <EvolucaoMiniChart points={paceSerieInvertida} color="#46d47b" />
          </> : <p className="health-empty">Sem sessões de cardio registradas no período.</p>}
        </div>
        <div>
          <span className="health-evolution-label"><Dumbbell aria-hidden="true" /> MUSCULAÇÃO</span>
          {forcaWorkouts.length ? <>
            <p>Frequência semanal<b>{(forcaWorkouts.length / (periodDays / 7)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x</b></p>
            <p>Dias com musculação<b>{strengthDays}</b></p>
            {sessoesPorSemana.length > 0 && <div className="health-frequency-bars" aria-label="Sessões por semana com registros">{sessoesPorSemana.map((count, index) => <i key={index} style={{ height: `${Math.max(4, count / Math.max(...sessoesPorSemana) * 52)}px` }} title={`${count} sessões`} />)}</div>}
          </> : <p className="health-empty">Sem sessões de musculação registradas no período.</p>}
        </div>
      </div>
      <button type="button" className="health-inline-link health-card-bottom-link" onClick={onDetails}>VER EVOLUÇÃO COMPLETA <ChevronRight /></button>
    </article>
  );
}

function SleepActivityChart({ points }: { points: Array<{ sleepMinutes: number; activeMinutes: number }> }) {
  if (points.length < 2) return null;
  const width = 280; const height = 140; const pad = 28;
  const minHours = Math.floor(Math.min(...points.map((point) => point.sleepMinutes / 60)));
  const maxHours = Math.max(minHours + 1, Math.ceil(Math.max(...points.map((point) => point.sleepMinutes / 60))));
  const maxMinutes = Math.max(1, ...points.map((point) => point.activeMinutes));
  return <svg className="health-sleep-scatter" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Pares reais de horas de sono e minutos de atividade registrados">
    <line x1={pad} y1={height - pad} x2={width - 10} y2={height - pad} />
    <line x1={pad} y1={10} x2={pad} y2={height - pad} />
    {points.map((point, index) => <circle key={index} cx={pad + (point.sleepMinutes / 60 - minHours) / (maxHours - minHours) * (width - pad - 10)} cy={height - pad - point.activeMinutes / maxMinutes * (height - pad - 10)} r="3.4" />)}
    <text x={pad} y={height - 10}>{minHours}h</text><text x={width - 10} y={height - 10} textAnchor="end">{maxHours}h</text>
    <text x={pad + 4} y={10}>{Math.round(maxMinutes)} min</text><text x={width / 2} y={height - 1} textAnchor="middle">Horas de sono</text>
  </svg>;
}

function SonoXPerformanceCard({ viewModel, onDetails }: { viewModel: HealthViewModel; onDetails: () => void }) {
  const relationship = viewModel.sleepActivity;
  return <article className="health-overview health-sleep-performance-card"><div className="health-section-name">SONO × TEMPO ATIVO <Info /></div>
    <div className="health-sleep-comparison"><div className="health-sleep-symbol"><Moon /></div><div className="health-sleep-explanation"><p>{relationship.status === 'AVAILABLE' ? `${relationship.pairs} dias comparáveis. Nos dias de sono a partir da sua mediana, o tempo registrado foi ${Math.abs(Math.round(relationship.activityDifferencePercent || 0))}% ${(relationship.activityDifferencePercent || 0) >= 0 ? 'maior' : 'menor'}.` : relationship.description}</p><small>Associação observada. Não demonstra causa ou melhora de desempenho.</small></div>
    {relationship.points?.length ? <SleepActivityChart points={relationship.points} /> : <div className="health-sleep-waiting"><span>{relationship.pairs}</span><small>dias pareados<br />com registros</small></div>}</div>
    <button type="button" className="health-inline-link health-card-bottom-link" onClick={onDetails}>VER HISTÓRICO DE SONO <ChevronRight /></button>
  </article>;
}

function InvictusIACTA({ insights, onOpenChat }: { insights: ReturnType<typeof buildHealthInsights>; onOpenChat: () => void }) {
  const primeiro = insights[0];
  return (
    <article className="health-overview health-ia-cta">
      <InvictusLogo size={76} className="health-ia-emblem" />
      <div className="health-ia-cta-text">
        <div className="health-section-line"><div>SEU PONTO DE ATENÇÃO</div><span className="health-pro">PRO</span></div>
        <p>{primeiro ? primeiro.message : 'Continue sincronizando seus dados para formar uma referência pessoal.'}</p><small>Resumo calculado pelo app. A interpretação por IA só é solicitada quando você escolhe conversar.</small>
      </div>
      <button type="button" className="health-ia-cta-button" onClick={onOpenChat}><AudioLines /><span>CONVERSAR COM<strong>INVICTUS IA</strong></span><ChevronRight aria-hidden="true" /></button>
    </article>
  );
}

function EnergyBlock({ calories, deviceCalories = 0 }: { calories: number; deviceCalories?: number }) {
  return <article className="health-overview health-energy-card"><div className="health-section-name"><Flame /> GASTO ENERGÉTICO ESTIMADO</div>
    <div className="health-energy-value"><strong>{calories > 0 ? calories.toLocaleString('pt-BR') : '—'}</strong><span>{calories > 0 ? 'kcal registradas nas sessões do período' : 'Sem gasto energético de treino registrado'}</span></div>
    {deviceCalories > 0 && <div className="health-energy-device"><strong>{Math.round(deviceCalories).toLocaleString('pt-BR')} kcal</strong><span>Último total diário ativo do dispositivo</span></div>}
    <p>Estimativa dependente do dispositivo e do contexto. O total diário pode incluir as sessões; os valores não são somados e não representam gordura ou peso perdido.</p>
  </article>;
}

function DescricaoComRealce({ texto, cor }: { texto: string; cor: string }) {
  const partes = texto.split(/(Considere)/);
  return <p>{partes.map((parte, indice) => parte === 'Considere' ? <strong key={indice} style={{ color: cor }}>{parte}</strong> : <React.Fragment key={indice}>{parte}</React.Fragment>)}</p>;
}

function StatusRing({ cor }: { cor: string }) {
  return (
    <div className="health-status-ring" style={{ borderColor: cor }} aria-hidden="true">
      <div style={{ color: cor }}><Accessibility /></div>
    </div>
  );
}

function ConfiancaDosDados({ amostras }: { amostras: Array<{ confidenceAtMeasurement?: { confidenceLevel?: string } | null; currentEvidenceConfidence?: { confidenceLevel?: string } | null } | null> }) {
  const levels = amostras.filter(Boolean).map((sample) => [sample?.confidenceAtMeasurement?.confidenceLevel, sample?.currentEvidenceConfidence?.confidenceLevel].filter(Boolean).sort().at(-1) || 'E');
  const grade = levels.sort().at(-1) || 'E';
  return <div className="health-hoje-confidence"><div className="health-confidence-heading"><span>CONFIANÇA DOS DADOS <Info /></span><span className={`health-confidence-badge level-${grade}`}>{grade} · {levels.length ? CONFIDENCE_LABELS[grade] : 'Sem leituras'}</span></div>
    <div className="health-confidence-scale" aria-label={`Classificação ${grade}; não representa precisão percentual`}>{['A', 'B', 'C', 'D', 'E'].map((level) => <span key={level} className={grade === level ? 'is-current' : ''}>{level}</span>)}</div>
  </div>;
}

function baselineAvailabilityLabel(baseline: PersonalBaseline) {
  if (baseline.status === 'STALE') return 'Leitura desatualizada';
  if (baseline.status === 'PARTIAL') return 'Histórico incompleto';
  if (baseline.status === 'UNRELIABLE') return 'Confiança insuficiente';
  if (baseline.latest === null) return 'Aguardando leitura';
  return `${baseline.baselineDays}/${baseline.requiredDays} dias de referência`;
}

function EstadoDeHojeCard({ fcRepouso, hrv, sono, fcDelta, hrvDelta, sonoDelta, ultimaAtualizacao, viewModel, hrvLabel }: {
  viewModel: HealthViewModel; hrvLabel: string;
  fcRepouso: HealthSummaryResponse['latest']['heart_rate_resting'];
  hrv: HealthSummaryResponse['latest']['hrv_rmssd'];
  sono: HealthSummaryResponse['latest']['sleep_duration_min'];
  fcDelta: DeltaInfo | null; hrvDelta: DeltaInfo | null; sonoDelta: DeltaInfo | null; ultimaAtualizacao: string | null;
}) {
  const resultado = statusParaHoje(viewModel.recovery);
  const relativo = formatRelativo(ultimaAtualizacao);
  const shortDescription = viewModel.recovery.status === 'INSUFFICIENT_DATA' ? 'Leituras recentes e mais dias comparáveis ajudam a entender seu padrão.' : viewModel.recovery.status === 'BELOW_BASELINE' ? 'Há sinais fora da sua faixa pessoal. Observe o contexto e as próximas leituras.' : viewModel.recovery.status === 'ABOVE_BASELINE' ? 'Dois sinais variaram em direção favorável. Isso não garante recuperação completa.' : 'Não há desvio desfavorável nos sinais que foi possível comparar.';
  return <article className="health-hoje-card">
    <div className="health-hoje-top"><span className="health-hoje-label">ESTADO DE HOJE</span>{relativo && <span className="health-hoje-updated">Leitura {relativo}</span>}</div>
    <div className="health-hoje-main"><StatusRing cor={resultado.cor} /><div className="health-hoje-text"><span className="health-hoje-sublabel">Recuperação</span><div className="health-hoje-status" style={{ color: resultado.cor }}>{recoveryDisplayLabel(viewModel.recovery)}</div><p>{shortDescription}</p></div></div>
    <div className="health-hoje-stats">
      <div><span>FC REPOUSO</span><div className="health-vital-value"><Heart /><b>{fcRepouso ? fcRepouso.value.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : '—'}<small>{fcRepouso ? ' bpm' : ''}</small></b></div>{fcDelta ? <em>{formatDeltaCurto(fcDelta, 'bpm')}<small>vs. sua referência</small></em> : <em>{baselineAvailabilityLabel(viewModel.baselines.heart_rate_resting)}</em>}</div>
      <div><span>{hrvLabel}</span><div className="health-vital-value"><HeartPulse /><b>{hrv ? hrv.value.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : '—'}<small>{hrv ? ' ms' : ''}</small></b></div>{hrvDelta ? <em>{formatDeltaPercentCurto(hrvDelta)}<small>vs. sua referência</small></em> : <em>{baselineAvailabilityLabel(viewModel.baselines[hrvLabel.includes('SDNN') ? 'hrv_sdnn' : 'hrv_rmssd'])}</em>}</div>
      <div><span>SONO</span><div className="health-vital-value"><Moon /><b>{sono ? formatDuration(sono.value) : '—'}</b></div>{sonoDelta ? <em>{formatDeltaCurto(sonoDelta, 'min')}<small>vs. sua referência</small></em> : <em>{baselineAvailabilityLabel(viewModel.baselines.sleep_duration_min)}</em>}</div>
    </div>
    <ConfiancaDosDados amostras={[fcRepouso, hrv, sono]} />
    <details className="health-method-details"><summary>Entenda sua referência e confiança <Info /></summary><DescricaoComRealce texto={resultado.descricao} cor={resultado.cor} /><div className="health-baseline-coverage">{Object.values(viewModel.baselines).filter((baseline) => baseline.latest !== null).map((baseline) => <p key={baseline.metric}><strong>{baseline.label}</strong> · {formatRelativo(baseline.measuredAt)} · {baseline.baselineDays}/{baseline.requiredDays} dias de referência{baseline.status !== 'READY' ? ` · ${baseline.reason}` : ''}</p>)}</div><ul>{viewModel.recovery.factors.map((factor) => <li key={factor}>{factor}</li>)}</ul><small>Menor grau entre as leituras exibidas. A–E não significa precisão percentual. Referência: pelo menos 7 dias comparáveis em até 28 dias, da mesma fonte. {viewModel.methodologyVersion}. Não é avaliação clínica.</small></details>
  </article>;
}

export function HealthSummaryContent({ state, summary, loadingSummary, syncDiagnostics, onGenerateReport, onOpenLegacyReport, onOpenChat, viewModel, periodDays, isPro, trainingPartial = false }: {
  viewModel: HealthViewModel; periodDays: number; isPro: boolean; trainingPartial?: boolean;
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

  const periodSummary = useMemo(() => buildHealthPeriodSummary(state.healthAllWorkouts, Date.now(), periodDays, viewModel.timeZone, trainingPartial), [state.healthAllWorkouts, periodDays, viewModel.timeZone, trainingPartial]);
  const calories = periodSummary.caloriesBurned ?? 0;
  const minutes = periodSummary.activeMinutes;
  const workouts = periodSummary.sessionCount;
  const heartRateAvg = periodSummary.averageHeartRate === null ? null : Math.round(periodSummary.averageHeartRate);

  const fcRepouso = summary?.latest.heart_rate_resting || null;
  const hrvMetric = [viewModel.baselines.hrv_rmssd, viewModel.baselines.hrv_sdnn].filter((baseline) => baseline.status === 'READY').sort((a, b) => Date.parse(b.measuredAt || '') - Date.parse(a.measuredAt || ''))[0]?.metric as 'hrv_rmssd' | 'hrv_sdnn' | undefined || (Date.parse(summary?.latest.hrv_rmssd?.timestamp || '') >= Date.parse(summary?.latest.hrv_sdnn?.timestamp || '') || !summary?.latest.hrv_sdnn ? 'hrv_rmssd' : 'hrv_sdnn');
  const hrvLabel = hrvMetric === 'hrv_rmssd' ? 'HRV · RMSSD' : 'HRV · SDNN';
  const hrv = summary?.latest[hrvMetric] || null;
  const sono = summary?.latest.sleep_duration_min || null;
  const passos = summary?.latest.steps_daily || null;
  const caloriasAtivas = summary?.latest.calories_active || null;

  const semDado = loadingSummary ? 'Carregando…' : 'Sem dados sincronizados';

  const fcTrend = summary?.trends.heart_rate_resting || [];
  const hrvTrend = summary?.trends[hrvMetric] || [];
  const sonoTrend = summary?.trends.sleep_duration_min || [];
  const passosTrend = summary?.trends.steps_daily || [];
  const exercicioTrend = summary?.trends.duration_min || [];
  const freqRespTrend = summary?.trends.respiratory_rate || [];
  const spo2Trend = summary?.trends.oxygen_saturation || [];

  const averages7d = { fc: media7Dias(fcTrend), hrv: media7Dias(hrvTrend), sleep: media7Dias(sonoTrend), steps: media7Dias(passosTrend), respiration: media7Dias(freqRespTrend), oxygen: media7Dias(spo2Trend) };

  const fcDelta = deltaFromBaseline(viewModel.baselines.heart_rate_resting);
  const hrvDelta = deltaFromBaseline(viewModel.baselines[hrvMetric]);
  const sonoDelta = deltaFromBaseline(viewModel.baselines.sleep_duration_min);
  const exercicioUltimoPonto = exercicioTrend.length ? exercicioTrend[exercicioTrend.length - 1].value : null;
  const exercicioDelta = deltaVs7Dias(exercicioTrend, exercicioUltimoPonto);

  const ultimaAtualizacaoHoje = [fcRepouso?.timestamp, hrv?.timestamp, sono?.timestamp]
    .filter((t): t is string => Boolean(t))
    .sort()
    .pop() || null;

  const agora = Date.now();
  const activityCount72h = state.healthTimeframeWorkouts.filter((w) => agora - w.timestamp <= 72 * 60 * 60 * 1000).length;
  const ultimoTreino = [...state.healthTimeframeWorkouts].sort((a, b) => b.timestamp - a.timestamp)[0] || null;

  const insightsParaIA = useMemo(() => buildHealthInsights({
    summary, trainingPartial,
    workouts: state.healthTimeframeWorkouts.map((workout) => ({
      timestamp: workout.timestamp,
      durationMinutes: workout.durationMinutes,
      avgHeartRate: workout.avgHeartRate,
      distanceKm: workout.distanceKm,
      workoutType: workout.workoutType
    }))
  }), [summary, state.healthTimeframeWorkouts, trainingPartial]);

  return (
    <>
      <HealthSyncStatus diagnostics={syncDiagnostics} loading={loadingSummary} />
      <div className="health-tabs">
        {SAUDE_TABS.map((tab) => (
          <button key={tab.id} className={activeTab === tab.id ? 'is-active' : ''} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>
        ))}
        <button className="health-tab-relatorio" onClick={onGenerateReport}>RELATÓRIO</button>
      </div>

      {activeTab === 'saude' && (
        <>
          <div className="health-reference-grid">
            <EstadoDeHojeCard fcRepouso={fcRepouso} hrv={hrv} sono={sono} fcDelta={fcDelta} hrvDelta={hrvDelta} sonoDelta={sonoDelta} ultimaAtualizacao={ultimaAtualizacaoHoje} viewModel={viewModel} hrvLabel={hrvLabel} />
            <SeuCorpoXSeusTreinosCard activityCount72h={activityCount72h} viewModel={viewModel} onVerAnalise={() => setActiveTab('recuperacao')} />
            <UltimoTreinoCard workout={ultimoTreino} onVerDetalhes={() => setActiveTab('atividades')} />
            <RespostaAoTreinoCard state={state} />
            <Evolucao30DiasCard state={state} periodDays={periodDays} onDetails={() => setActiveTab('tendencias')} />
            <SonoXPerformanceCard viewModel={viewModel} onDetails={() => setActiveTab('recuperacao')} />
          </div>

          <section id="health-overview" className="health-overview health-indicator-strip">
            <div className="health-section-line"><div><Activity /> INDICADORES DOS ÚLTIMOS 7 DIAS</div></div>
            <div className="health-metrics-grid-3">
              <MetricCard icon={<Heart />} label="FC REPOUSO" value={averages7d.fc !== null ? Math.round(averages7d.fc!) : '—'} unit={averages7d.fc !== null ? 'bpm' : ''} detail="Média dos dias recebidos" tone="red" onTap={() => setActiveTab('tendencias')} sparklinePoints={fcTrend.filter(isInLastSevenDays).map((p) => p.value)} />
              <MetricCard icon={<HeartPulse />} label={hrvLabel} value={averages7d.hrv !== null ? Math.round(averages7d.hrv!) : '—'} unit={averages7d.hrv !== null ? 'ms' : ''} detail="Média dos dias recebidos" tone="violet" onTap={() => setActiveTab('tendencias')} sparklinePoints={hrvTrend.filter(isInLastSevenDays).map((p) => p.value)} />
              <MetricCard icon={<Moon />} label="SONO" value={averages7d.sleep !== null ? formatDuration(averages7d.sleep!) : '—'} detail="Média dos dias recebidos" tone="blue" onTap={() => setActiveTab('recuperacao')} sparklinePoints={sonoTrend.filter(isInLastSevenDays).map((p) => p.value)} />
              <MetricCard icon={<Footprints />} label="PASSOS" value={averages7d.steps !== null ? Math.round(averages7d.steps!).toLocaleString('pt-BR') : '—'} detail="Média dos dias recebidos" tone="green" onTap={() => setActiveTab('atividades')} sparklinePoints={passosTrend.filter(isInLastSevenDays).map((p) => p.value)} />
              <MetricCard icon={<Wind />} label="FREQ. RESP." value={averages7d.respiration !== null ? averages7d.respiration!.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'} unit={averages7d.respiration !== null ? 'rpm' : ''} detail="Média dos dias recebidos" tone="blue" onTap={() => setActiveTab('tendencias')} sparklinePoints={freqRespTrend.filter(isInLastSevenDays).map((p) => p.value)} />
              <MetricCard icon={<Droplet />} label="SpO₂" value={averages7d.oxygen !== null ? `${Math.round(averages7d.oxygen!)}` : '—'} unit={averages7d.oxygen !== null ? '%' : ''} detail="Média dos dias recebidos" tone="red" onTap={() => setActiveTab('tendencias')} sparklinePoints={spo2Trend.filter(isInLastSevenDays).map((p) => p.value)} />
            </div>
            <p className="health-tap-hint">Médias dos dias com registro. Dias sem leitura não contam como zero. Toque para ver os detalhes.</p>
          </section>

          <InvictusIACTA insights={insightsParaIA} onOpenChat={onOpenChat} />
          <details className="health-deeper-review"><summary>SUA SEMANA EM CONTEXTO <span className="health-pro">PRO</span><ChevronDown /></summary><WeeklyReviewCard viewModel={viewModel} isPro={isPro} /></details>

          <div className="health-report-cta">
            <div><strong>Relatório Saúde &amp; Performance</strong><p>7, 30 ou 90 dias, com origem e confiança das leituras.</p></div>
            <button onClick={onGenerateReport}><FileDown /> VER RELATÓRIO</button>
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
              <MetricCard icon={<Dumbbell />} label="TREINOS" value={workouts} detail="Sessões registradas na Saúde" />
              <MetricCard icon={<Clock3 />} label="TEMPO ATIVO" value={minutes === null ? '—' : formatDuration(minutes)} detail={periodSummary.coverage.durationSessions ? `Duração recebida em ${periodSummary.coverage.durationSessions} de ${workouts} sessões` : 'Sem duração recebida'} />
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
              <MetricCard icon={<Activity />} label="RECUPERAÇÃO" value={viewModel.recovery.label} detail={viewModel.recovery.description} />
            </div>
          </section>
          <SeuCorpoXSeusTreinosCard activityCount72h={activityCount72h} viewModel={viewModel} onVerAnalise={() => document.getElementById('health-explained')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
          <section id="health-explained" className="health-overview health-analysis-explained">
            <div className="health-section-name">ENTENDA SEU CORPO E SEUS TREINOS</div>
            <h3>O que sustenta a leitura de hoje</h3>
            {viewModel.recovery.factors.length ? <ul>{viewModel.recovery.factors.map(factor => <li key={factor}>{factor}</li>)}</ul> : <p>{viewModel.recovery.description}</p>}
            <h3>Volume dos últimos 7 dias</h3><p>{viewModel.load.description}</p>
            <h3>Contexto para a próxima atividade</h3><p>{viewModel.readiness.description}</p>
            <h3>O que observar a seguir</h3><ol>{viewModel.weeklyReview.nextSteps.map(step => <li key={step}>{step}</li>)}</ol>
            <details><summary>Como interpretar estas informações</summary><ul>{viewModel.limitations.map(note => <li key={note}>{note}</li>)}</ul></details>
          </section>
          <article className="health-overview" style={{ marginTop: '1rem' }}>
            <div className="health-section-line"><div>SONO ({periodDays} DIAS)</div></div>
            {summary?.trends.sleep_duration_min?.length ? <ChartBars points={trendPontos(summary.trends.sleep_duration_min.map((p) => ({ timestamp: p.timestamp, value: Math.round(p.value / 60 * 10) / 10 })))} color="violet" /> : <p className="health-empty">Conecte um dispositivo compatível com sono para ver esta tendência.</p>}
          </article>
        </>
      )}

      {activeTab === 'tendencias' && (
        <>
          <article className="health-overview health-trends-compact">
            <div className="health-section-line"><div><Activity /> ÚLTIMA LEITURA × REFERÊNCIA</div></div>
            <div className="health-trend-cols">
              <div>
                <span>FC REPOUSO</span>
                <b style={{ color: fcDelta ? CORES_POR_TOM.red : '#65605a' }}>{fcDelta ? formatDeltaCurto(fcDelta, 'bpm') : '—'}</b>
                <em>{statusPalavra(fcDelta)}</em>
              </div>
              <div>
                <span>{hrvLabel}</span>
                <b style={{ color: hrvDelta ? CORES_POR_TOM.violet : '#65605a' }}>{hrvDelta ? formatDeltaCurto(hrvDelta, 'ms') : '—'}</b>
                <em>{statusPalavra(hrvDelta)}</em>
              </div>
              <div>
                <span>SONO</span>
                <b style={{ color: sonoDelta ? CORES_POR_TOM.blue : '#65605a' }}>{sonoDelta ? formatDeltaCurto(sonoDelta, 'min') : '—'}</b>
                <em>{statusPalavra(sonoDelta)}</em>
              </div>
              <div>
                <span>EXERCÍCIO</span>
                <b style={{ color: exercicioDelta ? CORES_POR_TOM.gold : '#65605a' }}>{exercicioDelta ? formatDeltaCurto(exercicioDelta, 'min') : '—'}</b>
                <em>{statusPalavra(exercicioDelta)}</em>
              </div>
            </div>
          </article>

          <section className="health-overview" style={{ marginTop: '1rem' }}>
            <div className="health-section-line"><div><Heart /> CORAÇÃO</div></div>
            <div className="health-metrics-grid">
              <MetricCard icon={<Heart />} label="FC REPOUSO" value={fcRepouso ? fcRepouso.value.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : '—'} unit={fcRepouso ? 'bpm' : ''} detail={fcRepouso ? `Última leitura: ${formatUltimaLeitura(fcRepouso.timestamp)}` : semDado} tone="red" />
              <MetricCard icon={<HeartPulse />} label={hrvLabel} value={hrv ? hrv.value.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : '—'} unit={hrv ? 'ms' : ''} detail={hrv ? `Última leitura: ${formatUltimaLeitura(hrv.timestamp)}` : semDado} />
              <MetricCard icon={<Heart />} label="FC MÉDIA" value={heartRateAvg || '—'} unit={heartRateAvg ? 'bpm' : ''} detail={heartRateAvg ? 'Média dos treinos do período' : 'Conecte um sensor cardíaco'} tone="red" />
            </div>
          </section>
          <HeartRateCurve state={state} />
          <div className="health-dual">
            <ZoneChart state={state} />
            <article className="health-trend-card">
              <div className="health-section-name">FC REPOUSO ({periodDays} DIAS) <Info /></div>
              <strong>{fcRepouso ? fcRepouso.value.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : '—'} <small>{fcRepouso ? 'bpm' : ''}</small></strong>
              <p>{summary?.trends.heart_rate_resting?.length ? 'Leituras sincronizadas do relógio/app de saúde' : 'Conecte um dispositivo compatível com FC de repouso'}</p>
              <ChartBars points={trendPontos(summary?.trends.heart_rate_resting || [])} color="violet" />
            </article>
          </div>
          <article className="health-overview" style={{ marginTop: '1rem' }}>
            <div className="health-section-line"><div><HeartPulse /> {hrvLabel} ({periodDays} DIAS)</div></div>
            {hrvTrend.length ? <ChartBars points={trendPontos(hrvTrend)} /> : <p className="health-empty">Conecte um dispositivo compatível com HRV para ver esta tendência.</p>}
          </article>

          <EnergyBlock calories={calories} deviceCalories={caloriasAtivas?.value || 0} />
          <article className="health-overview" style={{ marginTop: '1rem' }}>
            <div className="health-section-line"><div>GASTO ENERGÉTICO ESTIMADO ({periodDays} DIAS)</div></div>
            {summary?.trends.calories_active?.length ? <ChartBars points={trendPontos(summary.trends.calories_active)} /> : <p className="health-empty">Ainda não há histórico suficiente para mostrar tendência.</p>}
          </article>

          <section className="health-advanced" style={{ marginTop: '1rem' }}>
            <div className="health-section-name">MÉTRICAS AVANÇADAS <Info /></div>
            <div>
              <span>VO₂ MÁX. ESTIMADO <b>{summary?.latest.vo2max_estimate ? summary.latest.vo2max_estimate.value.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'}</b><small>{summary?.latest.vo2max_estimate ? 'ml/kg/min · estimativa recebida do dispositivo' : 'Sem estimativa de VO₂ recebida do dispositivo'}</small></span>
              <span>COBERTURA DE FC <b>{Math.round(state.heartRateCoverageMinutes || 0)} min</b><small>Tempo com leituras reais da curva</small></span>
              <span>RECUPERAÇÃO <b>{viewModel.recovery.label}</b><small>{viewModel.recovery.description}</small></span>
              <span>DIAS COM ATIVIDADE <b>{periodSummary.activeDays}</b><small>Dias com sessão registrada no período selecionado</small></span>
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
  const { user, state, loading, summary, loadingSummary, syncDiagnostics, refresh, trainingPartial, error, viewModel, periodDays } = useHealthScreen(range);

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
        <SummaryAvailability summary={summary} trainingPartial={trainingPartial} error={error} onRetry={refresh} />
        <HealthSummaryContent
          viewModel={viewModel}
          trainingPartial={trainingPartial}
          periodDays={periodDays}
          isPro={['performance', 'pro'].includes(String(user.subscriptionTier))}
          state={state}
          summary={summary}
          loadingSummary={loadingSummary}
          syncDiagnostics={syncDiagnostics}
          onGenerateReport={() => navigate('/health/report')}
          onOpenLegacyReport={() => navigate('/health/report')}
          onOpenChat={() => navigate('/ai')}
        />
        <HealthMetricLibrary summary={summary} />
        <HealthGlossary onUpdated={refresh} />
      </div><HealthFooter navigate={navigate} />
    </main>
  , document.body);
}

export function HealthReportContent({ onSummaryChange, onPeriodChange, reportNarrative }: {
  onSummaryChange?: (value: HealthSummaryResponse | null) => void;
  onPeriodChange?: (days: number) => void;
  reportNarrative?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const [range, setRange] = useState<TimeRange>('30days');
  const [filterOpen, setFilterOpen] = useState(false);
  const [activitiesExpanded, setActivitiesExpanded] = useState(false);
  const [heartDetailsExpanded, setHeartDetailsExpanded] = useState(false);
  const { user, state, loading, summary, loadingSummary, syncDiagnostics, refresh, trainingPartial, error, viewModel, periodDays, periodSummary } = useHealthScreen(range);
  useEffect(() => { onSummaryChange?.(summary); }, [summary, onSummaryChange]);
  useEffect(() => { onPeriodChange?.(periodDays); }, [periodDays, onPeriodChange]);
  if (!user) return null;
  if (loading || !state) return createPortal(<div className="health-screen health-new-shell health-loading">Preparando seu relatório de saúde…</div>, document.body);
  const { sessionCount, activeMinutes, caloriesBurned, distanceKm, averageHeartRate, coverage } = periodSummary;
  const heartRate = averageHeartRate === null ? null : Math.round(averageHeartRate);
  const coverageText = (count: number) => count ? `Recebido em ${count} de ${sessionCount} sessões` : 'Sem registro nesta métrica';
  const presentPoints = (rows: typeof periodSummary.dailyCalories) => rows.filter((row): row is typeof row & { value: number } => row.value !== null);
  const shortDate = (day: string) => day.split('-').reverse().join('/');
  const latestSteps = summary?.latest.steps_daily;
  const latestSleep = summary?.latest.sleep_duration_min;
  const latestActiveCalories = summary?.latest.calories_active;
  return <main className="health-screen health-report-main"><div className="health-content health-report">
    <HealthHeader title="RELATÓRIO DE SAÚDE" subtitle="Seus registros, mudanças e pontos de atenção." onBack={() => navigate('/health')} right={<div className="health-report-actions"><button onClick={() => window.print()}><Download />EXPORTAR</button><button onClick={() => setFilterOpen(value => !value)} aria-expanded={filterOpen}><SlidersHorizontal />FILTRAR</button></div>} />
    {filterOpen && <div className="health-period-bar">{ranges.map(item => <button key={item.id} className={range === item.id ? 'is-selected' : ''} onClick={() => { setRange(item.id); setFilterOpen(false); }}>{item.label}</button>)}</div>}
    <PeriodControl value={range} onChange={setRange} compact />
    <SummaryAvailability summary={summary} trainingPartial={trainingPartial} error={error} onRetry={refresh} />
    <section className="health-overview health-period-overview" aria-labelledby="health-period-title">
      <div className="health-section-name" id="health-period-title">SEUS {periodDays} DIAS EM RESUMO</div>
      <p className="health-period-dates">{shortDate(periodSummary.startDate)} a {shortDate(periodSummary.endDate)} · hoje ainda em andamento</p>
      <strong>{sessionCount ? `${sessionCount} sessões em ${periodSummary.activeDays} dias com atividade` : 'Nenhuma sessão recebida neste período'}</strong>
      <p>{activeMinutes === null ? 'Ainda não há duração registrada para somar.' : `${formatDuration(activeMinutes)} de treino registradas. `}{trainingPartial ? 'O histórico está incompleto: os totais abaixo podem estar subestimados.' : 'Os totais consideram as mesmas sessões exibidas na lista de Saúde.'}</p>
      <small>O período resume os registros recebidos. Recuperação descreve o estado atual; a revisão de treinos usa os últimos 7 dias. Dias sem registro não comprovam inatividade.</small>
    </section>
    <WeeklyReviewCard viewModel={viewModel} isPro={['performance', 'pro'].includes(String(user.subscriptionTier))} />
    {reportNarrative}
    <HealthInsightsSection summary={summary} state={state} trainingPartial={trainingPartial} />
    {Capacitor.isNativePlatform() && <details className="health-report-data-details"><summary>Ver situação da sincronização</summary><HealthSyncStatus diagnostics={syncDiagnostics} loading={loadingSummary} /></details>}
    <section className="health-report-metrics" aria-label="Totais das sessões de Saúde no período">
      <MetricCard icon={<Flame />} label="GASTO ENERGÉTICO ESTIMADO" value={caloriesBurned === null ? '—' : Math.round(caloriesBurned).toLocaleString('pt-BR')} unit={caloriesBurned === null ? '' : 'kcal'} detail={coverageText(coverage.calorieSessions)} />
      <MetricCard icon={<Clock3 />} label="TEMPO DE TREINO" value={activeMinutes === null ? '—' : formatDuration(activeMinutes)} detail={coverageText(coverage.durationSessions)} />
      <MetricCard icon={<Dumbbell />} label="SESSÕES" value={sessionCount} detail="Atividades registradas na Saúde" />
      <MetricCard icon={<Heart />} label="FC MÉDIA DOS TREINOS" value={heartRate ?? '—'} unit={heartRate === null ? '' : 'bpm'} detail={coverageText(coverage.heartRateSessions)} tone="red" />
      <MetricCard icon={<MapPin />} label="DISTÂNCIA REGISTRADA" value={distanceKm === null ? '—' : distanceKm.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} unit={distanceKm === null ? '' : 'km'} detail={coverageText(coverage.distanceSessions)} />
    </section>
    <section className="health-overview health-report-crossed-metrics">
      <div className="health-section-name">ÚLTIMAS LEITURAS DO DISPOSITIVO <Info /></div>
      <p className="health-report-context-note">Estes são os registros mais recentes recebidos, não os totais de {periodDays} dias. O gasto diário do dispositivo pode incluir os treinos e não é somado ao total das sessões.</p>
      <div className="health-metrics-grid">
        <MetricCard icon={<Footprints />} label="PASSOS" value={latestSteps ? Math.round(latestSteps.value).toLocaleString('pt-BR') : '—'} detail={latestSteps ? `Total diário · ${formatUltimaLeitura(latestSteps.timestamp)}` : 'Sem passos recebidos'} tone="green" />
        <MetricCard icon={<Moon />} label="SONO" value={latestSleep ? formatDuration(latestSleep.value) : '—'} detail={latestSleep ? `Último registro · ${formatUltimaLeitura(latestSleep.timestamp)}` : 'Sem sono recebido'} tone="blue" />
        <MetricCard icon={<Flame />} label="GASTO ATIVO ESTIMADO" value={latestActiveCalories ? Math.round(latestActiveCalories.value).toLocaleString('pt-BR') : '—'} unit={latestActiveCalories ? 'kcal' : ''} detail={latestActiveCalories ? `Total diário · ${formatUltimaLeitura(latestActiveCalories.timestamp)}` : 'Sem gasto ativo recebido'} tone="gold" />
      </div>
    </section>
    <section className="health-report-chart"><div><h2>GASTO ESTIMADO POR DIA <Info /></h2><strong>{caloriesBurned === null ? '—' : Math.round(caloriesBurned).toLocaleString('pt-BR')} <small>{caloriesBurned === null ? '' : 'kcal'}</small></strong><p>Soma das sessões com estimativa recebida. Dias sem valor não entram no gráfico.</p></div><ChartBars points={presentPoints(periodSummary.dailyCalories)} /></section>
    <HeartRateCurve state={state} />
    <section className="health-dual health-report-dual">
      <ZoneChart state={state} onDetails={() => document.getElementById('health-report-heart')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
      <article id="health-report-heart" className="health-trend-card">
        <div className="health-section-name">FC MÉDIA DOS TREINOS · POR DIA <Info /></div>
        <strong>{heartRate ?? '—'} <small>{heartRate === null ? '' : 'bpm'}</small></strong>
        <p>Média das médias das sessões com FC registrada. Não é sua FC ao longo do dia.</p>
        <ChartBars points={presentPoints(periodSummary.dailyHeartRate)} color="violet" />
        {heartDetailsExpanded && <p className="health-empty">Cada sessão com FC média tem o mesmo peso neste resumo. No gráfico, a média é calculada entre as sessões de cada dia. Leituras ausentes não viram zero; a curva individual acima usa os pontos do sensor.</p>}
        <button onClick={() => setHeartDetailsExpanded(value => !value)} aria-expanded={heartDetailsExpanded} className="health-card-link">{heartDetailsExpanded ? 'OCULTAR DETALHES DE FC' : 'ENTENDER ESTA MÉDIA'} <ChevronRight /></button>
      </article>
    </section>
    <section className="health-dual">
      <article className="health-activity-card"><div className="health-section-name">ATIVIDADES POR MODALIDADE <Info /></div>
        <div className="health-activity-total"><strong>{sessionCount}</strong><span>Sessões no período</span></div>
        <div className="health-modality-list">{periodSummary.groups.map(group => <div key={group.type}><span>{group.label}</span><b>{group.sessions} sessões</b><small>{group.minutes === null ? 'Duração não recebida' : formatDuration(group.minutes)}</small></div>)}</div>
        <button onClick={() => setActivitiesExpanded(value => !value)} aria-expanded={activitiesExpanded} className="health-card-link">{activitiesExpanded ? 'MOSTRAR MENOS' : 'VER SESSÕES DO PERÍODO'} <ChevronRight /></button>
      </article>
      <article className="health-weekly-card"><div className="health-section-name">SESSÕES MAIS RECENTES <Info /></div><p className="health-report-context-note">Até 6 sessões do período selecionado.</p>
        {periodSummary.latestWorkouts.length ? periodSummary.latestWorkouts.map(workout => <div key={workout.id}><span>{new Date(workout.timestamp).toLocaleDateString('pt-BR')}</span><b>{workout.caloriesBurned && workout.caloriesBurned > 0 ? `${Math.round(workout.caloriesBurned)} kcal estimadas` : 'Sem estimativa'}</b><span>{workout.durationMinutes > 0 ? formatDuration(workout.durationMinutes) : 'Sem duração'}</span></div>) : <p className="health-empty">Nenhuma sessão recebida no período.</p>}
      </article>
    </section>
    {activitiesExpanded && <LatestWorkouts state={state} expanded onToggle={() => setActivitiesExpanded(false)} />}
    <section className="health-advanced"><div className="health-section-name">CONTEXTO ADICIONAL <Info /></div><div>
      <span>VO₂ MÁX. ESTIMADO <b>{summary?.latest.vo2max_estimate ? summary.latest.vo2max_estimate.value.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'}</b><small>{summary?.latest.vo2max_estimate ? `ml/kg/min · ${formatUltimaLeitura(summary.latest.vo2max_estimate.timestamp)}` : 'Sem estimativa recebida do dispositivo'}</small></span>
      <span>COBERTURA DE FC <b>{Math.round(state.heartRateCoverageMinutes || 0)} min</b><small>Tempo do período coberto por pontos reais do sensor</small></span>
      <span>RECUPERAÇÃO · HOJE <b>{viewModel.recovery.label}</b><small>{viewModel.recovery.description}</small></span>
      <span>DIAS COM ATIVIDADE <b>{periodSummary.activeDays}</b><small>Dias com sessão registrada no período selecionado</small></span>
    </div></section>
  </div></main>;
}
