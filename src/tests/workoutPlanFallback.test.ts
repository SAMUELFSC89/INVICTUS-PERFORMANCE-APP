jest.mock('../firebase', () => ({ auth: { currentUser: null } }));
jest.mock('../config', () => ({ API_CONFIG: { baseUrl: '' } }));

import { buildLocalFallbackPlan } from '../services/workoutPlanService';
import type { WorkoutPlanAnswers } from '../types/workoutPlan';

// #245: o plano de contingencia (usado sempre que o Gemini falha ou o
// usuario e Free) precisa refletir de verdade o objetivo e a divisao
// escolhidos no questionario -- antes disso, so "forca" tinha esquema
// proprio e preferredSplit era completamente ignorado na montagem dos dias.
const baseAnswers: WorkoutPlanAnswers = {
  equipment: ['barra_anilhas', 'halteres', 'maquinas', 'banco'],
  daysPerWeek: 3,
  durationMinutes: 60,
  experienceLevel: 'intermediario',
};

describe('buildLocalFallbackPlan — objetivo do usuario', () => {
  it('usa reps baixas e descanso longo para o objetivo "forca"', () => {
    const plan = buildLocalFallbackPlan({ ...baseAnswers, primaryGoal: 'forca' });
    const exercise = plan.workouts[0].exercises[0];
    expect(exercise.repsMax).toBeLessThanOrEqual(6);
    expect(exercise.restSeconds).toBeGreaterThanOrEqual(150);
  });

  it('usa reps altas e descanso curto para "gordura" (diferente de "forca")', () => {
    const plan = buildLocalFallbackPlan({ ...baseAnswers, primaryGoal: 'gordura' });
    const exercise = plan.workouts[0].exercises[0];
    expect(exercise.repsMin).toBeGreaterThanOrEqual(12);
    expect(exercise.restSeconds).toBeLessThanOrEqual(45);
  });

  it('usa reps altas e descanso curto para "condicionamento" também', () => {
    const plan = buildLocalFallbackPlan({ ...baseAnswers, primaryGoal: 'condicionamento' });
    const exercise = plan.workouts[0].exercises[0];
    expect(exercise.repsMin).toBeGreaterThanOrEqual(12);
    expect(exercise.restSeconds).toBeLessThanOrEqual(45);
  });

  it('reduz series (não reps) para quem está "retomando os treinos"', () => {
    const controle = buildLocalFallbackPlan({ ...baseAnswers, primaryGoal: 'saude' });
    const retorno = buildLocalFallbackPlan({ ...baseAnswers, primaryGoal: 'retorno' });
    expect(retorno.workouts[0].exercises[0].sets).toBeLessThan(controle.workouts[0].exercises[0].sets);
  });

  it('objetivos sem esquema específico (indefinido) não quebram e caem num padrão seguro', () => {
    const plan = buildLocalFallbackPlan({ ...baseAnswers, primaryGoal: undefined });
    expect(plan.workouts.length).toBeGreaterThan(0);
    expect(plan.workouts[0].exercises.length).toBeGreaterThan(0);
  });
});

// #246: o plano de contingência precisa explicar o "porquê" das escolhas de
// série/reps/descanso/divisão, não só entregá-las prontas.
describe('buildLocalFallbackPlan — explicação do "porquê" (rationale)', () => {
  it('inclui um rationale não vazio mencionando o objetivo escolhido', () => {
    const plan = buildLocalFallbackPlan({ ...baseAnswers, primaryGoal: 'forca' });
    expect(plan.rationale).toBeTruthy();
    expect(plan.rationale).toMatch(/força/i);
  });

  it('menciona a divisão escolhida quando preferredSplit está definido', () => {
    const plan = buildLocalFallbackPlan({ ...baseAnswers, preferredSplit: 'Bro split' });
    expect(plan.rationale).toMatch(/Bro split/);
  });
});

describe('buildLocalFallbackPlan — divisão preferida (preferredSplit)', () => {
  it('"Bro split" concentra cada dia num único grupo muscular quando há exercícios suficientes', () => {
    const plan = buildLocalFallbackPlan({
      ...baseAnswers,
      daysPerWeek: 4,
      preferredSplit: 'Bro split',
    });
    // #245: com equipamento amplo (barra/halteres/maquinas/banco) a
    // biblioteca oficial cobre multiplos grupos -- o dia deve focar em 1
    // grupo predominante em vez do round-robin generico anterior.
    const singleFocusDays = plan.workouts.filter((workout) => workout.focus.split(' e ').length === 1);
    expect(singleFocusDays.length).toBeGreaterThan(0);
  });

  it('sem preferredSplit definido, continua gerando um plano válido (comportamento anterior preservado)', () => {
    const plan = buildLocalFallbackPlan({ ...baseAnswers, preferredSplit: undefined });
    expect(plan.workouts).toHaveLength(3);
    plan.workouts.forEach((workout) => expect(workout.exercises.length).toBeGreaterThan(0));
  });

  it('preferredSplit desconhecido/"Outro" não quebra a geração', () => {
    const plan = buildLocalFallbackPlan({ ...baseAnswers, preferredSplit: 'Outro' });
    expect(plan.workouts.length).toBeGreaterThan(0);
  });
});
