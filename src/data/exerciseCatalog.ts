export type ExerciseAssetStatus = 'ready' | 'waiting_for_thumb' | 'waiting_for_demo';

// #326: catalogo estava travado em 'peito' | 'costas' -- so essas duas
// modalidades tinham exercicios reais cadastrados (10 no total, sendo so 2
// de costas). O tipo mais amplo ja existia em src/types/workoutPlan.ts
// (MuscleGroup), so o catalogo em si nunca acompanhou.
export type OfficialMuscleGroup = 'peito' | 'costas' | 'pernas';

export interface OfficialExercise {
  id: string;
  name: string;
  muscleGroup: OfficialMuscleGroup;
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
  { id: 't_bar_row', name: 'Remada Cavalinho Neutra', muscleGroup: 'costas', equipment: 'barra T', thumbUrl: '/assets/exercise-library/v1/t_bar_row/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },

  // #326: lote de Pernas (17 exercicios, lista definida pelo usuario).
  // thumbStatus 'waiting_for_thumb' -- os arquivos ainda nao existem em
  // public/assets/exercise-library/v1/<id>/thumb.png (vao ser gerados fora
  // deste ambiente, mesmo estilo dos 10 exercicios acima). ExerciseRow.tsx
  // cai num placeholder enquanto o arquivo nao chega.
  { id: 'barbell_back_squat', name: 'Agachamento Livre', muscleGroup: 'pernas', equipment: 'barra e rack', thumbUrl: '/assets/exercise-library/v1/barbell_back_squat/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'smith_machine_squat', name: 'Agachamento no Smith', muscleGroup: 'pernas', equipment: 'máquina smith', thumbUrl: '/assets/exercise-library/v1/smith_machine_squat/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'leg_press_45', name: 'Leg Press 45°', muscleGroup: 'pernas', equipment: 'máquina leg press', thumbUrl: '/assets/exercise-library/v1/leg_press_45/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'hack_squat', name: 'Hack Squat', muscleGroup: 'pernas', equipment: 'máquina hack squat', thumbUrl: '/assets/exercise-library/v1/hack_squat/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'leg_extension', name: 'Cadeira Extensora', muscleGroup: 'pernas', equipment: 'máquina extensora', thumbUrl: '/assets/exercise-library/v1/leg_extension/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'leg_curl', name: 'Mesa Flexora', muscleGroup: 'pernas', equipment: 'máquina flexora', thumbUrl: '/assets/exercise-library/v1/leg_curl/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'seated_leg_curl', name: 'Cadeira Flexora', muscleGroup: 'pernas', equipment: 'máquina flexora sentado', thumbUrl: '/assets/exercise-library/v1/seated_leg_curl/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'barbell_stiff_deadlift', name: 'Stiff / Romanian Deadlift', muscleGroup: 'pernas', equipment: 'halteres', thumbUrl: '/assets/exercise-library/v1/barbell_stiff_deadlift/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'dumbbell_lunge', name: 'Afundo com Halteres', muscleGroup: 'pernas', equipment: 'halteres', thumbUrl: '/assets/exercise-library/v1/dumbbell_lunge/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'bulgarian_split_squat', name: 'Agachamento Búlgaro', muscleGroup: 'pernas', equipment: 'halteres e banco', thumbUrl: '/assets/exercise-library/v1/bulgarian_split_squat/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'dumbbell_walking_lunge', name: 'Passada com Halteres', muscleGroup: 'pernas', equipment: 'halteres', thumbUrl: '/assets/exercise-library/v1/dumbbell_walking_lunge/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'hip_adductor_machine', name: 'Cadeira Adutora', muscleGroup: 'pernas', equipment: 'máquina adutora', thumbUrl: '/assets/exercise-library/v1/hip_adductor_machine/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'hip_abductor_machine', name: 'Cadeira Abdutora', muscleGroup: 'pernas', equipment: 'máquina abdutora', thumbUrl: '/assets/exercise-library/v1/hip_abductor_machine/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'barbell_hip_thrust', name: 'Elevação Pélvica / Hip Thrust', muscleGroup: 'pernas', equipment: 'barra e banco', thumbUrl: '/assets/exercise-library/v1/barbell_hip_thrust/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'standing_calf_raise_machine', name: 'Panturrilha em Pé', muscleGroup: 'pernas', equipment: 'máquina de panturrilha', thumbUrl: '/assets/exercise-library/v1/standing_calf_raise_machine/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'seated_calf_raise', name: 'Panturrilha Sentado', muscleGroup: 'pernas', equipment: 'máquina de panturrilha sentado', thumbUrl: '/assets/exercise-library/v1/seated_calf_raise/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' },
  { id: 'leg_press_calf_raise', name: 'Panturrilha no Leg Press', muscleGroup: 'pernas', equipment: 'máquina leg press', thumbUrl: '/assets/exercise-library/v1/leg_press_calf_raise/thumb.png', thumbStatus: 'ready', demoStatus: 'waiting_for_demo' }
];

export const OFFICIAL_EXERCISE_BY_ID = new Map(OFFICIAL_EXERCISES_BATCH_01.map((exercise) => [exercise.id, exercise]));

// #326: rotulo de exibicao por grupo -- antes era um ternario binario
// (peito ? 'Peito' : 'Costas') em workoutPlanService.ts que rotulava
// qualquer coisa que nao fosse peito como "Costas", inclusive Pernas.
export const OFFICIAL_MUSCLE_GROUP_LABELS: Record<OfficialMuscleGroup, string> = {
  peito: 'Peito',
  costas: 'Costas',
  pernas: 'Pernas'
};
