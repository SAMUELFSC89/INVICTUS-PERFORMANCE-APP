/**
 * Amostras de frequência cardíaca realmente registradas pela fonte de saúde.
 * Não criamos timestamps para pontos que não vieram do HealthKit/Health
 * Connect: sem tempo real não existe curva nem cálculo honesto de zona.
 */
export interface HeartRateSample {
  timestamp: string;
  bpm: number;
}

const MIN_BPM = 30;
const MAX_BPM = 240;
const DEFAULT_MAX_SAMPLES = 12000;

export function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/**
 * Normaliza a resposta do plugin mley. O contrato atual usa timestamp/bpm,
 * mas os aliases abaixo mantêm a ingestão tolerante a versões nativas antigas.
 */
export function normalizeHeartRateSamples(input: unknown, maxSamples = DEFAULT_MAX_SAMPLES): HeartRateSample[] {
  if (!Array.isArray(input)) return [];

  const parsed = input
    .map((item): HeartRateSample | null => {
      if (!item || typeof item !== 'object') return null;
      const sample = item as Record<string, unknown>;
      const timestamp = normalizeIsoTimestamp(sample.timestamp ?? sample.startDate ?? sample.date ?? sample.time);
      const bpm = Number(sample.bpm ?? sample.value ?? sample.heartRate);
      if (!timestamp || !Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) return null;
      return { timestamp, bpm: Math.round(bpm * 10) / 10 };
    })
    .filter((sample): sample is HeartRateSample => Boolean(sample))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Um mesmo ponto pode ser devolvido por duas fontes/leituras do plugin.
  // Mantemos apenas uma amostra por instante para não pesar artificialmente
  // uma zona ou a média temporal.
  const deduplicated = parsed.filter((sample, index) => index === 0 || sample.timestamp !== parsed[index - 1].timestamp);
  if (deduplicated.length <= maxSamples) return deduplicated;

  // Proteção contra payload/documento gigante. A redução preserva início,
  // fim e distribuição ao longo de toda a sessão, em vez de cortar o treino
  // no primeiro bloco.
  const target = Math.max(2, Math.floor(maxSamples));
  return Array.from({ length: target }, (_, index) => {
    const sourceIndex = Math.round((index * (deduplicated.length - 1)) / (target - 1));
    return deduplicated[sourceIndex];
  });
}

export function normalizePositiveNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}
