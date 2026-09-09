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
