const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent: mockGenerateContent } })),
}));
jest.mock('../_lib/common', () => ({
  FieldValue: { serverTimestamp: jest.fn() },
  cors: jest.fn(() => false),
  verifyAuth: jest.fn(async () => ({ uid: 'athlete-1' })),
  isDbAvailable: jest.fn(() => true),
  db: {
    collection: jest.fn((name: string) => {
      if (name === 'workouts') {
        return {
          where: jest.fn(() => ({
            orderBy: jest.fn(() => ({
              limit: jest.fn(() => ({ get: async () => ({ docs: [] }) }))
            }))
          }))
        };
      }
      return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ pro: true }) }) }) };
    })
  },
}));
jest.mock('../_lib/ai-config', () => ({
  getAiApiKey: () => 'test-key',
  getAiWorkoutModel: () => 'test-model',
  classifyAiError: () => ({ status: 503, message: 'test failure', code: 'UPSTREAM_ERROR', retryable: true }),
}));
jest.mock('../_lib/entitlement', () => ({ isProUser: () => true }));
jest.mock('../_lib/ai-usage-logger', () => ({
  extractUsage: () => ({}),
  logAiUsage: jest.fn(async () => undefined),
  newAiRequestId: () => 'request-1',
}));

import handler, { getCompatibleOfficialExercises, InvalidTrainingPlanError, normalizePlan } from '../_handlers/training-plans';
import { OFFICIAL_EXERCISES_BATCH_01, OFFICIAL_EXERCISE_BY_ID, OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS } from '../../src/data/exerciseCatalog';

const exercise = (exerciseId: string) => ({ exerciseId, sets: 3, repsMin: 8, repsMax: 12, restSeconds: 90 });
const plan = (...ids: string[]) => ({ name: 'Teste', workouts: [{ id: 'a', name: 'A', exercises: ids.map(exercise) }] });
const generationAnswers = {
  primaryGoal: 'massa',
  experienceLevel: 'intermediario',
  experienceTime: '1 a 3 anos',
  daysPerWeek: 3,
  availableWeekdays: [1, 3, 5],
  durationMinutes: 60,
  preferredPeriod: 'Manhã',
  equipment: ['maquinas', 'halteres', 'banco', 'crossover', 'barra_anilhas'],
  preferredTraining: 'forca',
  preferredSplit: 'Outro',
  preferences: [],
  restrictions: []
};
const response = () => {
  let body: any;
  const res: any = { setHeader: jest.fn() };
  res.status = jest.fn(() => res);
  res.json = jest.fn((value: any) => { body = value; return res; });
  return {
    res,
    body: () => body,
    lastStatus: () => res.status.mock.calls.at(-1)?.[0]
  };
};

