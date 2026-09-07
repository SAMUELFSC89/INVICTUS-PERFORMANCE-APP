#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

const root = process.cwd();
const scratch = path.join(root, '.tmp-training-plans-esm-init');
const entry = 'api/_handlers/training-plans.ts';
const compiled = new Set();

const localImportPattern = /(?:\bfrom\s*|\bimport\s*\()\s*['"](\.[^'"]+)['"]/g;
const explicitRuntimeExtension = /\.(?:m?js|cjs|json|node)$/i;

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function sourceForRuntimeSpecifier(importer, specifier) {
  const resolved = path.resolve(path.dirname(path.join(root, importer)), specifier);
  const candidates = specifier.endsWith('.js')
    ? [resolved.slice(0, -3) + '.ts', resolved.slice(0, -3) + '.tsx', resolved]
    : specifier.endsWith('.mjs') || specifier.endsWith('.cjs')
      ? [resolved]
      : [];

  for (const candidate of candidates) {
    if (await exists(candidate)) return path.relative(root, candidate).replaceAll(path.sep, '/');
  }
  return null;
}

async function compileModule(relativeSource) {
  if (compiled.has(relativeSource)) return;
  compiled.add(relativeSource);

  const absoluteSource = path.join(root, relativeSource);
  const source = await fs.readFile(absoluteSource, 'utf8');
  const extension = path.extname(relativeSource).toLowerCase();
  const loader = extension === '.tsx' ? 'tsx' : extension === '.ts' ? 'ts' : 'js';
  const result = await transform(source, {
    loader,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: false,
    sourcefile: relativeSource,
  });

  const outputRelative = relativeSource.replace(/\.(?:tsx?|mjs|cjs|js)$/i, '.js');
  const outputAbsolute = path.join(scratch, outputRelative);
  await fs.mkdir(path.dirname(outputAbsolute), { recursive: true });
  await fs.writeFile(outputAbsolute, result.code, 'utf8');

  const dependencies = [];
  for (const match of result.code.matchAll(localImportPattern)) {
    const specifier = match[1];
    if (!explicitRuntimeExtension.test(specifier)) {
      throw new Error(`Runtime ESM import without explicit extension in ${relativeSource}: ${specifier}`);
    }
    const dependency = await sourceForRuntimeSpecifier(relativeSource, specifier);
    if (dependency) dependencies.push(dependency);
  }

  for (const dependency of dependencies) await compileModule(dependency);
}

try {
  await fs.rm(scratch, { recursive: true, force: true });
  await fs.mkdir(scratch, { recursive: true });
  await fs.writeFile(path.join(scratch, 'package.json'), '{"type":"module"}\n', 'utf8');
  await compileModule(entry);

  process.env.NODE_ENV = 'test';
  const moduleUrl = pathToFileURL(path.join(scratch, 'api/_handlers/training-plans.js')).href;
  const loaded = await import(`${moduleUrl}?startup=${Date.now()}`);
  if (typeof loaded.default !== 'function' || typeof loaded.generatePlan !== 'function') {
    throw new Error('Training plans serverless module loaded but expected handler exports are missing.');
  }

  console.log(`Serverless ESM startup OK: ${compiled.size} local runtime modules transpiled and imported under Node ${process.version}.`);
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
