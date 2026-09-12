export type PowerLiftExercise = 'supino' | 'agachamento' | 'terra';

export type PowerLiftRankingRow = {
  id: string;
  userId: string;
  exercise: PowerLiftExercise;
  weight: number;
  videoStatus?: string;
};

/**
 * Ranking é por atleta, não por vídeo. Cada atleta conserva somente a maior
 * marca homologada de cada modalidade e cada modalidade permanece ordenada
 * por carga. Isso impede que vários vídeos do mesmo atleta ocupem várias
 * posições do ranking.
 */
export function mergePowerLiftRankingRows<T extends PowerLiftRankingRow>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    if (!row?.userId || !row?.exercise || !Number.isFinite(Number(row.weight))) continue;
    const key = `${row.exercise}:${row.userId}`;
    const current = best.get(key);
    if (!current || Number(row.weight) > Number(current.weight)) best.set(key, row);
  }
  return [...best.values()].sort((a, b) => {
    if (a.exercise !== b.exercise) return a.exercise.localeCompare(b.exercise);
    return Number(b.weight) - Number(a.weight);
  });
}

/** A melhor marca pessoal vem do histórico do próprio atleta, não do recorte público do ranking. */
export function personalBestFromRecords<T extends PowerLiftRankingRow>(rows: T[], exercise: PowerLiftExercise): number | null {
  const weights = rows
    .filter((row) => row.exercise === exercise && row.videoStatus === 'approved')
    .map((row) => Number(row.weight))
    .filter((weight) => Number.isFinite(weight) && weight > 0);
  return weights.length ? Math.max(...weights) : null;
}
