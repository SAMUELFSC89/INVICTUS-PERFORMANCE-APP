import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

test('rankings antigos não podem ser lidos diretamente pelo cliente', () => {
  const rules = read('firestore.rules');
  expect(rules).toMatch(/match \/aggregated_rankings\/\{rankingId\}\s*\{\s*allow read: if isAdmin\(\);/);
  expect(rules).toMatch(/match \/rankings\/\{rankingId\}\s*\{\s*allow read: if isAdmin\(\);/);
});

test('rota legada não contorna a participação e ranking dedicado usa rota do campeonato', () => {
  const app = read('src/App.tsx');
  expect(app).toContain('<Route path="/rankings" element={<Navigate to="/championships" replace />} />');
  expect(app).toContain('<Route path="/championships/community/ranking" element={<CommunityRanking />} />');
  expect(app).not.toContain("import('./pages/Rankings')");
});

test('pódio preserva os três assets oficiais de coroa do Power Lift', () => {
  const podium = read('src/components/ranking/PodiumTopThree.tsx');
  expect(podium).toContain("'/ranking-frame-gold-reference.png'");
  expect(podium).toContain("'/ranking-frame-silver-reference.png'");
  expect(podium).toContain("'/ranking-frame-bronze-reference.png'");
});

test('Top 3 do pódio usa a mesma geometria visual do bronze no Power Lift', () => {
  const podium = read('src/components/ranking/PodiumTopThree.tsx');
  const podiumCss = read('src/components/ranking/PodiumTopThree.css');
  const powerLiftCss = read('src/pages/PowerLiftNew.css');

  expect(podium).toContain("import './PodiumTopThree.css'");
  expect(podiumCss).toContain('.academy-podium-athlete--3 .academy-podium-avatar');
  expect(podiumCss).toContain('width: 76px');
  expect(podiumCss).toContain('height: 76px');
  expect(podiumCss).toContain('width: 62px');
  expect(podiumCss).toContain('height: 62px');
  expect(podiumCss).toContain('overflow: visible');
  expect(powerLiftCss).toContain('.power-podium-avatar{position:relative;display:grid;width:76px;height:76px;place-items:center}');
  expect(powerLiftCss).toContain('width:62px;height:62px');
});
