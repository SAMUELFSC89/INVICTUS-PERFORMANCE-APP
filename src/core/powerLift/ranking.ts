export type PowerLiftExercise = 'supino' | 'agachamento' | 'terra';

export type PowerLiftRankingRow = {
  id: string;
  userId: string;
  exercise: PowerLiftExercise;
  weight: number;
  powerVolume?: number;
  seasonScore?: number;
  seasonId?: string;
  competitionSex?: 'male' | 'female';
  videoStatus?: string;
};

/**
 * Métrica competitiva do novo Power Lift. A pontuação sazonal terá prioridade
 * quando o motor de categorias estiver preenchendo seasonScore. Durante a
 * migração, Power Volume é a fonte autoritativa; registros legados continuam
 * comparáveis pela carga de 1 repetição.
 */
export function powerLiftRankingValue(row: PowerLiftRankingRow): number {
  const score = Number(row.seasonScore);
  if (Number.isFinite(score) && score > 0) return score;
  const volume = Number(row.powerVolume);
  if (Number.isFinite(volume) && volume > 0) return volume;
  const weight = Number(row.weight);
  return Number.isFinite(weight) && weight > 0 ? weight : 0;
}

/**
 * Ranking é por atleta, não por vídeo. Cada atleta conserva somente a maior
 * marca competitiva homologada de cada modalidade. No modelo sazonal, a
 * comparação prioriza seasonScore/Power Volume e só usa peso como fallback
 * para registros legados.
 */
export function mergePowerLiftRankingRows<T extends PowerLiftRankingRow>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    if (!row?.userId || !row?.exercise) continue;
    const value = powerLiftRankingValue(row);
    if (!Number.isFinite(value) || value <= 0) continue;
    const key = `${row.exercise}:${row.userId}`;
    const current = best.get(key);
    if (!current || value > powerLiftRankingValue(current)) best.set(key, row);
  }
  return [...best.values()].sort((a, b) => {
    if (a.exercise !== b.exercise) return a.exercise.localeCompare(b.exercise);
    return powerLiftRankingValue(b) - powerLiftRankingValue(a);
  });
}

/** A melhor carga pessoal histórica continua sendo carga, não Power Points. */
export function personalBestFromRecords<T extends PowerLiftRankingRow>(rows: T[], exercise: PowerLiftExercise): number | null {
  const weights = rows
    .filter((row) => row.exercise === exercise && row.videoStatus === 'approved')
    .map((row) => Number(row.weight))
    .filter((weight) => Number.isFinite(weight) && weight > 0);
  return weights.length ? Math.max(...weights) : null;
}
