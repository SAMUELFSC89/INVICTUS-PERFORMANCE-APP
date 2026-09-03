/** Uma leitura real de frequência cardíaca, preservando o instante capturado. */
export interface HeartRateSample {
  timestamp: string;
  bpm: number;
}

export interface HeartRateZoneResult {
  zoneName: string;
  range: string;
  minutes: number;
  percent: number;
  color: string;
  description: string;
}

export interface HeartRateAnalysis {
  samples: HeartRateSample[];
  sampleCount: number;
  averageBpm: number | null;
  maxBpm: number | null;
  minBpm: number | null;
  coverageSeconds: number;
  unclassifiedSeconds: number;
  zones: HeartRateZoneResult[];
  hasEnoughData: boolean;
  reason?: string;
}

interface ZoneDefinition {
  name: string;
  from: number;
  to: number;
  color: string;
  description: string;
}

// As zonas são calculadas sobre a FC máxima informada/medida pelo usuário.
// Não usamos 220 - idade: isso apresentaria uma estimativa como se fosse dado
// individual real.
const ZONES: ZoneDefinition[] = [
  { name: 'Zona Máxima (Vermelho Z5)', from: 0.90, to: 1.01, color: '#EF4444', description: 'Potência anaeróbica máxima, sprints intensos e esforços limite.' },
  { name: 'Zona Limiar Anaeróbico (Z4)', from: 0.80, to: 0.90, color: '#F97316', description: 'Aumento de tolerância ao lactato muscular e velocidade sustentada.' },
  { name: 'Zona Aeróbica Moderada (Z3)', from: 0.70, to: 0.80, color: '#EAB308', description: 'Eficiência cardiovascular e resistência em intensidade moderada.' },
  { name: 'Zona Leve (Aquecimento Z2)', from: 0.60, to: 0.70, color: '#22C55E', description: 'Aquecimento, base aeróbica e esforço confortável.' },
  { name: 'Zona de Recuperação (Z1)', from: 0.50, to: 0.60, color: '#3B82F6', description: 'Recuperação ativa, mobilidade e regeneração.' }
];

const MIN_BPM = 30;
const MAX_BPM = 240;
const MAX_INTERVAL_SECONDS = 60;

