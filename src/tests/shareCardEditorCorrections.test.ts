import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('correções do editor de compartilhamento', () => {
  const card = read('src/components/RunShareCard.tsx');
  const enhancer = read('src/features/shareCardRoundEnhancer.ts');
  const enhancerCss = read('src/features/shareCardRoundEnhancer.css');

  it('usa controles contextuais em vez do painel completo para cada elemento', () => {
    expect(card).toContain('share-context-controls');
    expect(card).toContain('Opacidade do mapa');
    expect(card).toContain('Tamanho do traçado');
    expect(card).toContain('Ângulo do traçado');
    expect(card).toContain('Tamanho das informações');
    expect(card).toContain('Tamanho da frase');
  });

  it('remove o mapa pelo X para entrar em foto + rota sem oferecer esse modo no seletor', () => {
    expect(card).toContain('const removeMapFromPhoto');
    expect(card).toContain("setCompositionMode('photo-route')");
    expect(card).toContain('aria-label="Remover mapa e manter foto com rota"');
    expect(card).not.toContain('<span>Foto + rota</span>');
    expect(card).toContain('share-customizer-modes--two');
  });

  it('mantém o capacete fora das informações da atividade', () => {
    expect(card).toContain('<div className="share-card-brand">');
    expect(card).not.toContain('<img src="/capacete.webp"');
    expect(enhancerCss).toContain('.share-card-round-v3 .share-card-brand img');
    expect(enhancerCss).toContain('display: none !important');
  });

  it('remove a vinheta escura das bordas', () => {
    expect(enhancerCss).toContain('.share-card-round-v3 .share-card-vignette');
    expect(enhancerCss).toContain('background: transparent !important');
  });

  it('exporta PNG em alta definição e mantém o caminho nativo sem JPEG', () => {
    expect(enhancer).toContain('const SOCIAL_EXPORT_WIDTH = 2160');
    expect(enhancer).toContain('const SOCIAL_EXPORT_HEIGHT = 3840');
    expect(enhancer).toContain('toPng(card');
    expect(enhancer).toContain("setFeedback('Imagem salva em alta definição PNG.')");
  });

  it('projeta os marcadores pela mesma geometria do mapa e considera o crop do object-fit cover', () => {
    expect(enhancer).toContain('decimatePoints(trajectory, 140)');
    expect(enhancer).toContain('function positionMarkerForCover');
    expect(enhancer).toContain('const coverScale = Math.max(layerWidth / projection.width, layerHeight / projection.height)');
    expect(enhancerCss).toContain('transform: translate(-8px, -32px)');
  });
});
