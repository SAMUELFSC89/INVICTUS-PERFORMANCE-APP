// Helpers compartilhados para estimar/derivar metricas de atividade (calorias,
// ritmo/pace, cadencia) quando o cliente nao envia esses valores prontos.
// Usado pelos pontos de gravacao da colecao 'workouts' (validate-activity-service,
// commitWorkoutSession, commitRunningSession, RunningService.addRun) para que o
// historico de atividades (ActivityHistorySection.tsx) sempre tenha algo util
// para exibir, mesmo quando o cliente nao enviou calorias/ritmo prontos.

// MET (Metabolic Equivalent of Task) aproximado por tipo de atividade.
// Fonte: Compendium of Physical Activities (valores arredondados de uso comum).
const MET_TABLE: Record<string, number> = {
  RUNNING: 9.8,
  CORRIDA: 9.8,
  WALKING: 3.8,
  CAMINHADA: 3.8,
  CYCLING: 7.5,
  BIKE: 7.5,
  CICLISMO: 7.5,
  SWIMMING: 8.0,
  NATACAO: 8.0,
  WORKOUT: 6.0,
  MUSCULACAO: 6.0,
  CARDIO: 7.0,
  DEFAULT: 6.0
};

function resolveMet(type?: string | null, cardioType?: string | null): number {
  const key = (cardioType || type || 'DEFAULT').toString().toUpperCase().trim();
  return MET_TABLE[key] || MET_TABLE.DEFAULT;
}

// Formula padrao de fisiologia do exercicio: kcal = MET * peso(kg) * tempo(horas)
export function estimateCalories(params: {
  type?: string | null;
  cardioType?: string | null;
  durationMins?: number | null;
  weightKg?: number | null;
}): number {
  const durationHours = Math.max(0, Number(params.durationMins) || 0) / 60;
  const weightKg = Number(params.weightKg) && Number(params.weightKg)! > 0 ? Number(params.weightKg) : 70; // fallback: peso medio adulto
  const met = resolveMet(params.type, params.cardioType);
  const kcal = met * weightKg * durationHours;
  return Math.round(kcal);
}

// Formata ritmo medio no padrao "M'SS\"/km" a partir de distancia (km) e duracao (min)
export function formatPace(distanceKm?: number | null, durationMins?: number | null): string | null {
  const km = Number(distanceKm) || 0;
  const mins = Number(durationMins) || 0;
  if (km <= 0 || mins <= 0) return null;
  const paceMinPerKm = mins / km;
  let wholeMin = Math.floor(paceMinPerKm);
  let secs = Math.round((paceMinPerKm - wholeMin) * 60);
  if (secs === 60) {
    secs = 0;
    wholeMin += 1;
  }
  return `${wholeMin}'${String(secs).padStart(2, '0')}"/km`;
}

// Cadencia media (passos por minuto) a partir de passos totais e duracao
export function estimateCadence(steps?: number | null, durationMins?: number | null): number | null {
  const s = Number(steps) || 0;
  const mins = Number(durationMins) || 0;
  if (s <= 0 || mins <= 0) return null;
  return Math.round(s / mins);
}
