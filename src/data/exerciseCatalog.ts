export type ExerciseAssetStatus = 'ready' | 'waiting_for_thumb' | 'waiting_for_demo';

export interface OfficialExercise {
  id: string;
  name: string;
  muscleGroup: 'peito' | 'costas';
  equipment: string;
  thumbUrl: string;
  demoUrl?: string;
  thumbStatus: ExerciseAssetStatus;
  demoStatus: ExerciseAssetStatus;
}

/**
 * IDs imutáveis usados por planos manuais e pela IA. Nomes podem ser
 * traduzidos no futuro sem quebrar o histórico do atleta.
 */
export const OFFICIAL_EXERCISES_BATCH_01: OfficialExercise[] = [
  { id: 'barbell_bench_press', name: 'Supino Reto com Barra', muscleGroup: 'peito', equipment: 'barra e banco reto', thumbUrl: '/assets/exercise-library/v1/barbell_bench_press/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'dumbbell_bench_press', name: 'Supino Reto com Halteres', muscleGroup: 'peito', equipment: 'halteres e banco reto', thumbUrl: '/assets/exercise-library/v1/dumbbell_bench_press/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'incline_dumbbell_press', name: 'Supino Inclinado com Halteres', muscleGroup: 'peito', equipment: 'halteres e banco inclinado', thumbUrl: '/assets/exercise-library/v1/incline_dumbbell_press/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'standing_cable_fly', name: 'Crucifixo Reto no Cabo', muscleGroup: 'peito', equipment: 'cross-over', thumbUrl: '/assets/exercise-library/v1/standing_cable_fly/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'pec_deck_fly', name: 'Voador / Peck Deck', muscleGroup: 'peito', equipment: 'máquina peck deck', thumbUrl: '/assets/exercise-library/v1/pec_deck_fly/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'classic_push_up', name: 'Flexão de Braços Clássica', muscleGroup: 'peito', equipment: 'peso corporal', thumbUrl: '/assets/exercise-library/v1/classic_push_up/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'decline_push_up', name: 'Flexão de Braços Declinada', muscleGroup: 'peito', equipment: 'banco e peso corporal', thumbUrl: '/assets/exercise-library/v1/decline_push_up/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'incline_push_up', name: 'Flexões com Mãos no Banco', muscleGroup: 'peito', equipment: 'banco e peso corporal', thumbUrl: '/assets/exercise-library/v1/incline_push_up/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'barbell_bent_over_row', name: 'Remada Curvada com Barra', muscleGroup: 'costas', equipment: 'barra', thumbUrl: '/assets/exercise-library/v1/barbell_bent_over_row/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 't_bar_row', name: 'Remada Cavalinho Neutra', muscleGroup: 'costas', equipment: 'barra T', thumbUrl: '/assets/exercise-library/v1/t_bar_row/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' }
];

export const OFFICIAL_EXERCISE_BY_ID = new Map(OFFICIAL_EXERCISES_BATCH_01.map((exercise) => [exercise.id, exercise]));
