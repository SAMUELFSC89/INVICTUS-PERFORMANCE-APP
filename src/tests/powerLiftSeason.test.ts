import {
  calculatePowerVolume,
  countedReps,
  canEnterEliteRanking,
  canEnterGeneralRanking,
  nextPowerLiftTier,
  resolvePowerLiftSeason,
  setPowerVolume,
} from '../core/powerLift/season';

describe('Power Lift sazonal', () => {
  test('limita a cinco repetições contabilizadas por série', () => {
    expect(countedReps(3)).toBe(3);
    expect(countedReps(5)).toBe(5);
    expect(countedReps(10)).toBe(5);
    expect(setPowerVolume({ weight: 100, reps: 10 })).toBe(500);
  });

  test('soma no máximo três séries no Power Volume', () => {
    expect(calculatePowerVolume([
      { weight: 200, reps: 1 },
      { weight: 140, reps: 3 },
      { weight: 100, reps: 5 },
      { weight: 60, reps: 5 },
    ])).toBe(1120);
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

  test('progressão nunca pula mais de uma categoria por avanço', () => {
    expect(nextPowerLiftTier('UNRANKED')).toBe('FERRO');
    expect(nextPowerLiftTier('FERRO')).toBe('BRONZE');
    expect(nextPowerLiftTier('PLATINA')).toBe('DIAMANTE');
    expect(nextPowerLiftTier('DIAMANTE')).toBeNull();
  });
});
