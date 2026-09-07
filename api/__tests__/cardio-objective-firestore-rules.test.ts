import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('cardio objective documents and descendants are server-only', () => {
  const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
  expect(rules).toMatch(/match \/cardio_objectives\/\{userId\}\s*\{\s*allow read, write: if false;/);
  expect(rules).toMatch(/match \/cardio_objectives\/\{userId\}\/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
});
