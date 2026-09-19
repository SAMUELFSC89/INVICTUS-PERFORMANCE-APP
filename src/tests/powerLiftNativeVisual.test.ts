import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('Power Lift native visual integration', () => {
  test('loads the scoped Power Lift visual override', () => {
    const html = read('index.html');
    expect(html).toContain('/powerlift-native-ui.css?v=20260919');
  });

  test('uses the existing official modality artwork as a full-card background layer', () => {
    const css = read('public/powerlift-native-ui.css');
    expect(css).toContain('.pl-season .pl-modality-image');
    expect(css).toContain('position: absolute;');
    expect(css).toContain('inset: 0;');
    expect(css).toContain('filter: saturate(.95) contrast(1.08) brightness(.82);');
    expect(css).toContain('.pl-season .pl-modality::before');
  });

  test('future tier badges stay grey and locked until their done state is reached', () => {
    const css = read('public/powerlift-native-ui.css');
    expect(css).toContain('.pl-season .pl-tier-step:not(.done)');
    expect(css).toContain('filter: grayscale(1) brightness(.48) contrast(.86);');
    expect(css).toContain('.pl-season .pl-tier-step:not(.done)::before');
    expect(css).toContain('.pl-season .pl-tier-step:not(.done)::after');
    expect(css).toContain('.pl-season .pl-tier-step.done .pl-tier-badge-image');
    expect(css).toContain('filter: none;');
  });

  test('keeps the Power Lift treatment scoped so other app screens are untouched', () => {
    const css = read('public/powerlift-native-ui.css');
    const selectors = css.match(/(^|\n)([^@\n][^{]+)\{/g) || [];
    expect(selectors.length).toBeGreaterThan(0);
    expect(selectors.every((selector) => selector.includes('.pl-season') || selector.includes('from') || selector.includes('to'))).toBe(true);
  });
});
