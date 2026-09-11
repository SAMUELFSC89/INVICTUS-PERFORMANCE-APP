import { buildHeartRateAudit } from '../core/health/heartRateAudit';

const start = '2026-09-05T10:00:00.000Z';
const end = '2026-09-05T10:10:00.000Z';
const at = (seconds: number, bpm = 120) => ({ timestamp: new Date(Date.parse(start) + seconds * 1000).toISOString(), bpm });

describe('buildHeartRateAudit', () => {
  it('never treats one isolated reading as monitored coverage', () => {
    const result = buildHeartRateAudit({ samples: [at(120)], startedAt: start, endedAt: end });
    expect(result).toMatchObject({ validSampleCount: 1, coverageSeconds: 0, coveragePercent: 0, quality: 'insufficient' });
  });

  it('classifies a dense series that covers the full session as excellent', () => {
    const samples = Array.from({ length: 21 }, (_, index) => at(index * 30, 110 + index));
    const result = buildHeartRateAudit({ samples, startedAt: start, endedAt: end });
    expect(result.validSampleCount).toBe(21);
    expect(result.coverageSeconds).toBe(600);
    expect(result.coveragePercent).toBe(100);
    expect(result.largestGapSeconds).toBeLessThanOrEqual(30);
    expect(result.quality).toBe('excellent');
    expect(result.fiveMinuteBuckets).toHaveLength(2);
    expect(result.fiveMinuteBuckets?.[0]).toMatchObject({ sampleCount: 10, coveragePercent: 90 });
    expect(result.fiveMinuteBuckets?.[1].sampleCount).toBe(11);
  });

  it('keeps good quality distinct from excellent', () => {
    const samples = Array.from({ length: 11 }, (_, index) => at(index * 60));
    const result = buildHeartRateAudit({ samples, startedAt: start, endedAt: end });
    expect(result.coveragePercent).toBe(100);
    expect(result.quality).toBe('good');
  });

  it('does not fill a long sensor gap and reports partial coverage', () => {
    const samples = [at(0), at(30), at(60), at(90), at(120), at(480), at(510), at(540), at(570), at(600)];
    const result = buildHeartRateAudit({ samples, startedAt: start, endedAt: end });
    expect(result.coverageSeconds).toBe(240);
    expect(result.coveragePercent).toBe(40);
    expect(result.largestGapSeconds).toBe(360);
    expect(result.quality).toBe('partial');
  });

  it('reports received versus valid samples and normalized discard reasons', () => {
    const result = buildHeartRateAudit({
      samples: [at(0), at(30), at(60), at(90), at(120)],
      startedAt: start,
      endedAt: end,
      receivedSampleCount: 8,
      discardedReasons: { bpm_invalido: 2, fora_da_janela: 1, ignored_zero: 0 },
      selectedSourceKey: 'apple_health:watch-1',
      sourceCandidateCount: 2,
    });
    expect(result).toMatchObject({
      receivedSampleCount: 8, validSampleCount: 5, discardedSampleCount: 3,
      discardedReasons: { bpm_invalido: 2, fora_da_janela: 1 },
      selectedSourceKey: 'apple_health:watch-1', sourceCandidateCount: 2,
    });
    expect(result.coveragePercent).toBe(20);
    expect(result.quality).toBe('partial');
  });
});
