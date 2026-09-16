import fs from 'node:fs';
import path from 'node:path';

function read(file: string) {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
}

describe('performance AI route guard', () => {
  test('routes performance-ai through the guard before the generic API rewrite', () => {
    const vercel = read('vercel.json');
    const guarded = vercel.indexOf('"source": "/api/performance-ai"');
    const generic = vercel.indexOf('"source": "/api/(.*)"');
    expect(guarded).toBeGreaterThanOrEqual(0);
    expect(generic).toBeGreaterThan(guarded);
    expect(vercel).toContain('"destination": "/api/performance-ai-guarded"');
  });

  test('removes arbitrary client profile fields while preserving only identity conflict detection', () => {
    const source = read('api/performance-ai-guarded.ts');
    expect(source).toContain('const safeIdentity: Record<string, string> = {}');
    expect(source).toContain("if (typeof profile.uid === 'string') safeIdentity.uid");
    expect(source).toContain("if (typeof profile.id === 'string') safeIdentity.id");
    expect(source).toContain('req.body = { ...req.body, userProfile: safeIdentity }');
    expect(source).not.toContain('delete req.body.perfState');
    expect(source).not.toContain('delete req.body.activeWorkoutSession');
  });

  test('stops an unconfigured provider before the canonical handler can consume chat quota', () => {
    const source = read('api/performance-ai-guarded.ts');
    const providerCheck = source.indexOf("!MEMORY_ACTIONS.has(action) && !getAiApiKey()");
    const canonicalCall = source.indexOf('return performanceAiHandler(req, res)');
    expect(providerCheck).toBeGreaterThanOrEqual(0);
    expect(canonicalCall).toBeGreaterThan(providerCheck);
    expect(source).toContain("code: 'AI_NOT_CONFIGURED'");
  });

  test('keeps explicit memory management available without the generative provider', () => {
    const source = read('api/performance-ai-guarded.ts');
    expect(source).toContain("const MEMORY_ACTIONS = new Set(['get-memories', 'add-memory', 'delete-memory'])");
    expect(source).toContain('!MEMORY_ACTIONS.has(action) && !getAiApiKey()');
  });
});
