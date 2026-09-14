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

test('pódio preserva os três assets oficiais atuais de coroa', () => {
  const podium = read('src/components/ranking/PodiumTopThree.tsx');
  expect(podium).toContain("'/ranking-frame-gold-reference.png'");
  expect(podium).toContain("'/ranking-frame-silver-reference.png'");
  // Bronze foi substituído pelo asset completo, com transparência/margem
  // validado por rankingAssetIntegrity.test.ts e championshipsRankingRound.test.ts.
  expect(podium).toContain("'/assets/ranking/crown-bronze-complete-v1.png'");
  expect(podium).not.toContain("'/ranking-frame-bronze-reference.png'");
});

test('Top 2 e Top 3 do pódio vencem os overrides e usam a geometria do Power Lift', () => {
  const podium = read('src/components/ranking/PodiumTopThree.tsx');
  const podiumCss = read('src/components/ranking/PodiumTopThree.css');
  const communityCss = read('src/pages/championships/CommunityRanking.css');
  const powerLiftCss = read('src/pages/PowerLiftNew.css');

  expect(podium).toContain("import './PodiumTopThree.css'");
  expect(podiumCss).toContain('.academy-podium-athlete--2 .academy-podium-avatar');
  expect(podiumCss).toContain('.academy-podium-athlete--3 .academy-podium-avatar');
  expect(podiumCss).toContain('width: 76px !important');
  expect(podiumCss).toContain('height: 76px !important');
  expect(podiumCss).toContain('width: 62px !important');
  expect(podiumCss).toContain('height: 62px !important');
  expect(podiumCss).toContain('width: 68px !important');
  expect(podiumCss).toContain('height: 68px !important');
  expect(podiumCss).toContain('width: 55px !important');
  expect(podiumCss).toContain('height: 55px !important');
  expect(podiumCss).toContain('overflow: visible');

  // Esta regra global já existia no layout avançado do campeonato e foi a
  // causa da regressão: sem o override rank-specific acima, ela vence no CSS.
  expect(communityCss).toContain('.academy-podium-avatar{width:94px!important;height:94px!important}');
  expect(communityCss).toContain('.academy-podium-avatar{width:78px!important;height:78px!important}');

  expect(powerLiftCss).toContain('.power-podium-avatar{position:relative;display:grid;width:76px;height:76px;place-items:center}');
  expect(powerLiftCss).toContain('width:62px;height:62px');
  expect(powerLiftCss).toContain('.power-podium-avatar{width:68px;height:68px}');
  expect(powerLiftCss).toContain('width:55px;height:55px');
});
