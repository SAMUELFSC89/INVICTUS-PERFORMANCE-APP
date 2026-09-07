#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { transform } from 'esbuild';

const root = process.cwd();
const entry = 'src/data/exerciseCatalog.ts';
const visited = new Set();
const localImportPattern = /(?:\bfrom\s*|\bimport\s*\()\s*['"](\.[^'"]+)['"]/g;
const explicitRuntimeExtension = /\.(?:m?js|cjs|json|node)$/i;

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function sourceFor(importer, specifier) {
  const resolved = path.resolve(path.dirname(path.join(root, importer)), specifier);
  const candidates = specifier.endsWith('.js')
    ? [resolved.slice(0, -3) + '.ts', resolved.slice(0, -3) + '.tsx', resolved]
    : [];
  for (const candidate of candidates) {
    if (await exists(candidate)) return path.relative(root, candidate).replaceAll(path.sep, '/');
  }
  return null;
}

async function inspect(relativeSource) {
  if (visited.has(relativeSource)) return;
  visited.add(relativeSource);
  const source = await fs.readFile(path.join(root, relativeSource), 'utf8');
  const loader = relativeSource.endsWith('.tsx') ? 'tsx' : 'ts';
  const { code } = await transform(source, { loader, format: 'esm', platform: 'node', target: 'node22' });
  const dependencies = [];
  for (const match of code.matchAll(localImportPattern)) {
    const specifier = match[1];
    if (!explicitRuntimeExtension.test(specifier)) {
      throw new Error(`Catalog runtime ESM import without explicit extension in ${relativeSource}: ${specifier}`);
    }
    const dependency = await sourceFor(relativeSource, specifier);
    if (dependency) dependencies.push(dependency);
  }
  for (const dependency of dependencies) await inspect(dependency);
}

await inspect(entry);
console.log(`Catalog ESM graph OK: ${visited.size} runtime modules checked under Node ${process.version}.`);
