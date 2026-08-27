import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, Download, Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useUser } from '../UserContext';
import { RawWorkoutSession, processUserPerformance, UserPerformanceState } from '../core/performance/performanceEngine';
import { normalizeActivityValidationStatus, readActivityTimestamp } from '../lib/workoutData';
import { healthSummaryService, HealthSummaryResponse, mediaAntesDepois, coberturaPorFonte, PontoTendencia } from '../services/healthSummaryService';

// #54: relatório "Saúde & Performance" -- 6 páginas geradas a partir de
// dados reais (Health Data Layer + performanceEngine), no formato do PDF de
// referência que o usuário enviou (invictus_relatorio_saude_performance_v2.pdf).
//
// REGRA DE OURO desta tela: os parágrafos explicativos ("o que significa",
// "como melhorar", avisos legais) são conteúdo EDUCATIVO GENÉRICO -- o mesmo
// pra qualquer usuário, reaproveitado do PDF de referência. Já os NÚMEROS
// (valores, deltas, zonas, cobertura por fonte) são SEMPRE reais, lidos de
// health_samples/workouts. Quando não há dados suficientes pra uma
// comparação honesta (menos de 4 pontos na série), a seção mostra "dados
// insuficientes" em vez de inventar uma tendência.

function formatSourceLabel(source: string): string {
  switch (source) {
    case 'apple_health': return 'Apple Health';
    case 'health_connect': return 'Health Connect';
    case 'strava': return 'Strava';
    case 'invictus_manual': return 'Invictus (manual)';
    case 'invictus_gps': return 'Invictus (GPS)';
    default: return source;
  }
}

function formatDuration(minutes: number) {
  const total = Math.max(0, Math.round(minutes));
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
}

function Tag({ direction, label }: { direction: 'up' | 'down' | 'neutral'; label: string }) {
  return <span className={`health-report-tag is-${direction}`}>{label}</span>;
}

function deltaTag(antes: number, depois: number, quantoMaiorMelhor: boolean): { direction: 'up' | 'down' | 'neutral'; label: string } {
  const diff = depois - antes;
  if (Math.abs(diff) < 0.001) return { direction: 'neutral', label: 'ESTÁVEL' };
  const subiu = diff > 0;
  const favoravel = quantoMaiorMelhor ? subiu : !subiu;
  return { direction: favoravel ? 'up' : 'down', label: subiu ? 'EM ALTA' : 'EM QUEDA' };
}

interface MiniMetric {
  label: string;
  value: string;
  unit: string;
  delta?: { antes: number; depois: number; quantoMaiorMelhor: boolean; formatarDelta: (v: number) => string };
}

function MiniMetricCard({ metric }: { metric: MiniMetric }) {
  const tag = metric.delta ? deltaTag(metric.delta.antes, metric.delta.depois, metric.delta.quantoMaiorMelhor) : null;
  const diffTexto = metric.delta ? metric.delta.formatarDelta(metric.delta.depois - metric.delta.antes) : null;
  return (
    <div className="health-report-metric-mini">
      <span>{metric.label}</span>
      <strong>{metric.value}<small style={{ marginLeft: 4, fontFamily: 'Barlow,sans-serif', fontSize: 13, color: '#ddd7d0' }}>{metric.unit}</small></strong>
      {tag ? <Tag direction={tag.direction} label={diffTexto ? `${tag.label} (${diffTexto})` : tag.label} /> : <span className="health-report-tag is-neutral">SEM COMPARATIVO</span>}
    </div>
  );
}

