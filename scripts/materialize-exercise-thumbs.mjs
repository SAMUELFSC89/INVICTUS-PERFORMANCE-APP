import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const assetRoot = path.join(root, 'public', 'assets', 'exercise-library', 'rebuild-2026-09-05');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const sources = walk(assetRoot).filter((file) => file.endsWith('.webp.b64'));
let written = 0;

for (const source of sources) {
  const target = source.slice(0, -4);
  const encoded = fs.readFileSync(source, 'utf8').replace(/\s+/g, '');
  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.length < 4 || decoded.subarray(0, 4).toString('ascii') !== 'RIFF') {
    throw new Error(`Invalid WebP base64 source: ${path.relative(root, source)}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target) || !fs.readFileSync(target).equals(decoded)) {
    fs.writeFileSync(target, decoded);
    written += 1;
  }
}

console.log(`Exercise thumbnails materialized: ${sources.length} source(s), ${written} written.`);
