import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('Power Lift native visual integration', () => {
  test('loads the Power Lift integration layer from the shared internal backdrop', () => {
    const backdrop = read('src/styles/internal-page-backdrop.css');
    expect(backdrop).toContain("@import './powerlift-native-integration.css';");
    expect(backdrop).toContain('.pl-season');
  });

  test('keeps the Power Lift canvas transparent over the native app backdrop', () => {
    const css = read('src/styles/powerlift-native-integration.css');
    expect(css).toContain("body[data-invictus-surface='internal'] .pl-season");
    expect(css).toContain('background-color: transparent !important;');
  });

  test('uses the existing official modality image as a full-card visual instead of a side thumbnail', () => {
    const css = read('src/styles/powerlift-native-integration.css');
    expect(css).toContain('.pl-modality-image');
    expect(css).toContain('position: absolute;');
    expect(css).toContain('width: 100%;');
    expect(css).toContain('height: 100%;');
    expect(css).toContain('object-fit: cover;');
    expect(css).not.toContain('grayscale(');
  });

  test('preserves responsive mobile treatment for the full-bleed modality cards', () => {
    const css = read('src/styles/powerlift-native-integration.css');
    expect(css).toContain('@media (max-width: 720px)');
    expect(css).toContain('@media (max-width: 390px)');
  });
});
