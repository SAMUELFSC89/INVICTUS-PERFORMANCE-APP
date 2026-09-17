import fs from 'node:fs';
import path from 'node:path';
import Jimp from 'jimp';

describe('assets restaurados do pódio e Powerlift', () => {
  it('usa a nova arte aprovada do Power Lift sem cortar o enquadramento', async () => {
    const banner = await Jimp.read(path.join(process.cwd(), 'public/assets/challenges/powerlift-banner-v2.jpg'));
    expect(banner.bitmap.width).toBe(1200);
    expect(banner.bitmap.height).toBe(900);
    const css = fs.readFileSync(path.join(process.cwd(), 'public/challenges-powerlift-banner.css'), 'utf8');
    expect(css).toContain('/assets/challenges/powerlift-banner-v2.jpg');
    expect(css).toContain('background-size: cover, cover, contain;');
  });

  it('carrega a temporada aprovada e preserva o card de musculação existente', async () => {
    const season = await Jimp.read(path.join(process.cwd(), 'public/assets/home/home-season-strength-cardio-v2.jpg'));
    expect(season.bitmap.width).toBe(1200);
    expect(season.bitmap.height).toBe(600);
    const homeCss = fs.readFileSync(path.join(process.cwd(), 'src/pages/Home.css'), 'utf8');
    expect(homeCss).toContain('/assets/home/home-season-strength-cardio-v2.jpg');
    expect(homeCss).not.toContain('/assets/home/home-season-strength-cardio-v1.webp');
    expect(homeCss).toContain('/assets/home/home-season-dumbbells-v1.webp');
  });

  it('entrega a base aprovada do líder em PNG com transparência real', async () => {
    const base = await Jimp.read(path.join(process.cwd(), 'public/assets/ranking/podium-top1-glow-v2.png'));
    expect(base.bitmap.width).toBe(1254);
    expect(base.bitmap.height).toBe(1254);
    for (const [x, y] of [[0, 0], [1253, 0], [0, 1253], [1253, 1253]]) {
      const { a } = Jimp.intToRGBA(base.getPixelColor(x, y));
      expect(a).toBe(0);
    }
    const center = Jimp.intToRGBA(base.getPixelColor(627, 627));
    expect(center.a).toBeGreaterThan(200);
  });

  it('mantém a coroa de bronze completa com transparência real e margem sem corte', async () => {
    const crown = await Jimp.read(path.join(process.cwd(), 'public/assets/ranking/crown-bronze-complete-v1.png'));
    const { width, height, data } = crown.bitmap;
    expect(width).toBe(512);
    expect(height).toBe(512);
    const alpha = (x: number, y: number) => data[(y * width + x) * 4 + 3];
    // Exterior and avatar opening must be transparent, not a painted checkerboard.
    for (let x = 0; x < width; x++) {
      expect(alpha(x, 0)).toBe(0);
      expect(alpha(x, height - 1)).toBe(0);
    }
    for (let y = 0; y < height; y++) {
      expect(alpha(0, y)).toBe(0);
      expect(alpha(width - 1, y)).toBe(0);
    }
    expect(alpha(256, 300)).toBe(0);
    // The reconstructed lower shield is present and ends before the canvas edge.
    expect(alpha(256, 470)).toBe(255);
    expect(alpha(256, 505)).toBe(0);
  });

  it.each([
    'assets/ranking/podium-top1.webp',
    'assets/ranking/podium-top2.webp',
    'assets/ranking/podium-top3.webp',
    'assets/challenges/powerlift-banner-v1.webp',
  ])('%s preserva o conteúdo binário completo', (asset) => {
    const bytes = fs.readFileSync(path.join(process.cwd(), 'public', asset));
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
    // A assinatura sozinha não detectava os banners truncados de 7,5 KB.
    expect(bytes.readUInt32LE(4) + 8).toBe(bytes.length);
    let offset = 12;
    let imagePayload = false;
    while (offset < bytes.length) {
      expect(offset + 8).toBeLessThanOrEqual(bytes.length);
      const chunk = bytes.toString('ascii', offset, offset + 4);
      const length = bytes.readUInt32LE(offset + 4);
      offset += 8 + length + (length % 2);
      expect(offset).toBeLessThanOrEqual(bytes.length);
      if (chunk === 'VP8 ' || chunk === 'VP8L') imagePayload = true;
    }
    expect(offset).toBe(bytes.length);
    expect(imagePayload).toBe(true);
  });
});
