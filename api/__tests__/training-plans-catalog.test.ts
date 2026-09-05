const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent: mockGenerateContent } })),
}));
jest.mock('../_lib/common', () => ({
  FieldValue: { serverTimestamp: jest.fn() },
  cors: jest.fn(() => false),
  verifyAuth: jest.fn(async () => ({ uid: 'athlete-1' })),
  isDbAvailable: jest.fn(() => true),
  db: { collection: jest.fn(() => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ pro: true }) }) }) })) },
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
import { OFFICIAL_EXERCISES_BATCH_01, OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS } from '../../src/data/exerciseCatalog';

const exercise = (exerciseId: string) => ({ exerciseId, sets: 3, repsMin: 8, repsMax: 12, restSeconds: 90 });
const plan = (...ids: string[]) => ({ name: 'Teste', workouts: [{ id: 'a', name: 'A', exercises: ids.map(exercise) }] });
const response = () => {
  const res: any = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
};

describe('planos usam o catálogo completo', () => {
  beforeEach(() => { mockGenerateContent.mockReset(); });

  test('a API aceita individualmente todos os 59 IDs oficiais', () => {
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

  test('o conjunto de equipamentos é o mesmo usado pelo catálogo e inclui os novos grupos', () => {
    const allEquipment = [...new Set(Object.values(OFFICIAL_EXERCISE_EQUIPMENT_REQUIREMENTS).flat())];
    const available = getCompatibleOfficialExercises(allEquipment);
    expect(available).toHaveLength(59);
    expect(new Set(available.map(item => item.group)).size).toBe(6);
    const noEquipment = getCompatibleOfficialExercises([]).map(item => item.id);
    expect(noEquipment).toContain('classic_push_up');
    expect(noEquipment).toContain('bird_dog');
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
    ['equipamento não selecionado', plan('classic_push_up', 'barbell_back_squat')],
    ['JSON nulo', null],
  ])('o endpoint retorna 422 INVALID_PLAN para %s', async (_label, generated) => {
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(generated) });
    const res = response();
    await handler({ method: 'POST', body: { action: 'generate', answers: { equipment: ['halteres'] } } } as any, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_PLAN' }));
  });

  test('o endpoint aceita um novo exercício compatível e ignora a URL inventada pela IA', async () => {
    const generated = plan('dumbbell_hammer_curl');
    Object.assign(generated.workouts[0].exercises[0], { thumbUrl: 'https://example.com/not-official.webp' });
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(generated) });
    const res = response();
    await handler({ method: 'POST', body: { action: 'generate', answers: { equipment: ['halteres'] } } } as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.plan.workouts[0].exercises[0].exerciseId).toBe('dumbbell_hammer_curl');
    expect(payload.plan.workouts[0].exercises[0].thumbUrl).toBeUndefined();
  });
});
