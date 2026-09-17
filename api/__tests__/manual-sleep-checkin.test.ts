import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('manual sleep check-in', () => {
  test('manual sleep is stored as self-report and never sensor verified', () => {
    const handler = read('api/_handlers/health-summary.ts');
    expect(handler).toContain("metricType: 'sleep_duration_min'");
    expect(handler).toContain("source: 'invictus_manual'");
    expect(handler).toContain("quality: 'manual_entry'");
    expect(handler).toContain("aggregation: 'sleep_session'");
    expect(handler).not.toContain("quality: 'sensor_verified'");
  });

  test('manual sleep validates plausible duration and bounded answers', () => {
    const handler = read('api/_handlers/health-summary.ts');
    expect(handler).toContain('sleepDurationMinutes < 120 || sleepDurationMinutes > 840');
    expect(handler).toContain('boundedInt(raw?.sleepLatencyMinutes, 0, 180)');
    expect(handler).toContain('boundedInt(raw?.awakenings, 0, 20)');
    expect(handler).toContain('boundedInt(raw?.quality, 1, 5)');
    expect(handler).toContain('boundedInt(raw?.restedness, 1, 5)');
  });

  test('sensor sleep wins over self report for the same day', () => {
    const priority = read('api/_lib/health-source-priority.ts');
    expect(priority).toContain('apple_health: 100');
    expect(priority).toContain('health_connect: 90');
    expect(priority).toContain('invictus_manual: 10');
    expect(priority).toContain('SOURCE_PRIORITY[b.source]');
  });

  test('sleep questionnaire is reachable from Health and persists through authenticated API', () => {
    const app = read('src/App.tsx');
    const page = read('src/pages/SleepCheckin.tsx');
    expect(app).toContain('path="/health/sleep-checkin"');
    expect(app).toContain('REGISTRAR SONO');
    expect(page).toContain('/api/health-summary?action=sleep-checkin');
    expect(page).toContain('Authorization: `Bearer ${token}`');
    expect(page).toContain('healthSummaryService.invalidate()');
  });

  test('questionnaire includes the intended sleep self-report questions', () => {
    const page = read('src/pages/SleepCheckin.tsx');
    expect(page).toContain('Que horas você deitou?');
    expect(page).toContain('Que horas você acordou?');
    expect(page).toContain('Quanto tempo levou para adormecer?');
    expect(page).toContain('Quantas vezes você lembra de ter acordado?');
    expect(page).toContain('Como você avalia a qualidade do seu sono?');
    expect(page).toContain('Como você acordou?');
  });
});
