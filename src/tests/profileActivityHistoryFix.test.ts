import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('profile photo retry and activity navigation', () => {
  test('profile accepts portable image formats and provides a safe compression fallback', () => {
    const profile = read('src/pages/ProfileNew.tsx');
    expect(profile).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(profile).not.toContain('image/heic');
    expect(profile).toContain('compressed = file');
    expect(read('src/services/userService.ts')).toContain('}, 120000)');
  });

  test('recent activity cards open the matching history detail', () => {
    const profile = read('src/pages/ProfileNew.tsx');
    const page = read('src/components/ActivityHistoryPageNew.tsx');
    const history = read('src/components/ActivityHistorySectionV3.tsx');
    expect(profile).toContain('view=history&activity=');
    expect(profile).toContain('className="np-recent-card"');
    expect(page).toContain('initialActivityId={initialActivityId}');
    expect(history).toContain('setDetail(match)');
  });
});

describe('activity history source isolation', () => {
  test('does not read protected Power Lift records directly', () => {
    const history = read('src/components/ActivityHistorySectionV3.tsx');
    expect(history).not.toContain("collection(db, 'power_records')");
    expect(history).toContain('/api/powerlift?action=me');
  });

  test('keeps available activities when one source fails', () => {
    const history = read('src/components/ActivityHistorySectionV3.tsx');
    expect(history).toContain('Promise.allSettled');
    expect(history).toContain('HISTÓRICO PARCIAL');
  });

  test('detail retains scoring and sharing information', () => {
    const detail = read('src/components/ActivityHistorySection.tsx');
    expect(detail).toContain('Você ganhou +${item.rankingPointsEarned} pontos de ranking!');
    expect(detail).toContain('<Share2 size={15} /> Compartilhar');
  });
});
