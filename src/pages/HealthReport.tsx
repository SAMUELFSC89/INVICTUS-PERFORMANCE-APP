import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import { AlertCircle, ArrowRight, ChevronDown, Info, LoaderCircle, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { usePro } from '../ProContext';
import { useUser } from '../UserContext';
import { InvictusLogo } from '../components/InvictusLogo';
import { HealthFooter, HealthReportContent } from './Health';
import type { HealthSummaryResponse, UltimoValorMetrica } from '../services/healthSummaryService';
import { API_CONFIG } from '../config';
import './HealthReport.css';

const concepts = [
  ['HRV', 'É a variação do tempo entre batimentos. Compare com seu próprio histórico. RMSSD e SDNN são métodos diferentes e não devem ser misturados.'],
  ['FC em repouso', 'É a frequência cardíaca quando o corpo está descansando. Observe a tendência ao longo dos dias, junto do contexto de cada leitura.'],
  ['VO₂ máx.', 'É uma estimativa da capacidade de usar oxigênio durante o esforço. Pode ajudar a acompanhar o condicionamento aeróbico.'],
  ['Oxigenação', 'Estima o percentual de oxigênio no sangue. A leitura de um relógio não substitui um oxímetro ou uma avaliação profissional.'],
  ['Cobertura', 'É a quantidade de dias e leituras disponíveis. Poucos registros e intervalos sem dados limitam a interpretação das tendências.'],
  ['Gasto energético estimado', 'É uma estimativa da energia utilizada. Pode variar entre dispositivos e contextos; não representa uma medida exata.'],
];

const metricLabels: Record<string, string> = {
  heart_rate_resting: 'FC em repouso', sleep_duration_min: 'Sono', steps_daily: 'Passos', weight_kg: 'Peso',
  calories_active: 'Gasto energético estimado', calories_total: 'Energia total', calories_basal: 'Energia basal',
  distance_km: 'Distância', distance_cycling_km: 'Distância de ciclismo', vo2max_estimate: 'VO₂ máx.',
  hydration_l: 'Hidratação', body_fat_percent: 'Gordura corporal',
  heart_rate: 'Frequência cardíaca', resting_heart_rate: 'FC em repouso',
  hrv_rmssd: 'HRV · RMSSD', hrv_sdnn: 'HRV · SDNN', sleep_minutes: 'Sono',
  sleep_deep_minutes: 'Sono profundo', sleep_rem_minutes: 'Sono REM', sleep_light_minutes: 'Sono leve',
  sleep_awake_minutes: 'Tempo acordado', steps: 'Passos', weight: 'Peso', body_weight: 'Peso',
  active_calories: 'Energia ativa', basal_calories: 'Energia basal', total_calories: 'Energia total',
  distance: 'Distância', distance_meters: 'Distância', respiratory_rate: 'Frequência respiratória',
  oxygen_saturation: 'Oxigenação', spo2: 'Oxigenação', vo2_max: 'VO₂ máx.',
  blood_pressure_systolic: 'Pressão sistólica', blood_pressure_diastolic: 'Pressão diastólica',
  body_fat_percentage: 'Gordura corporal', body_fat: 'Gordura corporal', hydration: 'Hidratação',
};
const confidenceLabels: Record<string, string> = {
  A: 'Alta', B: 'Boa', C: 'Moderada', D: 'Limitada', E: 'Insuficiente',
};
const integrationLabels: Record<string, string> = {
  apple_health: 'Apple Health', healthkit: 'Apple Health',
  health_connect: 'Health Connect', healthconnect: 'Health Connect',
  strava: 'Strava', invictus: 'Invictus', manual: 'Registro manual',
};
const unavailableMessage = 'A análise da IA está temporariamente indisponível. Seus registros e a qualidade dos dados continuam disponíveis neste relatório.';
const proMessage = 'O Pro explica seus registros em conjunto e destaca o que acompanhar. Seus dados, histórico e relatório continuam disponíveis no plano atual.';

function measurementForDisplay(metric: string, sample: UltimoValorMetrica) {
  if (!Number.isFinite(sample.value)) return { value: '—', unit: '' };
  if ((metric === 'sleep_duration_min' || metric.startsWith('sleep_')) && ['min', 'minutes'].includes(sample.unit)) {
    const minutes = Math.round(sample.value);
    return { value: `${Math.floor(minutes / 60)}h ${minutes % 60}min`, unit: '' };
  }
  const units: Record<string, string> = { count: metric === 'steps_daily' || metric === 'steps' ? 'passos' : '', breaths_per_minute: 'rpm', percent: '%', liters: 'L' };
  return { value: sample.value.toLocaleString('pt-BR', { maximumFractionDigits: 2 }), unit: units[sample.unit] ?? sample.unit };
}

function confidenceForDisplay(sample: UltimoValorMetrica) {
  const levels = [sample.confidenceAtMeasurement?.confidenceLevel, sample.currentEvidenceConfidence?.confidenceLevel]
    .filter((level): level is 'A' | 'B' | 'C' | 'D' | 'E' => Boolean(level && 'ABCDE'.includes(level)));
  return levels.reduce((weakest, level) => 'ABCDE'.indexOf(level) > 'ABCDE'.indexOf(weakest) ? level : weakest, levels[0] || 'E');
}

function formatMeasurementDate(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime())
    ? <><span>{date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>{' '}<span>{date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></>
    : 'Data indisponível';
}

export type HealthNarrativeStatus = 'idle' | 'loading' | 'success' | 'error' | 'pro-required';

export function AiHealthNarrativeView({ days, status, answer = '', error = '', cacheHit = false, onRequest, onUpgrade }: {
  days: number;
  status: HealthNarrativeStatus;
  answer?: string;
  error?: string;
  cacheHit?: boolean;
  onRequest: () => void;
  onUpgrade: () => void;
}) {
  const loading = status === 'loading';
  const buttonText = loading ? 'ANALISANDO SEUS DADOS' : status === 'pro-required' ? 'CONHECER O PRO'
    : status === 'success' ? 'ANALISAR DADOS ATUAIS' : status === 'error' ? 'TENTAR NOVAMENTE' : 'ANALISAR COM IA';
  return <section className={`health-ai-report hrr-narrative is-${status}`} aria-labelledby="hrr-ai-title" aria-busy={loading}>
    <div className="hrr-ai-banner">
      <InvictusLogo size={58} className="hrr-ai-emblem" />
      <div className="hrr-ai-intro">
        <div className="hrr-title-line"><h2 id="hrr-ai-title">INTERPRETAÇÃO INVICTUS IA</h2><span className="hrr-pro-badge">PRO</span></div>
        <p>Entenda o que mudou nos últimos {days} dias, quais dados sustentam a análise e o que acompanhar a seguir.</p>
      </div>
      <button type="button" className="hrr-gold-button" disabled={loading} onClick={status === 'pro-required' ? onUpgrade : onRequest}>
        {loading ? <LoaderCircle className="hrr-spin" aria-hidden="true" /> : status === 'success' ? <RefreshCw aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
        <span>{buttonText}</span>{!loading && <ArrowRight className="hrr-button-arrow" aria-hidden="true" />}
      </button>
    </div>
    <div className="hrr-narrative-state" aria-live="polite">
      {loading && <p className="hrr-loading-copy">Analisando cobertura, leituras e tendências disponíveis…</p>}
      {status === 'idle' && <p className="hrr-narrative-guide">Ao solicitar, você recebe uma explicação baseada nos registros disponíveis. Quando faltar histórico, a análise mostra o que ainda não é possível concluir.</p>}
      {(status === 'error' || status === 'pro-required') && <div className="hrr-feedback">{status === 'pro-required' ? <Sparkles aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}<p>{error || (status === 'pro-required' ? proMessage : unavailableMessage)}</p></div>}
      {status === 'success' && <div className="health-ai-report-text hrr-narrative-answer"><ReactMarkdown>{answer}</ReactMarkdown></div>}
    </div>
    <p className="hrr-ai-footnote"><ShieldCheck aria-hidden="true" /><span>{cacheHit && status === 'success' && 'Análise preservada para este conjunto de dados. '}Conteúdo educativo. Não é diagnóstico nem substituto de atendimento profissional.</span></p>
  </section>;
}

// Opening the report or changing its period never requests AI. Only this explicit action does.
function AiHealthNarrative({ days, isPro }: { days: number; isPro: boolean }) {
  const { showProInvitation } = usePro();
  const [status, setStatus] = useState<HealthNarrativeStatus>(isPro ? 'idle' : 'pro-required');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [cacheHit, setCacheHit] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  const solicitarAnalise = async () => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus('loading');
    setError('');
    try {
      const user = auth.currentUser;
      if (!user) {
        setError('Entre na sua conta para solicitar a análise.');
        setStatus('error');
        return;
      }
      const token = await user.getIdToken();
      if (controller.signal.aborted || auth.currentUser?.uid !== user.uid) return;
      const response = await fetch(`${API_CONFIG.baseUrl}/api/performance-ai`, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'health-report', days,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          screenName: 'Relatório de Saúde', currentPath: '/health/report', includeAudio: false,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (controller.signal.aborted || auth.currentUser?.uid !== user.uid) return;
      if (!response.ok) {
        const requiresPro = payload.code === 'PRO_REQUIRED';
        setError(requiresPro ? proMessage : unavailableMessage);
        setStatus(requiresPro ? 'pro-required' : 'error');
        return;
      }
      if (typeof payload.answer !== 'string' || !payload.answer.trim()) throw new Error('Empty report');
      setAnswer(payload.answer);
      setCacheHit(payload.cacheHit === true);
      setStatus('success');
    } catch {
      if (!controller.signal.aborted) {
        setError(unavailableMessage);
        setStatus('error');
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  return <AiHealthNarrativeView days={days} status={status} answer={answer} error={error} cacheHit={cacheHit}
    onRequest={solicitarAnalise} onUpgrade={() => showProInvitation('Interprete seus registros e tendências de saúde com a Invictus IA.')} />;
}

export function HealthDataQuality({ summary }: { summary: HealthSummaryResponse | null }) {
  const rows = Object.entries(summary?.latest || {}).filter((entry) => entry[1]);
  const failed = summary?.availability === 'error';
  return <section className="health-report-quality hrr-quality" aria-labelledby="hrr-quality-title">
    <div className="hrr-section-heading"><div><h2 id="hrr-quality-title">POSSO CONFIAR NESTAS LEITURAS?</h2><p>Veja a origem, a data e os limites de cada medição. Os valores abaixo são as últimas leituras disponíveis, não médias do período.</p></div><ShieldCheck aria-hidden="true" /></div>
    {rows.length > 0 ? <table className="hrr-quality-table">
      <caption className="hrr-sr-only">Última leitura disponível de cada métrica, dispositivo, integração e confiança.</caption>
      <thead><tr><th scope="col">MÉTRICA</th><th scope="col">ÚLTIMO VALOR</th><th scope="col">DISPOSITIVO / INTEGRAÇÃO</th><th scope="col">CONFIANÇA</th><th scope="col">ÚLTIMA LEITURA</th></tr></thead>
      <tbody>{rows.map(([metric, sample]) => {
        if (!sample) return null;
        const level = confidenceForDisplay(sample);
        const historical = sample.confidenceAtMeasurement?.confidenceLevel;
        const current = sample.currentEvidenceConfidence?.confidenceLevel;
        const limitations = [...new Set([...(sample.confidenceAtMeasurement?.limitations || []), ...(sample.currentEvidenceConfidence?.limitations || [])])];
        const integration = sample.provenance?.integration || sample.source || '';
        const measurement = measurementForDisplay(metric, sample);
        return <tr key={metric}>
          <th scope="row">{metricLabels[metric] || metric.replaceAll('_', ' ')}</th>
          <td data-label="Último valor"><span className="hrr-measurement">{measurement.value}</span> <span className="hrr-measurement-unit">{measurement.unit}</span></td>
          <td className="hrr-source-cell" data-label="Dispositivo / integração"><strong>{sample.provenance?.deviceModel || sample.provenance?.deviceName || sample.device || 'Não identificado'}</strong><small>{integrationLabels[integration.toLowerCase()] || integration || 'Origem desconhecida'}</small></td>
          <td data-label="Confiança"><div className="hrr-confidence-cell"><span className={`hrr-grade level-${level}`}>{level}</span><span>{confidenceLabels[level]}</span></div><details className="hrr-measurement-help"><summary>Entender a nota</summary><p>{historical || current ? 'A nota considera a origem, o contexto da medição e a evidência disponível.' : 'Não há avaliação de confiança disponível para esta leitura.'}</p>{historical && <p>Na medição: {historical} · {confidenceLabels[historical]}.</p>}{current && current !== historical && <p>Evidência atual: {current} · {confidenceLabels[current]}.</p>}{historical && current && historical !== current && <p>Para interpretar agora, usamos a avaliação mais conservadora.</p>}{limitations.length > 0 && <ul>{limitations.map(limitation => <li key={limitation}>{limitation}</li>)}</ul>}</details></td>
          <td data-label="Última leitura"><time dateTime={sample.timestamp}>{formatMeasurementDate(sample.timestamp)}</time></td>
        </tr>;
      })}</tbody>
    </table> : <div className="hrr-empty-state"><Info aria-hidden="true" /><div><strong>{failed ? 'NÃO FOI POSSÍVEL CARREGAR OS DADOS' : summary ? 'SEM LEITURAS NESTE PERÍODO' : 'AGUARDANDO OS DADOS'}</strong><p>{failed ? 'Tente carregar o relatório novamente para consultar a origem e a confiança das leituras.' : summary ? 'Sincronize uma fonte compatível para acompanhar seus registros. A ausência de dados não informa o seu estado de saúde.' : 'A origem e a confiança aparecem aqui assim que as leituras estiverem disponíveis.'}</p></div></div>}
    {summary?.metadata?.partial && <p className="hrr-partial-warning"><AlertCircle aria-hidden="true" />A cobertura deste período está incompleta. Algumas leituras podem não estar representadas.</p>}
    <details className="hrr-confidence-help"><summary>ENTENDA A CONFIANÇA A–E <ChevronDown aria-hidden="true" /></summary><div className="hrr-confidence-legend">{Object.entries(confidenceLabels).map(([grade, label]) => <span key={grade}><span className={`hrr-grade level-${grade}`}>{grade}</span>{label}</span>)}</div><p>A classificação descreve a evidência disponível para a medição. Não avalia seu estado de saúde e não garante precisão clínica.</p></details>
    <p className="hrr-section-footnote">Uma boa nota não confirma que a leitura esteja correta. Se a evidência atual for mais limitada que a da medição, mostramos a nota mais conservadora; o histórico continua preservado nos detalhes.</p>
  </section>;
}

export function HealthReportGlossary() {
  return <section className="health-report-glossary hrr-glossary" aria-labelledby="hrr-glossary-title">
    <div className="hrr-section-heading"><div><h2 id="hrr-glossary-title">ENTENDA OS TERMOS</h2><p>Mais clareza para acompanhar seus registros.</p></div><Info aria-hidden="true" /></div>
    <div className="hrr-glossary-grid">{concepts.map(([term, text]) => <article key={term}><h3>{term}</h3><p>{text}</p></article>)}</div>
    <p className="hrr-section-footnote">Use os dados como apoio para observar seu histórico. Dúvidas sobre sintomas ou resultados precisam de avaliação profissional.</p>
  </section>;
}

export function HealthReport() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [summary, setSummary] = useState<HealthSummaryResponse | null>(null);
  const [days, setDays] = useState(30);
  const isPro = ['performance', 'pro'].includes(String(user?.subscriptionTier));
  return createPortal(
    <div className="health-report-shell health-new-shell">
      <div className="health-report-layout">
        <HealthReportContent onSummaryChange={setSummary} onPeriodChange={setDays}
          reportNarrative={<AiHealthNarrative key={`${user?.uid || 'signed-out'}:${days}:${isPro}:${summary?.fetchedAt || ''}`} days={days} isPro={isPro} />} />
        <div className="health-report-addenda">
          <HealthDataQuality summary={summary} />
          <HealthReportGlossary />
        </div>
      </div>
      <HealthFooter navigate={navigate} />
    </div>,
    document.body,
  );
}
