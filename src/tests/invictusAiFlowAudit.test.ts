import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Invictus AI conversation flow audit', () => {
  test('current question is not duplicated inside recent history', () => {
    const page = read('src/pages/InvictusAI.tsx');
    expect(page).toContain('history: messages');
    expect(page).not.toContain('history: nextMessages');
  });

  test('same-frame double submit is blocked synchronously', () => {
    const page = read('src/pages/InvictusAI.tsx');
    expect(page).toContain('const inFlightRef = useRef(false)');
    expect(page).toContain('if (!clean || inFlightRef.current) return');
    expect(page).toContain('inFlightRef.current = true');
    expect(page).toContain('inFlightRef.current = false');
  });

  test('AI request is bounded and refuses a response after account ownership changes', () => {
    const service = read('src/services/invictusAiService.ts');
    expect(service).toContain('AI_REQUEST_TIMEOUT_MS = 45_000');
    expect(service).toContain('signal: controller.signal');
    expect(service).toContain('auth.currentUser?.uid !== expectedUid');
    expect(service).toContain("error?.name === 'AbortError'");
  });
});
