import { formatDuration, formatPaceValue } from './runUtils';

export interface ShareCardMetricInput {
  distanceKm?: number;
  durationSeconds?: number;
  calories?: number;
  weightKg?: number;
  points?: number;
  activityType?: string;
}

export interface ShareCardMetric {
  label: string;
  value: string;
  unit?: string;
}

function numberLabel(value: number, digits = 0): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * Resolve as três métricas do card com a mesma regra para todas as telas.
 * Atividades com distância exibem sempre distância, pace e tempo — inclusive
 * ciclismo. Velocidade não faz parte do novo modelo aprovado.
 */
export function resolveShareCardMetrics(input: ShareCardMetricInput): ShareCardMetric[] {
  const distanceKm = Math.max(0, Number(input.distanceKm) || 0);
  const durationSeconds = Math.max(0, Math.round(Number(input.durationSeconds) || 0));
  const calories = Math.max(0, Math.round(Number(input.calories) || 0));
  const weightKg = Math.max(0, Number(input.weightKg) || 0);
  const points = Math.max(0, Math.round(Number(input.points) || 0));

  if (distanceKm > 0.01) {
    const pace = formatPaceValue(distanceKm, durationSeconds);
    return [
      { label: 'Distância', value: numberLabel(distanceKm, 2), unit: 'km' },
      { label: 'Pace', value: pace ? pace.replace("'", ':').replace('"', '') : '—', unit: '/km' },
      { label: 'Tempo', value: formatDuration(durationSeconds) },
    ];
  }

  const metrics: ShareCardMetric[] = [
    { label: 'Tempo', value: formatDuration(durationSeconds) },
  ];
  if (weightKg > 0) metrics.push({ label: 'Carga', value: numberLabel(weightKg, 1), unit: 'kg' });
  if (calories > 0) metrics.push({ label: 'Calorias', value: numberLabel(calories), unit: 'kcal' });
  if (points > 0 && metrics.length < 3) metrics.push({ label: 'Pontos', value: numberLabel(points) });
  while (metrics.length < 3) metrics.push({ label: metrics.length === 1 ? 'Calorias' : 'Pontos', value: '—' });
  return metrics.slice(0, 3);
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded = ''] = dataUrl.split(',', 2);
  const mimeType = header.match(/^data:([^;]+)/)?.[1] || 'image/png';
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

