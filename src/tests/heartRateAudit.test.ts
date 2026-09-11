import { buildHeartRateAudit } from '../core/health/heartRateAudit';

const start = '2026-09-05T10:00:00.000Z';
const end = '2026-09-05T10:10:00.000Z';
const at = (seconds: number, bpm = 120) => ({ timestamp: new Date(Date.parse(start) + seconds * 1000).toISOString(), bpm });

describe('buildHeartRateAudit', () => {
  it('never treats one isolated reading as monitored coverage', () => {
    const result = buildHeartRateAudit({ samples: [at(120)], startedAt: start, endedAt: end });
    expect(result).toMatchObject({ validSampleCount: 1, coverageSeconds: 0, coveragePercent: 0, quality: 'insufficient' });
  });

  it('classifies a dense series that covers the full session as good', () => {
    const samples = Array.from({ length: 21 }, (_, index) => at(index * 30, 110 + index));
    const result = buildHeartRateAudit({ samples, startedAt: start, endedAt: end });
    expect(result.validSampleCount).toBe(21);
    expect(result.coverageSeconds).toBe(600);
    expect(result.coveragePercent).toBe(100);
    expect(result.largestGapSeconds).toBeLessThanOrEqual(60);
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

  it('reports received versus valid samples without allowing a fake coverage declaration', () => {
    const result = buildHeartRateAudit({
      samples: [at(0), at(30), at(60), at(90), at(120)],
      startedAt: start,
      endedAt: end,
      receivedSampleCount: 8,
    });
    expect(result).toMatchObject({ receivedSampleCount: 8, validSampleCount: 5, discardedSampleCount: 3 });
    expect(result.coveragePercent).toBe(20);
    expect(result.quality).toBe('partial');
  });
});
