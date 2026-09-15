import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Contrato — leaderboard pago exige autenticação', () => {
  test('handler verifica auth antes de consultar o placar', () => {
    const handler = readFileSync(resolve(process.cwd(), 'api/_handlers/championships.ts'), 'utf8');
    const start = handler.indexOf('export async function getChampionshipLeaderboardHandler');
    const end = handler.indexOf('export async function getMyChampionshipActivitiesHandler');
    const block = handler.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(block).toContain('const auth = await verifyAuth(req);');
    expect(block).toContain("if (!auth) return res.status(401).json({ error: 'Nao autenticado.' });");
    expect(block.indexOf('verifyAuth(req)')).toBeLessThan(block.indexOf('getChampionshipLeaderboard('));
  });

  test('cliente envia token ao buscar leaderboard', () => {
    const service = readFileSync(resolve(process.cwd(), 'src/services/championshipService.ts'), 'utf8');
    const start = service.indexOf('async getLeaderboard(championshipId: string)');
    const end = service.indexOf('getHistoryResults()', start);
    const block = service.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(block).toContain('const headers = await authHeaders();');
    expect(block).toContain('/api/championships/leaderboard?championshipId=');
    expect(block).toContain(', { headers });');
  });
});
