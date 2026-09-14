import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Contrato — IGA permanece a única persistência competitiva', () => {
  test('módulo órfão que incrementava score/monthlyScore diretamente não existe nem é exportado', () => {
    const persistencePath = resolve(process.cwd(), 'api/_lib/score-engine/persistence.ts');
    const barrel = readFileSync(resolve(process.cwd(), 'api/_lib/score-engine.ts'), 'utf8');

    expect(existsSync(persistencePath)).toBe(false);
    expect(barrel).not.toContain('ScorePersistence');
    expect(barrel).not.toContain("./score-engine/persistence.js");
  });

  test('igaService continua responsável pelos três campos canônicos do ranking', () => {
    const igaService = readFileSync(resolve(process.cwd(), 'api/_lib/igaService.ts'), 'utf8');

    expect(igaService).toContain('weeklyScore: weekly.igaRanking');
    expect(igaService).toContain('monthlyScore: monthly.average');
    expect(igaService).toContain('score: season.average');
  });
});