describe('planos usam o catálogo completo', () => {
  beforeEach(() => { mockGenerateContent.mockReset(); });

  test('a API aceita individualmente todos os 250 IDs oficiais na normalização', () => {
    expect(OFFICIAL_EXERCISES_BATCH_01).toHaveLength(250);
    for (const official of OFFICIAL_EXERCISES_BATCH_01) {
      expect(normalizePlan(plan(official.id), 'athlete').workouts[0].exercises[0].exerciseId).toBe(official.id);
    }
  });

  test('um ID inválido invalida o plano inteiro em vez de sumir silenciosamente', () => {
    expect(() => normalizePlan(plan('classic_push_up', 'invented_id'), 'athlete')).toThrow(InvalidTrainingPlanError);
    expect(() => normalizePlan(plan('classic_push_up', ''), 'athlete')).toThrow(InvalidTrainingPlanError);
  });

  test('o plano normalizado ignora imagens/nomes externos e preserva a prescrição existente', () => {
    const input = plan('barbell_back_squat');
    Object.assign(input.workouts[0].exercises[0], { name: 'Nome inventado', thumbUrl: 'https://example.com/fake.webp', demoUrl: 'https://example.com/fake.mp4' });
    const normalized = normalizePlan(input, 'athlete');
    expect(normalized.workouts[0].exercises[0]).toEqual({ ...exercise('barbell_back_squat'), order: 0 });
  });

  test('a IA não consegue injetar carga inicial; carga manual continua preservada', () => {
    const input = plan('dumbbell_lateral_raise');
    Object.assign(input.workouts[0].exercises[0], { initialLoadKg: 999 });

    const aiPlan = normalizePlan(input, 'athlete', 'ai');
    expect(aiPlan.workouts[0].exercises[0].initialLoadKg).toBeUndefined();

    const manualPlan = normalizePlan(input, 'athlete', 'manual');
    expect(manualPlan.workouts[0].exercises[0].initialLoadKg).toBe(999);
  });

  test('a geração automática usa somente os 99 exercícios com mídia já aprovada', () => {
    const allEquipment = [...new Set(Object.values(OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS).flat())];
    const available = getCompatibleOfficialExercises(allEquipment);
    expect(available).toHaveLength(99);
    expect(new Set(available.map(item => item.group)).size).toBe(6);
    expect(available.some(item => item.id === 'barbell_shrug')).toBe(true);
    expect(available.some(item => item.id === 'barbell_wrist_curl')).toBe(true);
    expect(available.some(item => item.id === 'cable_external_rotation')).toBe(true);
    for (const id of [
      'trap_bar_shrug', 'smith_machine_calf_raise', 'standing_barbell_calf_raise',
      'standing_dumbbell_calf_raise', 'single_leg_calf_raise_bodyweight', 'prone_y_raise_lower_trap',
      'plate_pinch_hold', 'dumbbell_farmer_carry', 'dead_hang', 'single_leg_leg_press_calf_raise',
      'dumbbell_step_up', 'dumbbell_glute_bridge', 'bilateral_cable_lateral_raise',
      'cable_pull_through', 'hanging_knee_raise', 'seated_dumbbell_calf_raise',
      'dumbbell_lateral_lunge', 'reverse_lunge_dumbbell', 'hanging_leg_raise', 'pendulum_squat_machine',
      'arnold_press', 'barbell_front_raise', 'barbell_push_press', 'cable_front_raise',
      'cable_rear_delt_row', 'chest_supported_reverse_dumbbell_fly', 'dumbbell_cuban_rotation',
      'dumbbell_scaption', 'high_cable_reverse_fly', 'machine_lateral_raise',
    ]) {
      expect(available.some(item => item.id === id)).toBe(true);
    }
    expect(available.some(item => item.id === 'donkey_calf_raise_machine')).toBe(false);
    const noEquipment = getCompatibleOfficialExercises([]).map(item => item.id);
    expect(noEquipment).toContain('classic_push_up');
    expect(noEquipment).toContain('bird_dog');
    expect(noEquipment).toContain('tibialis_raise_bodyweight');
    expect(noEquipment).toContain('single_leg_calf_raise_bodyweight');
    expect(noEquipment).not.toContain('dead_hang');
    expect(noEquipment).not.toContain('standing_dumbbell_calf_raise');
    expect(noEquipment).not.toContain('hanging_leg_raise');
    expect(noEquipment).not.toContain('hanging_knee_raise');
    expect(noEquipment).not.toContain('arnold_press');
    expect(noEquipment).not.toContain('machine_lateral_raise');
    expect(noEquipment).not.toContain('pull_up');
    expect(noEquipment).not.toContain('cable_face_pull');
  });

  test('a validação da resposta de IA recusa exercícios oficiais incompatíveis', () => {
    const allowed = new Set(getCompatibleOfficialExercises(['halteres']).map(item => item.id));
    expect(() => normalizePlan(plan('classic_push_up', 'barbell_back_squat'), 'athlete', 'ai', allowed)).toThrow('equipamentos que não foram selecionados');
    expect(normalizePlan(plan('dumbbell_lateral_raise'), 'athlete', 'ai', allowed).workouts[0].exercises).toHaveLength(1);
  });

  test.each([
    ['ID desconhecido', plan('classic_push_up', 'invented_id')],
    ['equipamento não selecionado', plan('classic_push_up', 'pull_up')],
    ['JSON nulo', null],
  ])('o endpoint mantém um fallback válido quando a IA envia %s', async (_label, generated) => {
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(generated) });
    const reply = response();
    await handler({ method: 'POST', body: { action: 'generate', answers: generationAnswers } } as any, reply.res);
    const payload = reply.body();

    expect(reply.lastStatus()).toBe(200);
    expect(payload).toEqual(expect.objectContaining({
      plan: expect.objectContaining({
        generationMode: 'local_fallback',
        workouts: expect.any(Array)
      })
    }));
    expect(payload.plan.workouts.length).toBeGreaterThan(0);
    expect(payload.plan.workouts.flatMap((workout: any) => workout.exercises).every((item: any) => OFFICIAL_EXERCISE_BY_ID.has(item.exerciseId))).toBe(true);
  });

  test('uma sugestão insuficiente da IA não substitui o plano validado do Training Engine nem injeta URL externa', async () => {
    const generated = plan('dumbbell_hammer_curl');
    Object.assign(generated.workouts[0].exercises[0], { thumbUrl: 'https://example.com/not-official.webp', initialLoadKg: 999 });
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(generated) });
    const reply = response();
    await handler({ method: 'POST', body: { action: 'generate', answers: generationAnswers } } as any, reply.res);
    expect(reply.lastStatus()).toBe(200);
    const payload = reply.body();
    expect(payload).toEqual(expect.objectContaining({
      plan: expect.objectContaining({
        generationMode: 'local_fallback',
        workouts: expect.any(Array)
      })
    }));
    expect(payload.plan.workouts.length).toBeGreaterThan(0);
    const items = payload.plan.workouts.flatMap((workout: any) => workout.exercises);
    expect(items.length).toBeGreaterThan(1);
    expect(items.every((item: any) => OFFICIAL_EXERCISE_BY_ID.has(item.exerciseId))).toBe(true);
    expect(items.every((item: any) => item.thumbUrl === undefined && item.demoUrl === undefined)).toBe(true);
    expect(items.every((item: any) => item.initialLoadKg === undefined)).toBe(true);
  });
});