function normalizeSamples(input: HeartRateSample[]): HeartRateSample[] {
  const byTimestamp = new Map<string, HeartRateSample>();
  for (const sample of input || []) {
    const timestamp = new Date(sample.timestamp);
    const bpm = Number(sample.bpm);
    if (!Number.isFinite(timestamp.getTime()) || !Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) continue;
    const iso = timestamp.toISOString();
    if (!byTimestamp.has(iso)) byTimestamp.set(iso, { timestamp: iso, bpm: Math.round(bpm * 10) / 10 });
  }
  return [...byTimestamp.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function emptyZones(maxHeartRate: number): HeartRateZoneResult[] {
  return ZONES.map((zone) => ({
    zoneName: zone.name,
    range: maxHeartRate > 0
      ? `${Math.round(maxHeartRate * zone.from)} - ${Math.round(Math.min(maxHeartRate, maxHeartRate * zone.to))} bpm`
      : '—',
    minutes: 0,
    percent: 0,
    color: zone.color,
    description: zone.description
  }));
}

function zoneIndexFor(bpm: number, maxHeartRate: number): number {
  if (!maxHeartRate || bpm < maxHeartRate * 0.5 || bpm > maxHeartRate * 1.01) return -1;
  return ZONES.findIndex((zone) => bpm >= maxHeartRate * zone.from && bpm < maxHeartRate * zone.to);
}

/**
 * Calcula média e tempo em zonas somente nos intervalos entre amostras reais.
 * Intervalos acima de um minuto não são preenchidos, para que uma falha do
 * sensor não vire uma curva ou uma zona artificialmente contínua.
 */
export function analyzeHeartRateSamples(input: HeartRateSample[], maxHeartRate = 0): HeartRateAnalysis {
  const samples = normalizeSamples(input);
  const zones = emptyZones(maxHeartRate);
  if (samples.length === 0) {
    return { samples, sampleCount: 0, averageBpm: null, maxBpm: null, minBpm: null, coverageSeconds: 0, unclassifiedSeconds: 0, zones, hasEnoughData: false, reason: 'Nenhuma amostra real de frequência cardíaca foi recebida.' };
  }

  let coverageSeconds = 0;
  let unclassifiedSeconds = 0;
  let weightedBpmSeconds = 0;
  for (let index = 0; index < samples.length - 1; index += 1) {
    const current = samples[index];
    const next = samples[index + 1];
    const intervalSeconds = (new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime()) / 1000;
    if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0 || intervalSeconds > MAX_INTERVAL_SECONDS) continue;
    coverageSeconds += intervalSeconds;
    weightedBpmSeconds += current.bpm * intervalSeconds;
    const zoneIndex = zoneIndexFor(current.bpm, maxHeartRate);
    if (zoneIndex < 0) unclassifiedSeconds += intervalSeconds;
    else zones[zoneIndex].minutes += intervalSeconds / 60;
  }

  const roundedZones = zones.map((zone) => ({ ...zone, minutes: Number(zone.minutes.toFixed(1)) }));
  const classifiedSeconds = roundedZones.reduce((sum, zone) => sum + zone.minutes * 60, 0);
  const denominator = coverageSeconds > 0 ? coverageSeconds : 0;
  const zonesWithPercent = roundedZones.map((zone) => ({
    ...zone,
    percent: denominator > 0 ? Number(((zone.minutes * 60 / denominator) * 100).toFixed(1)) : 0
  }));
  const rawAverage = samples.reduce((sum, sample) => sum + sample.bpm, 0) / samples.length;

  return {
    samples,
    sampleCount: samples.length,
    averageBpm: coverageSeconds > 0 ? Number((weightedBpmSeconds / coverageSeconds).toFixed(1)) : Number(rawAverage.toFixed(1)),
    maxBpm: Math.max(...samples.map((sample) => sample.bpm)),
    minBpm: Math.min(...samples.map((sample) => sample.bpm)),
    coverageSeconds: Number(coverageSeconds.toFixed(1)),
    unclassifiedSeconds: Number(Math.max(unclassifiedSeconds, coverageSeconds - classifiedSeconds).toFixed(1)),
    zones: zonesWithPercent,
    hasEnoughData: samples.length >= 3 && coverageSeconds >= 60 && maxHeartRate > 0,
    reason: maxHeartRate > 0
      ? (samples.length >= 3 && coverageSeconds >= 60 ? undefined : 'A curva ainda tem poucas amostras ou pouca cobertura temporal para distribuir zonas.')
      : 'Curva recebida. Cadastre sua FC máxima real para calcular zonas personalizadas.'
  };
}

/** Combina várias curvas de treinos mantendo o tempo efetivamente coberto. */
export function aggregateHeartRateSamples(
  workouts: Array<{ heartRateSamples?: HeartRateSample[] }>,
  maxHeartRate = 0
): HeartRateAnalysis {
  const analyses = workouts
    .map((workout) => analyzeHeartRateSamples(workout.heartRateSamples || [], maxHeartRate))
    .filter((analysis) => analysis.sampleCount > 0);
  if (analyses.length === 0) return analyzeHeartRateSamples([], maxHeartRate);

  const zones = emptyZones(maxHeartRate);
  let coverageSeconds = 0;
  let unclassifiedSeconds = 0;
  let weightedBpmSeconds = 0;
  let sampleCount = 0;
  let maxBpm = 0;
  let minBpm = Number.POSITIVE_INFINITY;
  let allSamples: HeartRateSample[] = [];
  for (const analysis of analyses) {
    coverageSeconds += analysis.coverageSeconds;
    unclassifiedSeconds += analysis.unclassifiedSeconds;
    weightedBpmSeconds += (analysis.averageBpm || 0) * analysis.coverageSeconds;
    sampleCount += analysis.sampleCount;
    maxBpm = Math.max(maxBpm, analysis.maxBpm || 0);
    minBpm = Math.min(minBpm, analysis.minBpm || Number.POSITIVE_INFINITY);
    allSamples = allSamples.concat(analysis.samples);
    analysis.zones.forEach((zone, index) => { zones[index].minutes += zone.minutes; });
  }
  const roundedZones = zones.map((zone) => ({ ...zone, minutes: Number(zone.minutes.toFixed(1)) }));
  const zonesWithPercent = roundedZones.map((zone) => ({
    ...zone,
    percent: coverageSeconds > 0 ? Number(((zone.minutes * 60 / coverageSeconds) * 100).toFixed(1)) : 0
  }));

  return {
    samples: allSamples.sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    sampleCount,
    averageBpm: coverageSeconds > 0 ? Number((weightedBpmSeconds / coverageSeconds).toFixed(1)) : null,
    maxBpm: maxBpm || null,
    minBpm: Number.isFinite(minBpm) ? minBpm : null,
    coverageSeconds: Number(coverageSeconds.toFixed(1)),
    unclassifiedSeconds: Number(unclassifiedSeconds.toFixed(1)),
    zones: zonesWithPercent,
    hasEnoughData: sampleCount >= 3 && coverageSeconds >= 60 && maxHeartRate > 0,
    reason: maxHeartRate > 0
      ? (sampleCount >= 3 && coverageSeconds >= 60 ? undefined : 'A curva ainda tem poucas amostras ou pouca cobertura temporal para distribuir zonas.')
      : 'Curvas recebidas. Cadastre sua FC máxima real para calcular zonas personalizadas.'
  };
}