function useReportData() {
  const { user } = useUser();
  const [state, setState] = useState<UserPerformanceState | null>(null);
  const [summary30, setSummary30] = useState<HealthSummaryResponse | null>(null);
  const [summary90, setSummary90] = useState<HealthSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const [snapshot, s30, s90] = await Promise.all([
          getDocs(query(collection(db, 'workouts'), where('userId', '==', user.uid))),
          healthSummaryService.fetchSummary(30),
          healthSummaryService.fetchSummary(90)
        ]);
        const workouts = snapshot.docs.reduce<RawWorkoutSession[]>((result, entry) => {
          const item = entry.data();
          const timestamp = readActivityTimestamp(item.timestamp) ?? readActivityTimestamp(item.createdAt);
          const validationStatus = normalizeActivityValidationStatus(item.validationStatus ?? item.status ?? item.validation?.status);
          if (!timestamp || validationStatus !== 'validated') return result;
          result.push({
            id: entry.id,
            userId: item.userId || user.uid,
            timestamp,
            durationMinutes: Number(item.durationMinutes) || Number(item.duration) || 0,
            avgHeartRate: Number(item.avgHeartRate) || Number(item.avgHr) || 0,
            maxHeartRate: Number(item.maxHeartRate) || Number(item.maxHr) || 0,
            caloriesBurned: Number(item.caloriesBurned) || Number(item.calories) || 0,
            distanceKm: Number(item.distanceKm) || Number(item.distance) || 0,
            workoutType: item.workoutType || item.type || 'activity',
            workoutName: item.workoutName || item.title || item.cardioTypeLabel || 'Atividade registrada',
            validationStatus,
            hasSensorData: Boolean(item.avgHeartRate || item.maxHeartRate),
            hasGPSData: Boolean(item.distanceKm || item.distance || item.gpsTracked)
          });
          return result;
        }, []);
        if (active) {
          setState(processUserPerformance(workouts, { ...user, uid: user.uid, name: user.name || user.displayName }, '30days'));
          setSummary30(s30);
          setSummary90(s90);
        }
      } catch (error) {
        console.error('[HealthFullReport] Não foi possível carregar os dados do relatório:', error);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [user]);

  return { user, state, summary30, summary90, loading };
}

function metricNumber(state: UserPerformanceState, key: string) {
  return Number(state.computedMetrics[key]?.currentValue || 0);
}

