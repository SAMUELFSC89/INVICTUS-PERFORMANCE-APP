import type { HealthSummaryResponse, PontoTendencia } from '../../services/healthSummaryService';

export type HealthInsightKind = 'congratulations' | 'improvement' | 'decline' | 'alert' | 'tip';

export interface HealthInsight {
  id: string;
  metric: 'heart_rate_response' | 'steps' | 'sleep' | 'calories_active';
  kind: HealthInsightKind;
  priority: number;
  title: string;
  message: string;
  evidence: string;
}

export interface InsightWorkout {
  timestamp: number;
  durationMinutes: number;
  avgHeartRate?: number;
  distanceKm?: number;
  workoutType?: string;
}

export interface HealthInsightInput {
  summary: HealthSummaryResponse | null;
  workouts?: InsightWorkout[];
}

interface Comparison {
  before: number;
  after: number;
  percent: number;
  beforeCount: number;
  afterCount: number;
  samePaceEvidence?: boolean;
}

function validPoints(points: PontoTendencia[] | undefined): PontoTendencia[] {
  return (points || [])
    .filter((point) => Number.isFinite(Number(point.value)) && Number(point.value) > 0 && Number.isFinite(new Date(point.timestamp).getTime()))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function compareHalves(points: PontoTendencia[] | undefined, minimumPerHalf = 2): Comparison | null {
  const valid = validPoints(points);
  if (valid.length < minimumPerHalf * 2) return null;
  const middle = Math.floor(valid.length / 2);
  const before = valid.slice(0, middle).map((point) => Number(point.value));
  const after = valid.slice(middle).map((point) => Number(point.value));
  const beforeAverage = average(before);
  const afterAverage = average(after);
  if (!beforeAverage || !afterAverage) return null;
  return {
    before: beforeAverage,
    after: afterAverage,
    percent: ((afterAverage - beforeAverage) / beforeAverage) * 100,
    beforeCount: before.length,
    afterCount: after.length
  };
}

function formatNumber(value: number, maximumFractionDigits = 0): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits });
}

