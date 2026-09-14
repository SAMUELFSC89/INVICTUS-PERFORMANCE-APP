import { ValidationEngine } from '../_lib/validation-engine';

const validWorkout = {
  id: 'lifecycle-workout',
  activityType: 'WORKOUT',
  type: 'WORKOUT',
  durationMins: 60,
  timestamp: new Date().toISOString(),
  source: 'APPLE_HEALTH',
  dataSource: 'APPLE_HEALTH',
  avgHeartRate: 135,
};

describe('ValidationEngine — lifecycle competitivo canônico', () => {
  test('perfil ativo permanece elegível', () => {
    const result = ValidationEngine.validate(validWorkout, { status: 'ACTIVE' });
    expect(result.details.userEligible).toBe(true);
  });

  test.each([
    { disabled: true },
    { accountDeleted: true },
    { tombstone: true },
    { deletionStatus: 'deletion_completed' },
    { lifecycleStatus: 'suspended' },
    { accountStatus: 'banned' },
  ])('perfil canonicamente inativo nunca é elegível %#', (profile) => {
    const result = ValidationEngine.validate(validWorkout, profile);
    expect(result.details.userEligible).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.warnings).toContain('Usuário com conta ausente ou inativa não pode validar atividade competitiva.');
  });

  test('perfil solicitado mas indisponível falha fechado', () => {
    const result = ValidationEngine.validate(validWorkout, {});
    expect(result.details.userEligible).toBe(false);
    expect(result.valid).toBe(false);
  });

  test('chamada estrutural antiga sem parâmetro de perfil continua compatível', () => {
    const result = ValidationEngine.validate(validWorkout);
    expect(result.details.userEligible).toBe(true);
  });
});
