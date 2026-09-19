import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('Power Lift native visual integration', () => {
  test('loads the scoped Power Lift visual overrides in the intended order', () => {
    const html = read('index.html');
    expect(html).toContain('/powerlift-native-ui.css?v=20260919');
    expect(html).toContain('/powerlift-category-final.css?v=20260919b');
    expect(html).toContain('/powerlift-layout-hotfix.css?v=20260919c');
    expect(html.indexOf('/powerlift-category-final.css')).toBeGreaterThan(html.indexOf('/powerlift-native-ui.css'));
    expect(html.indexOf('/powerlift-layout-hotfix.css')).toBeGreaterThan(html.indexOf('/powerlift-category-final.css'));
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

  test('category hero is a bordered premium banner and the page background stays integrated', () => {
    const css = read('public/powerlift-category-final.css');
    expect(css).toContain('.pl-season.pl-view-modality .pl-header-art');
    expect(css).toContain('border: 1px solid rgba(231, 189, 104, .78);');
    expect(css).toContain('border-radius: 18px;');
    expect(css).toContain('.pl-season.pl-view-modality');
    expect(css).toContain('background-color: transparent !important;');
    expect(css).toContain('.pl-season.pl-view-modality .pl-hero--modality');
    expect(css).toContain('.pl-season.pl-view-modality .pl-tier-track');
  });

  test('final hotfix removes the second page canvas from every Power Lift view', () => {
    const css = read('public/powerlift-layout-hotfix.css');
    expect(css).toContain('.pl-season.pl-season');
    expect(css).toContain('background: transparent !important;');
    expect(css).toContain('.pl-season .pl-shell');
    expect(css).toContain('box-shadow: none !important;');
    expect(css).toContain('.pl-season.pl-view-modality::before');
    expect(css).toContain('content: none !important;');
  });

  test('final hotfix gives every Power Lift banner the premium outline', () => {
    const css = read('public/powerlift-layout-hotfix.css');
    expect(css).toContain('.pl-season .pl-header-art');
    expect(css).toContain('border: 1px solid rgba(235, 194, 103, .82) !important;');
    expect(css).toContain('border-radius: 16px;');
  });

  test('mobile hotfix reduces hero crop and preserves modality focal points', () => {
    const css = read('public/powerlift-layout-hotfix.css');
    expect(css).toContain('@media (max-width: 680px)');
    expect(css).toContain('min-height: 304px;');
    expect(css).toContain('background-position: center 44% !important;');
    expect(css).toContain('.pl-modality-image[src*="powerlift-supino"]');
    expect(css).toContain('.pl-modality-image[src*="powerlift-agachamento"]');
    expect(css).toContain('.pl-modality-image[src*="powerlift-terra"]');
    expect(css).toContain('transform: none !important;');
  });

  test('final visual layers do not replace the app logo or bottom navigation', () => {
    for (const file of ['public/powerlift-category-final.css', 'public/powerlift-layout-hotfix.css']) {
      const css = read(file);
      expect(css).not.toContain('.pl-season .pl-brand');
      expect(css).not.toContain('.pl-season .pl-bottom-nav');
      expect(css).not.toContain('.pl-season.pl-view-modality .pl-brand');
      expect(css).not.toContain('.pl-season.pl-view-modality .pl-bottom-nav');
    }
  });

  test('keeps the new overrides scoped to Power Lift', () => {
    const nativeCss = read('public/powerlift-native-ui.css');
    const finalCss = read('public/powerlift-category-final.css');
    const hotfixCss = read('public/powerlift-layout-hotfix.css');
    for (const css of [nativeCss, finalCss, hotfixCss]) {
      expect(css).not.toContain('\n.pl-modality {');
      expect(css).not.toContain('\n.pl-modality-image {');
      expect(css).not.toContain('\n.pl-tier-step:not(.done) {');
      expect(css).not.toContain('\n.pl-card {');
    }
  });
});
