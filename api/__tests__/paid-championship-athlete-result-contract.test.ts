import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('paid championship athlete result contract', () => {
  test('authenticated progress exposes only the athlete result from the frozen current edition', () => {
    const handler = read('api/_handlers/championships.ts');
    const types = read('src/types/championships.ts');

    expect(handler).toContain('paidChampionshipSettlementDocumentId(editionId)');
    expect(handler).toContain("String(settlement.status || '') !== 'FINALIZED'");
    expect(handler).toContain("String(settlement.editionId || '') !== String(champ.editionId || '')");
    expect(handler).toContain("String(entry?.userId || '') === userId");
    expect(handler).toContain('winnerAssignments');
    expect(handler).toContain('settlementStatus');
    expect(handler).toContain('finalResult');
    expect(handler).not.toContain('ranking,\n    lastUpdated');

    expect(types).toContain("ChampionshipSettlementStatus = 'NOT_DUE' | 'PENDING_REVIEW' | 'LOCKED' | 'FINALIZED'");
    expect(types).toContain('editionId: string');
    expect(types).toContain('finalResult?: ChampionshipResult | null');
  });

  test('edition preview publishes homologation date before acceptance and renders own final result', () => {
    const preview = read('src/pages/championships/ChampionshipPreview.tsx');

    expect(preview).toContain('HOMOLOGAÇÃO DO RESULTADO');
    expect(preview).toContain('dateLabel(championship?.settlementAt)');
    expect(preview).toContain('championshipService.getUserProgress(championshipId)');
    expect(preview).toContain("progress?.settlementStatus === 'FINALIZED'");
    expect(preview).toContain('RESULTADO HOMOLOGADO');
    expect(preview).toContain('finalResult.finalRank');
    expect(preview).toContain('finalResult.prizeWon');
  });
});
