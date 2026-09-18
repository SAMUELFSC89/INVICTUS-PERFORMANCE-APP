import {
  advancePowerLiftTier,
  calculatePowerVolume,
  canEnterEliteRanking,
  canEnterGeneralRanking,
  countedReps,
  generalCompetitiveScore,
  maxCountedReps,
  modalityCompetitiveScore,
  nextPowerLiftTier,
  rawPowerLiftScore,
  resolvePowerLiftSeason,
  scoredPowerLiftSets,
  tierThreshold,
} from '../core/powerLift/season';

describe('Power Lift sazonal', () => {
  test('usa teto dinâmico de repetições conforme modalidade, sexo e carga', () => {
    expect(maxCountedReps('supino', 'male', 119)).toBe(5);
    expect(maxCountedReps('supino', 'male', 120)).toBe(6);
    expect(maxCountedReps('supino', 'male', 150)).toBe(8);
    expect(maxCountedReps('supino', 'male', 200)).toBe(10);
    expect(countedReps(12, 200, 'supino', 'male')).toBe(10);

    expect(maxCountedReps('agachamento', 'female', 89)).toBe(5);
    expect(maxCountedReps('agachamento', 'female', 90)).toBe(6);
    expect(maxCountedReps('agachamento', 'female', 120)).toBe(8);
    expect(maxCountedReps('agachamento', 'female', 150)).toBe(10);

    expect(maxCountedReps('terra', 'male', 179)).toBe(5);
    expect(maxCountedReps('terra', 'male', 180)).toBe(6);
    expect(maxCountedReps('terra', 'male', 220)).toBe(8);
    expect(maxCountedReps('terra', 'male', 280)).toBe(10);
  });

  test('mantém compatibilidade de cinco reps quando o contexto competitivo não é informado', () => {
    expect(countedReps(10)).toBe(5);
  });

  test('soma no máximo três séries e exclui série abaixo de 70% da maior carga', () => {
    const sets = [
      { weight: 200, reps: 10 },
      { weight: 160, reps: 8 },
      { weight: 100, reps: 10 },
      { weight: 200, reps: 10 },
    ];
    const scored = scoredPowerLiftSets(sets, 'supino', 'male');
    expect(scored).toHaveLength(3);
    expect(scored[0]).toMatchObject({ eligible: true, countedReps: 10, volume: 2000 });
    expect(scored[1]).toMatchObject({ eligible: true, countedReps: 8, volume: 1280 });
    expect(scored[2]).toMatchObject({ eligible: false, countedReps: 0, volume: 0 });
    expect(calculatePowerVolume(sets, 'supino', 'male')).toBe(3280);
  });

  test('usa as tabelas finais de progressão masculina e feminina', () => {
    expect(tierThreshold('supino', 'male', 'DIAMANTE')).toBe(2100);
    expect(tierThreshold('agachamento', 'male', 'DIAMANTE')).toBe(3100);
    expect(tierThreshold('terra', 'male', 'DIAMANTE')).toBe(3400);
    expect(tierThreshold('supino', 'female', 'DIAMANTE')).toBe(1000);
    expect(tierThreshold('agachamento', 'female', 'DIAMANTE')).toBe(1800);
    expect(tierThreshold('terra', 'female', 'DIAMANTE')).toBe(2000);
  });

  test('uma marca muito alta avança no máximo uma categoria por dia', () => {
    expect(advancePowerLiftTier('UNRANKED', 5000, 'supino', 'male')).toBe('FERRO');
    expect(advancePowerLiftTier('FERRO', 5000, 'supino', 'male')).toBe('BRONZE');
    expect(advancePowerLiftTier('OURO', 5000, 'supino', 'male')).toBe('PLATINA');
    expect(advancePowerLiftTier('PLATINA', 5000, 'supino', 'male')).toBe('DIAMANTE');
    expect(advancePowerLiftTier('DIAMANTE', 5000, 'supino', 'male')).toBe('DIAMANTE');
  });

  test('não avança se a marca do dia não alcançar o próximo requisito', () => {
    expect(advancePowerLiftTier('OURO', 1749, 'supino', 'male')).toBe('OURO');
    expect(advancePowerLiftTier('OURO', 1750, 'supino', 'male')).toBe('PLATINA');
  });

  test('Diamante vale 1000 Power Points e resultados acima continuam sem teto', () => {
    expect(rawPowerLiftScore(2100, 'supino', 'male')).toBe(1000);
    expect(rawPowerLiftScore(2310, 'supino', 'male')).toBe(1100);
    expect(rawPowerLiftScore(1000, 'supino', 'female')).toBe(1000);
  });

  test('defesa do título afeta só score competitivo e não acumula no geral', () => {
    expect(modalityCompetitiveScore(1000, true)).toBe(970);
    expect(modalityCompetitiveScore(1000, false)).toBe(1000);
    expect(generalCompetitiveScore(3000, true)).toBe(2850);
    expect(generalCompetitiveScore(3000, false)).toBe(3000);
  });

  test('temporadas têm exatamente trinta dias', () => {
    const season = resolvePowerLiftSeason(new Date('2026-09-18T12:00:00.000Z'));
    const duration = new Date(season.endsAt).getTime() - new Date(season.startsAt).getTime();
    expect(duration).toBe(30 * 24 * 60 * 60 * 1000);
  });

  test('Diamante libera ranking elite e Triplo Diamante libera o geral', () => {
    expect(canEnterEliteRanking('PLATINA')).toBe(false);
    expect(canEnterEliteRanking('DIAMANTE')).toBe(true);
    expect(canEnterGeneralRanking({ supino: 'DIAMANTE', agachamento: 'DIAMANTE', terra: 'PLATINA' })).toBe(false);
    expect(canEnterGeneralRanking({ supino: 'DIAMANTE', agachamento: 'DIAMANTE', terra: 'DIAMANTE' })).toBe(true);
  });

  test('ordem de progressão continua explícita e termina no Diamante', () => {
    expect(nextPowerLiftTier('UNRANKED')).toBe('FERRO');
    expect(nextPowerLiftTier('FERRO')).toBe('BRONZE');
    expect(nextPowerLiftTier('PLATINA')).toBe('DIAMANTE');
    expect(nextPowerLiftTier('DIAMANTE')).toBeNull();
  });
});
