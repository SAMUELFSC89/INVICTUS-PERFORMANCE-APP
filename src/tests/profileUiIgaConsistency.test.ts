import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('profile visual consistency and IGA reconciliation', () => {
  test('level badge has no clipped Invictus label and Coins uses the standard stat style', () => {
    const profile = read('src/pages/ProfileNew.tsx');
    const css = read('src/pages/ProfileNew.css');

    expect(profile).toContain('<aside><InvictusLogo size={36} /><small>NÍVEL</small><b>{levelProgress.currentLevel}</b></aside>');
    expect(profile).not.toContain('<span>INVICTUS</span></aside>');
    expect(profile).not.toContain('className="np-coins"');
    expect(css).not.toContain('.np-stats .np-coins');
    expect(profile).toContain('Number(user?.score) > 0');
  });

  test('profile refresh recalculates competitive scores from authoritative activity history', () => {
    const missions = read('api/_handlers/missions.ts');
    const context = read('src/UserContext.tsx');

    expect(missions).toContain("import { recalculateAllUserScores } from '../_lib/igaService.js';");
    expect(missions).toContain('const competitionScores = await recalculateAllUserScores(auth.uid);');
    expect(missions).toContain('score: competitionScores.season.average');
    expect(context).toContain("Partial<Pick<UserProfile, 'weeklyScore' | 'monthlyScore' | 'score'>>");
    expect(context).toContain('Number.isFinite(Number(payload.stats.weeklyScore))');
    expect(context).toContain('Number.isFinite(Number(payload.stats.monthlyScore))');
    expect(context).toContain('Number.isFinite(Number(payload.stats.score))');
  });
});
