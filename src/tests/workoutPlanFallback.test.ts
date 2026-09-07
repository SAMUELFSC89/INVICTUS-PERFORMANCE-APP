jest.mock('../firebase', () => ({ auth: { currentUser: null } }));
jest.mock('../config', () => ({ API_CONFIG: { baseUrl: '' } }));

import { buildLocalFallbackPlan } from '../services/workoutPlanService';
import type { WorkoutPlanAnswers } from '../types/workoutPlan';

const baseAnswers: WorkoutPlanAnswers = {
  equipment: ['barra_anilhas', 'halteres', 'maquinas', 'banco'],
  daysPerWeek: 3,
  availableWeekdays: [1, 3, 5],
  durationMinutes: 60,
  experienceLevel: 'intermediario',
};

describe('buildLocalFallbackPlan — prescrição baseada no Training Engine', () => {
  it('prioriza reps baixas e descanso longo para o objetivo "forca"', () => {
    const plan = buildLocalFallbackPlan({ ...baseAnswers, primaryGoal: 'forca' });
    const exercise = plan.workouts[0].exercises[0];
    expect(exercise.repsMax).toBeLessThanOrEqual(6);
    expect(exercise.restSeconds).toBeGreaterThanOrEqual(150);
  });

  it('não transforma perda de gordura em reps arbitrariamente altas e descanso curto', () => {
    const plan = buildLocalFallbackPlan({ ...baseAnswers, primaryGoal: 'gordura' });
    const exercise = plan.workouts[0].exercises[0];
    expect(exercise.repsMin).toBeGreaterThanOrEqual(5);
    expect(exercise.repsMax).toBeLessThanOrEqual(15);
    expect(exercise.restSeconds).toBeGreaterThanOrEqual(60);
  });

  it('usa faixa moderada para condicionamento sem sacrificar a qualidade das séries', () => {
    const plan = buildLocalFallbackPlan({ ...baseAnswers, primaryGoal: 'condicionamento' });
    const exercise = plan.workouts[0].exercises[0];
    expect(exercise.repsMin).toBeGreaterThanOrEqual(8);
    expect(exercise.repsMax).toBeLessThanOrEqual(15);
    expect(exercise.restSeconds).toBeGreaterThanOrEqual(60);
  });

  it('começa mais longe da falha para quem está retomando os treinos', () => {
    const controle = buildLocalFallbackPlan({ ...baseAnswers, primaryGoal: 'saude' });
    const retorno = buildLocalFallbackPlan({ ...baseAnswers, primaryGoal: 'retorno' });
    expect(retorno.workouts[0].exercises[0].targetRir).toBeGreaterThan(controle.workouts[0].exercises[0].targetRir || 0);
  });

  it('objetivos sem esquema específico não quebram e caem num padrão seguro', () => {
    const plan = buildLocalFallbackPlan({ ...baseAnswers, primaryGoal: undefined });
    expect(plan.workouts.length).toBeGreaterThan(0);
    expect(plan.workouts[0].exercises.length).toBeGreaterThan(0);
  });
});

describe('buildLocalFallbackPlan — explicação e rastreabilidade', () => {
  it('inclui rationale não vazio mencionando o objetivo escolhido', () => {
    const plan = buildLocalFallbackPlan({ ...baseAnswers, primaryGoal: 'forca' });
    expect(plan.rationale).toBeTruthy();
    expect(plan.rationale).toMatch(/força/i);
  });

  it('preserva a divisão escolhida no snapshot das respostas e versiona o motor', () => {
    const plan = buildLocalFallbackPlan({ ...baseAnswers, preferredSplit: 'Bro split' });
    expect(plan.answers?.preferredSplit).toBe('Bro split');
    expect(plan.trainingEngineVersion).toBeTruthy();
    expect(plan.evidenceVersion).toBeTruthy();
  });
});

describe('buildLocalFallbackPlan — dias e divisão', () => {
  it('usa exatamente os dias da semana escolhidos pelo usuário', () => {
    const plan = buildLocalFallbackPlan({
      ...baseAnswers,
      daysPerWeek: 3,
      availableWeekdays: [2, 4, 6],
      preferredSplit: 'Upper / Lower',
    });
    expect(plan.workouts.map(workout => workout.weekdays[0])).toEqual([2, 4, 6]);
  });

  it('sem preferredSplit definido continua gerando um plano válido', () => {
    const plan = buildLocalFallbackPlan({ ...baseAnswers, preferredSplit: undefined });
    expect(plan.workouts).toHaveLength(3);
    plan.workouts.forEach((workout) => expect(workout.exercises.length).toBeGreaterThan(0));
  });

  it('preferredSplit desconhecido/"Outro" não quebra a geração', () => {
    const plan = buildLocalFallbackPlan({ ...baseAnswers, preferredSplit: 'Outro' });
    expect(plan.workouts.length).toBeGreaterThan(0);
  });
});