export function HealthFullReport() {
  const navigate = useNavigate();
  const { user, state, summary30, summary90, loading } = useReportData();

  const periodo = useMemo(() => {
    const fim = new Date();
    const inicio = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).toUpperCase().replace('.', '');
    return `${fmt(inicio)} - ${fmt(fim)}`;
  }, []);

  if (!user) return null;
  if (loading || !state) return <div className="health-screen health-loading">Montando o relatório com seus dados reais…</div>;

  const fcRepousoTrend = summary30?.trends.heart_rate_resting || [];
  const hrvTrend = summary30?.trends.hrv_rmssd || [];
  const sonoTrend = summary30?.trends.sleep_duration_min || [];
  const passosTrend = summary30?.trends.steps_daily || [];
  const caloriasTrend = summary30?.trends.calories_active || [];

  const fcRepousoMedia = mediaAntesDepois(fcRepousoTrend);
  const hrvMedia = mediaAntesDepois(hrvTrend);
  const sonoMedia = mediaAntesDepois(sonoTrend);
  const passosMedia = mediaAntesDepois(passosTrend);
  const caloriasMedia = mediaAntesDepois(caloriasTrend);

  const fcRepousoAtual = summary30?.latest.heart_rate_resting?.value;
  const hrvAtual = summary30?.latest.hrv_rmssd?.value;
  const sonoAtualMin = summary30?.latest.sleep_duration_min?.value;
  const passosAtual = summary30?.latest.steps_daily?.value;
  const calorias = metricNumber(state, 'total_calories_burned');
  const minutos = metricNumber(state, 'total_volume_time');
  const heartRateAvg = metricNumber(state, 'avg_heart_rate');
  const kgEquivalente = calorias > 0 ? calorias / 7700 : 0;

  // Cobertura geral: união de dias com pelo menos uma amostra de qualquer
  // métrica, sobre os 30 dias da janela -- número real, não estimado.
  const todosPontos: PontoTendencia[] = [...fcRepousoTrend, ...hrvTrend, ...sonoTrend, ...passosTrend, ...caloriasTrend];
  const diasComDado = new Set(todosPontos.map((p) => p.timestamp.slice(0, 10))).size;
  const coberturaGeral = summary30 ? Math.min(100, Math.round((diasComDado / summary30.windowDays) * 100)) : 0;
  const fontesConectadas = Array.from(new Set(todosPontos.map((p) => formatSourceLabel(p.source))));

  // Mudanças reais pra tabela "Principais mudanças" -- só entram linhas com
  // comparação possível (>=4 pontos na série).
  const mudancas: Array<{ label: string; antes: string; depois: string; nota: string }> = [];
  if (fcRepousoMedia) mudancas.push({ label: 'FC repouso', antes: `${Math.round(fcRepousoMedia.antes)} bpm`, depois: `${Math.round(fcRepousoMedia.depois)} bpm`, nota: fcRepousoMedia.depois < fcRepousoMedia.antes ? 'Tendência favorável no período' : 'Aumento no período' });
  if (hrvMedia) mudancas.push({ label: 'HRV', antes: `${Math.round(hrvMedia.antes)} ms`, depois: `${Math.round(hrvMedia.depois)} ms`, nota: hrvMedia.depois >= hrvMedia.antes ? 'Estável ou em alta no período' : 'Queda no período' });
  if (sonoMedia) mudancas.push({ label: 'Sono', antes: formatDuration(sonoMedia.antes), depois: formatDuration(sonoMedia.depois), nota: sonoMedia.depois >= sonoMedia.antes ? 'Maior duração média' : 'Menor duração média' });
  if (passosMedia) mudancas.push({ label: 'Passos/dia', antes: Math.round(passosMedia.antes).toLocaleString('pt-BR'), depois: Math.round(passosMedia.depois).toLocaleString('pt-BR'), nota: passosMedia.depois >= passosMedia.antes ? 'Mais movimento diário' : 'Menos movimento diário' });
  if (caloriasMedia) mudancas.push({ label: 'Calorias ativas', antes: `${Math.round(caloriasMedia.antes)} kcal`, depois: `${Math.round(caloriasMedia.depois)} kcal`, nota: caloriasMedia.depois >= caloriasMedia.antes ? 'Aumento de volume/intensidade' : 'Redução de volume/intensidade' });

  // Síntese automática: sentença montada apenas com direções REALMENTE
  // observadas nas comparações acima -- não é texto livre gerado, é um
  // template preenchido com os rótulos que tiveram dado suficiente.
  const direcoesFavoraveis = mudancas.filter((m) => /favor|alta|maior|movimento diário$/.test(m.nota) && !/menor|queda|redução/.test(m.nota)).map((m) => m.label);
  const sinteseAutomatica = mudancas.length === 0
    ? 'Ainda não há dados suficientes no período para uma síntese comparativa. Continue sincronizando seus dispositivos para habilitar esta seção.'
    : direcoesFavoraveis.length > 0
      ? `Foram observadas variações favoráveis em ${direcoesFavoraveis.join(', ')} no período analisado, com base nos dados sincronizados de dispositivos e registros do usuário.`
      : 'O período analisado não mostrou variações claramente favoráveis nas métricas com dados suficientes. Isso não indica, por si só, piora de saúde — pode refletir descanso planejado, mudança de rotina ou variação normal.';

  // Resumo de 90 dias (página 6)
  const fcRepouso90 = mediaAntesDepois(summary90?.trends.heart_rate_resting || []);
  const hrv90 = mediaAntesDepois(summary90?.trends.hrv_rmssd || []);
  const sono90 = mediaAntesDepois(summary90?.trends.sleep_duration_min || []);
  const peso90 = mediaAntesDepois(summary90?.trends.weight_kg || []);
  const calorias90 = mediaAntesDepois(summary90?.trends.calories_active || []);

  const coberturaPorMetrica: Array<{ label: string; cobertura: Array<{ source: string; percent: number }> }> = [
    { label: 'FC repouso', cobertura: coberturaPorFonte(fcRepousoTrend, summary30?.windowDays || 30) },
    { label: 'HRV', cobertura: coberturaPorFonte(hrvTrend, summary30?.windowDays || 30) },
    { label: 'Sono', cobertura: coberturaPorFonte(sonoTrend, summary30?.windowDays || 30) },
    { label: 'Passos', cobertura: coberturaPorFonte(passosTrend, summary30?.windowDays || 30) },
    { label: 'Treinos/calorias', cobertura: coberturaPorFonte(caloriasTrend, summary30?.windowDays || 30) }
  ].filter((item) => item.cobertura.length > 0);

  return (
    <main className="health-screen">
      <div className="health-report-full">
        <div className="health-report-full-toolbar">
          <button aria-label="Voltar" onClick={() => navigate('/health')} className="health-back"><ArrowLeft /></button>
          <button onClick={() => window.print()} className="health-period-picker"><Download /> EXPORTAR PDF</button>
        </div>

        {/* PÁGINA 1 -- VISÃO GERAL */}
        <section className="health-report-page">
          <div className="health-report-page-header">
            <img src="/logo.svg" alt="Invictus" />
            <div>
              <h1>Invictus Saúde &amp; Performance</h1>
              <p>Relatório individual — {periodo}</p>
            </div>
            <span>{coberturaGeral}% do período com dados</span>
          </div>
          <p style={{ margin: '0 0 1rem', color: '#c9c4bd', fontFamily: 'Barlow,sans-serif', fontSize: 12.5 }}>
            {fontesConectadas.length > 0 ? `Fontes: ${fontesConectadas.join(' · ')}` : 'Nenhuma fonte de dados de saúde sincronizada ainda.'}
          </p>
          <h2 className="health-report-section-title">Visão geral</h2>
          <div className="health-metrics-grid-3">
            <MiniMetricCard metric={{ label: 'FC Repouso', value: fcRepousoAtual ? String(fcRepousoAtual) : '—', unit: fcRepousoAtual ? 'bpm' : '', delta: fcRepousoMedia ? { ...fcRepousoMedia, quantoMaiorMelhor: false, formatarDelta: (v) => `${v > 0 ? '+' : ''}${Math.round(v)} bpm` } : undefined }} />
            <MiniMetricCard metric={{ label: 'HRV', value: hrvAtual ? String(hrvAtual) : '—', unit: hrvAtual ? 'ms' : '', delta: hrvMedia ? { ...hrvMedia, quantoMaiorMelhor: true, formatarDelta: (v) => `${v > 0 ? '+' : ''}${Math.round(v)} ms` } : undefined }} />
            <MiniMetricCard metric={{ label: 'Sono', value: sonoAtualMin ? formatDuration(sonoAtualMin) : '—', unit: '', delta: sonoMedia ? { ...sonoMedia, quantoMaiorMelhor: true, formatarDelta: (v) => `${v > 0 ? '+' : ''}${Math.round(v)} min` } : undefined }} />
            <MiniMetricCard metric={{ label: 'Passos/dia', value: passosAtual ? passosAtual.toLocaleString('pt-BR') : '—', unit: '', delta: passosMedia ? { ...passosMedia, quantoMaiorMelhor: true, formatarDelta: (v) => `${v > 0 ? '+' : ''}${Math.round(v).toLocaleString('pt-BR')}` } : undefined }} />
            <MiniMetricCard metric={{ label: 'Exercício', value: formatDuration(minutos), unit: '', delta: undefined }} />
            <MiniMetricCard metric={{ label: 'Atividade', value: calorias.toLocaleString('pt-BR'), unit: 'kcal', delta: caloriasMedia ? { ...caloriasMedia, quantoMaiorMelhor: true, formatarDelta: (v) => `${v > 0 ? '+' : ''}${Math.round(v)} kcal` } : undefined }} />
          </div>
          <div className="health-report-explain">
            <h3>Insight Invictus</h3>
            <p>A leitura mais útil não é classificar um número isolado como "bom" ou "ruim", mas observar sua tendência, seu baseline pessoal, a qualidade da coleta e o contexto.</p>
          </div>
          <div className="health-report-callout">
            <AlertCircle />
            <span>Alterações persistentes ou sintomas devem ser avaliados por profissional de saúde. Este relatório é informativo e educativo — não é diagnóstico nem prescrição.</span>
          </div>
        </section>

        {/* PÁGINA 2 -- CORAÇÃO */}
        <section className="health-report-page">
          <div className="health-report-page-header">
            <img src="/logo.svg" alt="Invictus" />
            <div><h1>Invictus Coração</h1><p>Entenda seus indicadores</p></div>
          </div>
          <div className="health-report-explain">
            <h3>FC de repouso {fcRepousoAtual ? `— ${fcRepousoAtual} bpm` : ''}</h3>
            <p>É a frequência cardíaca observada em repouso. Para acompanhamento de performance, a tendência ao longo do tempo costuma ser mais informativa que um valor isolado.</p>
            <p><strong>Como melhorar/manter:</strong> priorize regularidade de treino, recuperação, sono e hidratação. Compare leituras em condições semelhantes e observe mudanças persistentes.</p>
          </div>
          <div className="health-report-explain">
            <h3>HRV {hrvAtual ? `— ${hrvAtual} ms` : ''}</h3>
            <p>A variabilidade da frequência cardíaca reflete a variação entre batimentos e pode mudar com sono, carga de treino, estresse e outros fatores. Deve ser interpretada principalmente contra o seu próprio baseline.</p>
            <p><strong>Como melhorar/manter:</strong> sono consistente, recuperação adequada e equilíbrio da carga de treino favorecem seu padrão pessoal. Evite comparar diretamente seu HRV com o de outras pessoas.</p>
          </div>
          <div className="health-report-explain">
            <h3>FC durante o exercício {heartRateAvg ? `— média ${heartRateAvg} bpm` : ''}</h3>
            <p>Ajuda a entender a intensidade cardiovascular das sessões. A mesma frequência pode representar esforços diferentes dependendo de idade, condicionamento, modalidade e contexto.</p>
          </div>
          {state.computedMetrics.hr_zones_distribution?.hasEnoughData ? (
            <>
              <h2 className="health-report-section-title">Zonas cardíacas</h2>
              <table className="health-report-table">
                <tbody>
                  {state.hrZones.map((zone) => (
                    <tr key={zone.zoneName}><td>{zone.zoneName}</td><td>{zone.percent}%</td><td>{formatDuration(zone.minutes)}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : <p className="health-empty">Conecte um sensor que registre zonas cardíacas para ver esta seção.</p>}
        </section>

        {/* PÁGINA 3 -- RECUPERAÇÃO */}
        <section className="health-report-page">
          <div className="health-report-page-header">
            <img src="/logo.svg" alt="Invictus" />
            <div><h1>Invictus Recuperação</h1><p>Sono, HRV e contexto</p></div>
          </div>
          <div className="health-report-explain">
            <h3>Sono {sonoAtualMin ? `— média ${formatDuration(sonoAtualMin)}` : ''}</h3>
            <p>O sono influencia recuperação, atenção, disposição e resposta ao treinamento. Duração é apenas uma parte: regularidade e qualidade dos dados também importam.</p>
            <p><strong>Como melhorar/manter:</strong> mantenha horários consistentes e ambiente adequado ao sono. Estágios do sono só aparecem quando a fonte realmente os fornece.</p>
          </div>
          <div className="health-report-explain">
            <h3>HRV e recuperação</h3>
            <p>Uma queda pontual de HRV não significa necessariamente recuperação ruim. O ideal é combinar tendência, baseline e contexto recente antes de destacar uma mudança.</p>
            <p><strong>Como melhorar/manter:</strong> evite reagir a uma única leitura. Observe vários dias, qualidade do sono e carga recente. Se houver sintomas ou alteração persistente, procure avaliação profissional.</p>
          </div>
          <h2 className="health-report-section-title">Índice de recuperação</h2>
          <p style={{ color: '#d0cbc4', fontFamily: 'Barlow,sans-serif', fontSize: 13 }}>
            {state.computedMetrics.recovery_index?.hasEnoughData ? `${metricNumber(state, 'recovery_index')}% — ${state.readinessStatus || ''}` : 'Requer dados recentes de treino para ser calculado.'}
          </p>
        </section>

        {/* PÁGINA 4 -- ATIVIDADE & ENERGIA */}
        <section className="health-report-page">
          <div className="health-report-page-header">
            <img src="/logo.svg" alt="Invictus" />
            <div><h1>Invictus Atividade &amp; Energia</h1><p>Transformando números em contexto</p></div>
          </div>
          <div className="health-report-explain">
            <h3>Exercício — {formatDuration(minutos)}</h3>
            <p>Mostra o volume de exercício registrado no período.</p>
            <p><strong>Como melhorar/manter:</strong> busque consistência antes de aumentar muito o volume. Distribuir sessões ao longo da semana costuma ser mais sustentável que concentrar tudo em poucos dias.</p>
          </div>
          <div className="health-report-explain">
            <h3>Passos {passosAtual ? `— ${passosAtual.toLocaleString('pt-BR')}/dia` : ''}</h3>
            <p>Passos ajudam a visualizar movimento cotidiano fora dos treinos estruturados. O valor deve ser lido junto da rotina e das limitações individuais.</p>
          </div>
          <h2 className="health-report-section-title">Gasto energético em atividade</h2>
          <div className="health-energy-value"><strong>{calorias.toLocaleString('pt-BR')}</strong><span>kcal no período{calorias > 0 ? ` ≈ ${kgEquivalente.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg equivalente` : ''}</span></div>
          <div className="health-energy-disclaimer">
            <AlertCircle />
            <span>Equivalência aproximada usando 7.700 kcal ≈ 1 kg de gordura corporal. Isto NÃO significa que o usuário perdeu {kgEquivalente.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg: ingestão alimentar, metabolismo, água, glicogênio e outros fatores influenciam o peso real.</span>
          </div>
        </section>

        {/* PÁGINA 5 -- INSIGHTS DO PERÍODO */}
        <section className="health-report-page">
          <div className="health-report-page-header">
            <img src="/logo.svg" alt="Invictus" />
            <div><h1>Invictus Insights do Período</h1><p>O que mudou e o que observar</p></div>
          </div>
          <h2 className="health-report-section-title">Principais mudanças</h2>
          {mudancas.length > 0 ? (
            <table className="health-report-table">
              <thead><tr><th>Métrica</th><th>Antes</th><th>Depois</th><th>Nota</th></tr></thead>
              <tbody>{mudancas.map((m) => <tr key={m.label}><td>{m.label}</td><td>{m.antes}</td><td>{m.depois}</td><td>{m.nota}</td></tr>)}</tbody>
            </table>
          ) : <p className="health-empty">Ainda não há dados suficientes no período para comparar tendências.</p>}
          <div className="health-report-explain">
            <h3>O que isso pode significar</h3>
            <p>{sinteseAutomatica}</p>
          </div>
          <h2 className="health-report-section-title">Próximos passos sugeridos</h2>
          <ol className="health-report-list">
            <li>Mantenha a regularidade do sono e compare tendências semanais.</li>
            <li>Evite aumentar volume e intensidade ao mesmo tempo sem necessidade.</li>
            <li>Observe FC de repouso e HRV contra o seu próprio baseline.</li>
            <li>Continue registrando peso se quiser relacionar atividade e evolução corporal.</li>
            <li>Se surgirem sintomas ou mudanças persistentes, leve o relatório a um profissional.</li>
          </ol>
          <div className="health-report-callout"><Info /><span>Insights não são diagnósticos — são interpretações educativas de tendências dos dados registrados.</span></div>
        </section>

        {/* PÁGINA 6 -- RESUMO PARA PROFISSIONAL */}
        <section className="health-report-page">
          <div className="health-report-page-header">
            <img src="/logo.svg" alt="Invictus" />
            <div><h1>Invictus Resumo para Profissional</h1><p>Dados, tendências e proveniência ({summary90?.windowDays || 90} dias)</p></div>
          </div>
          <h2 className="health-report-section-title">Resumo de {summary90?.windowDays || 90} dias</h2>
          <table className="health-report-table">
            <tbody>
              {fcRepouso90 && <tr><td>FC repouso</td><td>{Math.round(fcRepouso90.antes)} → {Math.round(fcRepouso90.depois)} bpm</td></tr>}
              {hrv90 && <tr><td>HRV</td><td>{Math.round(hrv90.antes)} → {Math.round(hrv90.depois)} ms</td></tr>}
              {sono90 && <tr><td>Sono</td><td>{formatDuration(sono90.antes)} → {formatDuration(sono90.depois)}</td></tr>}
              {peso90 && <tr><td>Peso registrado</td><td>{peso90.antes.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} → {peso90.depois.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg</td></tr>}
              {calorias90 && <tr><td>Calorias ativas</td><td>{Math.round(calorias90.antes)} → {Math.round(calorias90.depois)} kcal</td></tr>}
              {!fcRepouso90 && !hrv90 && !sono90 && !peso90 && !calorias90 && <tr><td colSpan={2}>Dados insuficientes para o período de {summary90?.windowDays || 90} dias.</td></tr>}
            </tbody>
          </table>
          <div className="health-report-explain">
            <h3>Síntese automática</h3>
            <p>{sinteseAutomatica}</p>
          </div>
          {coberturaPorMetrica.length > 0 && (
            <>
              <h2 className="health-report-section-title">Origem e cobertura</h2>
              <table className="health-report-table">
                <thead><tr><th>Métrica</th><th>Fonte</th><th>Cobertura</th></tr></thead>
                <tbody>
                  {coberturaPorMetrica.map((item) => item.cobertura.map((c, i) => (
                    <tr key={`${item.label}-${c.source}`}><td>{i === 0 ? item.label : ''}</td><td>{formatSourceLabel(c.source)}</td><td>{c.percent}%</td></tr>
                  )))}
                </tbody>
              </table>
            </>
          )}
          <div className="health-report-callout">
            <AlertCircle />
            <span>Relatório informativo baseado em dados de dispositivos e registros do usuário. Não constitui diagnóstico, prescrição ou recomendação médica.</span>
          </div>
        </section>
      </div>
    </main>
  );
}
