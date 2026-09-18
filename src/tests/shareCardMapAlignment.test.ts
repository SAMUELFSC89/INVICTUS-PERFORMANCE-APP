import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('alinhamento e estilos do mapa do card', () => {
  const alignment = read('src/features/shareCardMapAlignment.ts');
  const apiNativa = read('src/apiNativa.ts');

  it('não sobrescreve mais o estilo de mapa escolhido no editor (satélite/navegação/roadmap seguem direto pro backend)', () => {
    expect(alignment).not.toContain('installMapStyleRequestOverride');
    expect(alignment).not.toContain('installMapOptionLabels');
    expect(alignment).not.toContain('normalizeMapButtons');
    expect(alignment).not.toContain("textContent = 'Ruas'");
    expect(alignment).not.toContain("textContent = 'Navegação'");
    expect(alignment).not.toContain('selectedMapStyle');

    const card = read('src/components/RunShareCard.tsx');
    expect(card).toContain("type MapVariant = 'satellite' | 'outdoors' | 'roadmap'");
    expect(card).toContain('>Satélite</button>');
    expect(card).toContain('>Navegação</button>');

    const enhancer = read('src/features/shareCardRoundEnhancer.ts');
    expect(enhancer).not.toContain("body.mapType = 'satellite-plain'");
  });

  it('encaixa bandeira e ponto final nos pixels reais do traçado', () => {
    expect(alignment).toContain('function routePixel');
    expect(alignment).toContain('function nearestRoutePixel');
    expect(alignment).toContain("const startMarker = layer.querySelector<HTMLElement>('[data-map-start]')");
    expect(alignment).toContain("const finishMarker = layer.querySelector<HTMLElement>('[data-map-finish]')");
    expect(alignment).toContain('marker.style.left');
    expect(alignment).toContain('marker.style.top');
  });

  it('instala a correção antes do enhancer que prepara a exportação', () => {
    const alignmentImport = apiNativa.indexOf("import './features/shareCardMapAlignment'");
    const enhancerImport = apiNativa.indexOf("import './features/shareCardRoundEnhancer'");
    expect(alignmentImport).toBeGreaterThanOrEqual(0);
    expect(enhancerImport).toBeGreaterThan(alignmentImport);
  });

  it('abre em foto + mapa com estilo roadmap quando já existe foto (decisão do usuário, 18/09/2026)', () => {
    const card = read('src/components/RunShareCard.tsx');
    expect(card).toContain("useState<CompositionMode>(() => existingPhoto ? 'photo-map' : 'map')");
    expect(card).toContain("useState<MapVariant>(() => existingPhoto ? 'roadmap' : 'satellite')");
    // Ao escolher uma foto nova durante a edição, o padrão também é roadmap.
    expect(card).toContain("setCompositionMode('photo-map');\n      setMapVariant('roadmap');");
  });

  it('não trava o usuário no roadmap dentro de foto + mapa -- o seletor de estilo continua disponível (decisão do usuário, 18/09/2026)', () => {
    const card = read('src/components/RunShareCard.tsx');
    // O seletor "Estilo do mapa" só some no modo foto + rota (sem mapa real).
    expect(card).toContain("{compositionMode !== 'photo-route' ? (");
    expect(card).toMatch(/Estilo do mapa[\s\S]{0,400}>Satélite<\/button>[\s\S]{0,200}>Navegação<\/button>/);
  });

  it('esconde nome de rua/bairro no satélite compartilhado (decisão do usuário, 18/09/2026) -- satellite-plain no lugar do satellite-streets rotulado', () => {
    const card = read('src/components/RunShareCard.tsx');
    expect(card).toContain('function mapRequestType(variant: MapVariant): string');
    expect(card).toContain("variant === 'satellite' ? 'satellite-plain' : variant");
    expect(card).toContain('mapType: mapRequestType(mapVariant)');
  });
});
