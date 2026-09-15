import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('alinhamento e estilos do mapa do card', () => {
  const alignment = read('src/features/shareCardMapAlignment.ts');
  const apiNativa = read('src/apiNativa.ts');

  it('remove satélite da experiência e mantém dois mapas não-satélite', () => {
    expect(alignment).toContain("type MapStyle = 'streets' | 'outdoors'");
    expect(alignment).toContain("buttons[0].textContent = 'Ruas'");
    expect(alignment).toContain("buttons[1].textContent = 'Navegação'");
    expect(alignment).toContain("body.mapType = selectedMapStyle");
    expect(alignment).not.toContain("selectedMapStyle: MapStyle = 'satellite'");
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
});
