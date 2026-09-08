import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path));

const officialAssets = {
  'public/assets/championships/friends-banner.png': '997e276822b80413317248c03a411bcd602d1139e3c077cc642c66b708335fb6',
  'public/assets/championships/strength-banner.png': '5a838102730dedf3e9449891aed857a7a02ffa04898cf091c02b2b047a497373',
  'public/assets/championships/cardio-banner.png': 'dc02a79bea34a2c4e2e1113bf40a4a6716f42193bb076cabcbfe68ee83f1386b',
  'public/assets/coins/invictus-coins-stack.png': 'b9d8aab7759d9dfa98f96eaca8abd12b040801dcd798eacf076a1f240cc87d0a',
};

test('preserva byte a byte os quatro assets oficiais recebidos', () => {
  for (const [path, expectedHash] of Object.entries(officialAssets)) {
    expect(createHash('sha256').update(read(path)).digest('hex')).toBe(expectedHash);
  }
});

test('mantém os três CTAs ligados aos fluxos existentes', () => {
  const hub = read('src/pages/championships/ChampionshipsHub.tsx').toString('utf8');
  expect(hub).toContain("navigate('/championships/community')");
  expect(hub).toContain("navigate('/championships/preview/musculacao')");
  expect(hub).toContain("navigate('/championships/preview/cardio')");
});

test('usa imagens oficiais com composição à direita e Coins sem ícone genérico', () => {
  const cards = read('src/pages/championships/ChampionshipCards.tsx').toString('utf8');
  expect(cards).toContain("'/assets/championships/friends-banner.png'");
  expect(cards).toContain("'/assets/championships/strength-banner.png'");
  expect(cards).toContain("'/assets/championships/cardio-banner.png'");
  expect(cards).toContain("'/assets/coins/invictus-coins-stack.png'");
  expect(cards.match(/imagePosition: 'center right'/g)).toHaveLength(2);
});
