import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('public share revocation cache policy', () => {
  test.each([
    'api/_handlers/share.ts',
    'api/_handlers/share-image.ts',
  ])('%s is never cacheable after token revocation', (relativePath) => {
    const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');

    expect(source).toContain("res.setHeader('Cache-Control', 'no-store')");
    expect(source).not.toMatch(/Cache-Control[^\n]*(?:public|max-age|s-maxage)/i);
  });
});
