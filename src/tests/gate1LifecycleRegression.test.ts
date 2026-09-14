import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Gate 1 lifecycle regression contracts', () => {
  test('shared inactive-account helper covers terminal lifecycle flags', () => {
    const source = read('api/_lib/account-state.ts');
    for (const marker of ['isBlocked', 'isBanned', 'isSuspended', 'isDeleted', 'deletedAt', 'accountDeletedAt']) {
      expect(source).toContain(marker);
    }
  });
});
