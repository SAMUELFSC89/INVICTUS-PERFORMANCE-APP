import { analyzeHeartRateSamples, aggregateHeartRateSamples } from '../core/health/heartRateAnalysis';
import { buildHealthInsights } from '../core/health/healthInsights';
import { processUserPerformance } from '../core/performance/performanceEngine';

function point(day: number, value: number) {
  return { timestamp: `2026-08-${String(day).padStart(2, '0')}T08:00:00.000Z`, value, source: 'apple_health', unit: 'passos',
    confidenceAtMeasurement: { confidenceLevel: 'B' as const, confidenceScore: 75, confidenceReason: 'Fixture', limitations: [], evidenceReferences: [], confidenceEngineVersion: 'test', measurementContext: 'daily', provenanceStatus: 'identified', assessedAt: '2026-08-26T12:00:00Z' } };
}

describe('métricas cruzadas de saúde', () => {
  test('distribui zonas pelo tempo entre amostras reais', () => {
    const result = analyzeHeartRateSamples([
      { timestamp: '2026-08-28T10:00:00.000Z', bpm: 100 },
      { timestamp: '2026-08-28T10:00:30.000Z', bpm: 160 },
      { timestamp: '2026-08-28T10:01:00.000Z', bpm: 180 }
    ], 200);

    expect(result.hasEnoughData).toBe(true);
    expect(result.coverageSeconds).toBe(60);
    expect(result.zones.find((zone) => zone.zoneName.includes('Z1'))?.minutes).toBe(0.5);
    expect(result.zones.find((zone) => zone.zoneName.includes('Z4'))?.minutes).toBe(0.5);
    expect(result.zones.find((zone) => zone.zoneName.includes('Z5'))?.minutes).toBe(0);
  });

  test('não preenche lacuna longa do sensor', () => {
    const result = analyzeHeartRateSamples([
      { timestamp: '2026-08-28T10:00:00.000Z', bpm: 120 },
      { timestamp: '2026-08-28T10:03:00.000Z', bpm: 120 }
    ], 200);

    expect(result.coverageSeconds).toBe(0);
    expect(result.hasEnoughData).toBe(false);
  });

  test('combina curvas de sessões sem usar duração inteira do treino', () => {
    const result = aggregateHeartRateSamples([
      { heartRateSamples: [
        { timestamp: '2026-08-28T10:00:00.000Z', bpm: 100 },
        { timestamp: '2026-08-28T10:01:00.000Z', bpm: 100 }
      ] },
      { heartRateSamples: [
        { timestamp: '2026-08-29T10:00:00.000Z', bpm: 180 },
        { timestamp: '2026-08-29T10:01:00.000Z', bpm: 180 }
      ] }
    ], 200);

    expect(result.coverageSeconds).toBe(120);
    expect(result.zones.find((zone) => zone.zoneName.includes('Z1'))?.minutes).toBe(1);
    expect(result.zones.find((zone) => zone.zoneName.includes('Z5'))?.minutes).toBe(1);
  });

  test('mantém health_only na saúde sem colocá-la no ranking', () => {
    const state = processUserPerformance([{
      id: 'apple_health_blocked',
      userId: 'user1',
      timestamp: Date.parse('2026-08-28T10:00:00.000Z'),
      durationMinutes: 30,
      avgHeartRate: 150,
      validationStatus: 'health_only',
      heartRateSamples: [
        { timestamp: '2026-08-28T10:00:00.000Z', bpm: 145 },
        { timestamp: '2026-08-28T10:01:00.000Z', bpm: 150 },
        { timestamp: '2026-08-28T10:02:00.000Z', bpm: 155 }
      ]
    }], { uid: 'user1', maxHeartRate: 200 }, 'all');

    expect(state.timeframeWorkouts).toHaveLength(0);
    expect(state.healthTimeframeWorkouts).toHaveLength(1);
    expect(state.heartRateCoverageMinutes).toBe(2);
  });

  test('descreve comparação de sessões semelhantes e tendência de passos com evidência', () => {
    const summary = {
      windowDays: 30,
      latest: {},
      trends: {
        steps_daily: [point(1, 5000), point(5, 5100), point(10, 5200), point(15, 7000), point(20, 7200), point(25, 7300)]
      }
    };
    const workouts = [1, 2, 3, 4].map((day, index) => ({
      timestamp: Date.parse(`2026-08-${String(day).padStart(2, '0')}T10:00:00.000Z`),
      durationMinutes: 30,
      distanceKm: 5,
      workoutType: 'Corrida',
      avgHeartRate: [150, 148, 138, 136][index]
    }));

    const insights = buildHealthInsights({ summary, workouts, now: Date.parse('2026-08-26T12:00:00Z') });
    expect(insights.some((insight) => insight.id === 'heart-rate-response-improved')).toBe(true);
    expect(insights.some((insight) => insight.id === 'steps-improved')).toBe(true);
    expect(insights.find((insight) => insight.id === 'heart-rate-response-improved')?.message).toContain('mesmo ritmo');
  });
});
