import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('fidelidade das referências aprovadas do compartilhamento', () => {
  const card = read('src/components/RunShareCard.tsx');
  const css = read('src/components/RunShareCard.css');

  it('reaproveita o capacete oficial e monta o wordmark completo', () => {
    expect(card).toContain('src="/capacete.webp"');
    expect(card).toContain('<strong>INVICTUS</strong>');
    expect(card).toContain('<span>PERFORMANCE</span>');
  });

  it('preserva o trio aprovado distância, pace e tempo em cards independentes', () => {
    expect(css).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(css).toContain('.share-card-metric-icon');
    expect(css).toContain('.share-card-metric--0');
    expect(css).toContain('.share-card-metric--1');
    expect(css).toContain('.share-card-metric--2');
  });

  it('mantém as cinco frases das referências e oculta a frase intermediária nas versões com foto', () => {
    expect(card).toContain("id: 'journey'");
    expect(card).toContain('O\\nMOVIMENTO\\nTE LEVA\\nMAIS LONGE');
    expect(css).toContain('.share-card-art--photo-route .share-card-phrase--journey');
  });

  it('diferencia mapa noturno e mapa diurno e mantém layout por template', () => {
    expect(card).toContain('`share-card-art--${mapVariant}`');
    expect(card).toContain('invictus:share-card-layout:v2:');
    expect(css).toContain('.share-card-art--map.share-card-art--satellite');
    expect(css).toContain('.share-card-art--map.share-card-art--outdoors');
  });
});