function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${formatNumber(value, 0)}%`;
}

function coefficientOfVariation(points: PontoTendencia[]): number | null {
  const values = validPoints(points).map((point) => Number(point.value));
  if (values.length < 4) return null;
  const mean = average(values);
  if (!mean) return null;
  const variance = average(values.map((value) => Math.pow(value - mean, 2)));
  return Math.sqrt(variance) / mean;
}

function normalizedType(value?: string): string {
  return String(value || 'atividade').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function comparableHeartRateChange(workouts: InsightWorkout[]): Comparison | null {
  const valid = workouts
    .filter((workout) => Number.isFinite(workout.timestamp) && workout.timestamp > 0
      && Number(workout.durationMinutes) >= 10 && Number(workout.avgHeartRate) >= 40 && Number(workout.avgHeartRate) <= 240)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (valid.length < 4) return null;

  const groups = new Map<string, InsightWorkout[]>();
  for (const workout of valid) {
    const key = normalizedType(workout.workoutType);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(workout);
  }

  let best: Comparison | null = null;
  for (const group of groups.values()) {
    if (group.length < 4) continue;
    const middle = Math.floor(group.length / 2);
    const before = group.slice(0, middle).filter((workout) => Number(workout.avgHeartRate) > 0);
    const after = group.slice(middle).filter((workout) => Number(workout.avgHeartRate) > 0);
    if (before.length < 2 || after.length < 2) continue;

    // Mantém somente sessões de duração parecida. Quando existe distância nas
    // duas sessões, ela também precisa ser parecida para sustentar "mesmo
    // ritmo aproximado"; caso contrário a mensagem usa linguagem mais curta.
    const beforeComparable = before.filter((workout) => after.some((candidate) => {
      const durationRatio = Math.abs(workout.durationMinutes - candidate.durationMinutes) / Math.max(workout.durationMinutes, candidate.durationMinutes);
      const distanceAvailable = Number(workout.distanceKm) > 0 && Number(candidate.distanceKm) > 0;
      const distanceRatio = distanceAvailable
        ? Math.abs((workout.distanceKm || 0) - (candidate.distanceKm || 0)) / Math.max(workout.distanceKm || 1, candidate.distanceKm || 1)
        : 0;
      return durationRatio <= 0.2 && distanceRatio <= 0.2;
    }));
    const afterComparable = after.filter((workout) => beforeComparable.some((candidate) => {
      const durationRatio = Math.abs(workout.durationMinutes - candidate.durationMinutes) / Math.max(workout.durationMinutes, candidate.durationMinutes);
      const distanceAvailable = Number(workout.distanceKm) > 0 && Number(candidate.distanceKm) > 0;
      const distanceRatio = distanceAvailable
        ? Math.abs((workout.distanceKm || 0) - (candidate.distanceKm || 0)) / Math.max(workout.distanceKm || 1, candidate.distanceKm || 1)
        : 0;
      return durationRatio <= 0.2 && distanceRatio <= 0.2;
    }));
    if (beforeComparable.length < 2 || afterComparable.length < 2) continue;

    const candidate = {
      before: average(beforeComparable.map((workout) => Number(workout.avgHeartRate))),
      after: average(afterComparable.map((workout) => Number(workout.avgHeartRate))),
      percent: 0,
      beforeCount: beforeComparable.length,
      afterCount: afterComparable.length,
      samePaceEvidence: beforeComparable.some((workout) => Number(workout.distanceKm) > 0)
        && afterComparable.some((workout) => Number(workout.distanceKm) > 0)
    };
    candidate.percent = ((candidate.after - candidate.before) / candidate.before) * 100;
    if (!best || Math.abs(candidate.percent) > Math.abs(best.percent)) best = candidate;
  }
  return best;
}

/**
 * Interpreta tendências de saúde e sessões comparáveis. As mensagens são
 * educativas: descrevem o que mudou nos dados do próprio atleta e não fazem
 * diagnóstico nem transformam calorias em promessa de emagrecimento.
 */
export function buildHealthInsights({ summary, workouts = [] }: HealthInsightInput): HealthInsight[] {
  if (!summary) return [];
  const insights: HealthInsight[] = [];
  const add = (insight: HealthInsight) => insights.push(insight);

  const heartRateChange = comparableHeartRateChange(workouts);
  if (heartRateChange && Math.abs(heartRateChange.after - heartRateChange.before) >= 5) {
    if (heartRateChange.after < heartRateChange.before) {
      add({
        id: 'heart-rate-response-improved',
        metric: 'heart_rate_response',
        kind: 'congratulations',
        priority: 100,
        title: 'Resposta cardíaca mais eficiente',
        message: `Parabéns, sua resposta cardíaca melhorou: a FC média caiu de ${formatNumber(heartRateChange.before)} para ${formatNumber(heartRateChange.after)} bpm em sessões de duração semelhante. ${heartRateChange.samePaceEvidence ? 'Isso sugere que você está realizando a atividade no mesmo ritmo aproximado, com mais facilidade que antes.' : 'Isso sugere que o mesmo tempo de atividade está exigindo menos do coração que antes; o ritmo exato não foi medido em todas as sessões.'}`,
        evidence: `${heartRateChange.beforeCount + heartRateChange.afterCount} sessões comparáveis · ${formatPercent(heartRateChange.percent)}`
      });
    } else {
      add({
        id: 'heart-rate-response-attention',
        metric: 'heart_rate_response',
        kind: 'alert',
        priority: 95,
        title: 'Resposta cardíaca merece observação',
        message: `A FC média subiu de ${formatNumber(heartRateChange.before)} para ${formatNumber(heartRateChange.after)} bpm em sessões de duração semelhante. Isso pode acontecer por diferença de ritmo, calor, sono ou recuperação; observe as próximas sessões antes de tirar uma conclusão.`,
        evidence: `${heartRateChange.beforeCount + heartRateChange.afterCount} sessões comparáveis · ${formatPercent(heartRateChange.percent)}`
      });
    }
  }

  const stepsChange = compareHalves(summary.trends.steps_daily, 3);
  if (stepsChange && Math.abs(stepsChange.percent) >= 10) {
    const increased = stepsChange.percent > 0;
    add({
      id: increased ? 'steps-improved' : 'steps-declined',
      metric: 'steps',
      kind: increased ? 'congratulations' : 'decline',
      priority: increased ? 80 : 78,
      title: increased ? 'Passos em evolução' : 'Passos abaixo da sua base',
      message: increased
        ? `Parabéns: sua média diária de passos aumentou ${formatPercent(stepsChange.percent)}. Você está acumulando mais movimento no dia a dia do que no início deste período.`
        : `Sua média diária de passos caiu ${formatNumber(Math.abs(stepsChange.percent))}%. Tente retomar pequenos deslocamentos ao longo do dia, respeitando sua rotina e seu corpo.`,
      evidence: `${formatNumber(stepsChange.before)} → ${formatNumber(stepsChange.after)} passos/dia · ${stepsChange.beforeCount + stepsChange.afterCount} dias com registro`
    });
  }

  const sleepPoints = validPoints(summary.trends.sleep_duration_min);
  const sleepChange = compareHalves(sleepPoints, 3);
  const firstSleepRegularity = coefficientOfVariation(sleepPoints.slice(0, Math.floor(sleepPoints.length / 2)));
  const secondSleepRegularity = coefficientOfVariation(sleepPoints.slice(Math.floor(sleepPoints.length / 2)));
  const regularityImproved = firstSleepRegularity !== null && secondSleepRegularity !== null
    && secondSleepRegularity < firstSleepRegularity * 0.85;
  const regularityDeclined = firstSleepRegularity !== null && secondSleepRegularity !== null
    && secondSleepRegularity > firstSleepRegularity * 1.2;
  if (sleepChange && (Math.abs(sleepChange.percent) >= 10 || regularityImproved || regularityDeclined)) {
    if (regularityImproved || (sleepChange.percent >= 10 && !regularityDeclined)) {
      add({
        id: 'sleep-improved',
        metric: 'sleep',
        kind: 'improvement',
        priority: 72,
        title: regularityImproved ? 'Sono mais consistente' : 'Mais sono registrado',
        message: regularityImproved
          ? `Seu horário/tempo de sono ficou mais consistente. A variação entre as noites caiu em relação à primeira metade do período; manter uma rotina parecida pode ajudar sua recuperação.`
          : `Seu tempo médio de sono registrado aumentou ${formatPercent(sleepChange.percent)}. Acompanhe também a regularidade e como você se sente ao acordar.`,
        evidence: `${formatNumber(sleepChange.before / 60, 1)}h → ${formatNumber(sleepChange.after / 60, 1)}h por noite · ${sleepChange.beforeCount + sleepChange.afterCount} noites`
      });
    } else {
      add({
        id: 'sleep-declined',
        metric: 'sleep',
        kind: 'alert',
        priority: 76,
        title: regularityDeclined ? 'Sono menos regular' : 'Sono registrado em queda',
        message: regularityDeclined
          ? 'As noites ficaram mais irregulares do que no início deste período. Tente proteger horários de descanso e observe se isso acompanha mudanças no seu treino ou rotina.'
          : `Seu tempo médio de sono registrado caiu ${formatNumber(Math.abs(sleepChange.percent))}%. Priorize uma rotina de descanso e observe as próximas noites.`,
        evidence: `${formatNumber(sleepChange.before / 60, 1)}h → ${formatNumber(sleepChange.after / 60, 1)}h por noite · ${sleepChange.beforeCount + sleepChange.afterCount} noites`
      });
    }
  }

  const caloriesChange = compareHalves(summary.trends.calories_active, 2);
  if (caloriesChange && Math.abs(caloriesChange.percent) >= 15) {
    const increased = caloriesChange.percent > 0;
    add({
      id: increased ? 'active-calories-up' : 'active-calories-down',
      metric: 'calories_active',
      kind: increased ? 'improvement' : 'decline',
      priority: increased ? 55 : 60,
      title: increased ? 'Mais atividade registrada' : 'Menos atividade registrada',
      message: increased
        ? `O gasto energético ativo registrado aumentou ${formatPercent(caloriesChange.percent)}. Isso indica mais atividade capturada pelo dispositivo, mas calorias são uma estimativa e não medem sozinhas a qualidade do treino.`
        : `O gasto energético ativo registrado caiu ${formatNumber(Math.abs(caloriesChange.percent))}%. Verifique se houve menos atividade ou se o dispositivo deixou de registrar alguma sessão.`,
      evidence: `${formatNumber(caloriesChange.before)} → ${formatNumber(caloriesChange.after)} kcal/dia · ${caloriesChange.beforeCount + caloriesChange.afterCount} dias com registro`
    });
  }

  return insights.sort((a, b) => b.priority - a.priority).slice(0, 4);
}
