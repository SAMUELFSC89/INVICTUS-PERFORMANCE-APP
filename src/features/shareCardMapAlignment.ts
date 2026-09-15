type MapStyle = 'streets' | 'outdoors';

type PixelPoint = { x: number; y: number };

let selectedMapStyle: MapStyle = 'streets';
let snapScheduled = false;
const snappedSourceByLayer = new WeakMap<HTMLElement, string>();

function isActivityMapRequest(input: RequestInfo | URL): boolean {
  try {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    return new URL(url, window.location.href).pathname.endsWith('/api/activity-map');
  } catch {
    return false;
  }
}

/**
 * shareCardRoundEnhancer ainda normaliza o request para satellite-plain por
 * compatibilidade. Este wrapper fica abaixo dele na cadeia de fetch e troca o
 * tipo pelo estilo realmente selecionado no editor. Assim nenhum card novo
 * usa satélite.
 */
function installMapStyleRequestOverride() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (isActivityMapRequest(input) && init?.method?.toUpperCase() === 'POST' && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        body.mapType = selectedMapStyle;
        return originalFetch(input, { ...init, body: JSON.stringify(body) });
      } catch {
        // Se o payload não puder ser lido, não derruba a geração do mapa.
      }
    }
    return originalFetch(input, init);
  };
}

function installMapOptionLabels() {
  document.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-invictus-map-style]');
    if (!button) return;
    selectedMapStyle = button.dataset.invictusMapStyle === 'navigation' ? 'outdoors' : 'streets';
  }, true);
}

function normalizeMapButtons() {
  const row = document.querySelector<HTMLElement>('.share-customizer-row');
  if (!row || !/Estilo do mapa/i.test(row.textContent || '')) return;
  const buttons = Array.from(row.querySelectorAll<HTMLButtonElement>('button'));
  if (buttons.length < 2) return;

  // Mantemos os dois estados React existentes (satellite/outdoors), mas o
  // request real é reescrito para streets/outdoors. Isso evita uma alteração
  // grande no componente e remove satélite da experiência do usuário.
  if (buttons[0].textContent !== 'Ruas') buttons[0].textContent = 'Ruas';
  if (buttons[0].dataset.invictusMapStyle !== 'streets') buttons[0].dataset.invictusMapStyle = 'streets';
  if (buttons[1].textContent !== 'Navegação') buttons[1].textContent = 'Navegação';
  if (buttons[1].dataset.invictusMapStyle !== 'navigation') buttons[1].dataset.invictusMapStyle = 'navigation';
}

function installNavigationMapVisual() {
  if (document.getElementById('invictus-share-navigation-map-style')) return;
  const style = document.createElement('style');
  style.id = 'invictus-share-navigation-map-style';
  style.textContent = `
    /* Visual urbano claro/simplificado, inspirado em apps de mobilidade. */
    .share-card-art--outdoors .share-card-map-layer img {
      filter: grayscale(.18) saturate(.62) brightness(1.10) contrast(.92) !important;
    }
    .share-card-art--outdoors .share-card-map-layer--inset {
      filter: grayscale(.10) saturate(.68) brightness(.94) contrast(.96) !important;
    }
  `;
  document.head.appendChild(style);
}

function routePixel(data: Uint8ClampedArray, width: number, x: number, y: number): boolean {
  const index = (y * width + x) * 4;
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  const a = data[index + 3];

  // A rota do backend é #ffad12 (255,173,18). Mantemos uma tolerância curta
  // para antialiasing/recompressão, evitando confundir a rota com vias amarelas
  // ou outros elementos do próprio mapa.
  return a > 190 && r > 225 && g >= 135 && g <= 200 && b < 65 && r - g >= 55;
}

function nearestRoutePixel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  approximate: PixelPoint,
  radius: number,
): PixelPoint | null {
  const minX = Math.max(0, Math.floor(approximate.x - radius));
  const maxX = Math.min(width - 1, Math.ceil(approximate.x + radius));
  const minY = Math.max(0, Math.floor(approximate.y - radius));
  const maxY = Math.min(height - 1, Math.ceil(approximate.y + radius));

  let best: PixelPoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (!routePixel(data, width, x, y)) continue;
      const distance = (x - approximate.x) ** 2 + (y - approximate.y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x, y };
      }
    }
  }
  return best;
}

async function snapLayerMarkers(layer: HTMLElement): Promise<void> {
  const image = layer.querySelector<HTMLImageElement>('img');
  const startMarker = layer.querySelector<HTMLElement>('[data-map-start]');
  const finishMarker = layer.querySelector<HTMLElement>('[data-map-finish]');
  if (!image || !startMarker || !finishMarker || !image.src) return;

  const sourceKey = image.currentSrc || image.src;
  if (snappedSourceByLayer.get(layer) === sourceKey) return;

  try {
    if (!image.complete) {
      await new Promise<void>((resolve) => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => resolve(), { once: true });
      });
    }
    try { await image.decode?.(); } catch { /* best effort */ }

    const naturalWidth = image.naturalWidth;
    const naturalHeight = image.naturalHeight;
    const layerWidth = layer.clientWidth;
    const layerHeight = layer.clientHeight;
    if (!naturalWidth || !naturalHeight || !layerWidth || !layerHeight) return;

    const canvas = document.createElement('canvas');
    canvas.width = naturalWidth;
    canvas.height = naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.drawImage(image, 0, 0, naturalWidth, naturalHeight);
    const pixels = context.getImageData(0, 0, naturalWidth, naturalHeight).data;

    // A imagem usa object-fit: cover. Convertemos a posição aproximada que o
    // projetor atual calculou para o espaço real do bitmap, encaixamos no
    // traçado laranja e voltamos para o espaço visual da layer.
    const coverScale = Math.max(layerWidth / naturalWidth, layerHeight / naturalHeight);
    const renderedWidth = naturalWidth * coverScale;
    const renderedHeight = naturalHeight * coverScale;
    const offsetX = (layerWidth - renderedWidth) / 2;
    const offsetY = (layerHeight - renderedHeight) / 2;

    const snap = (marker: HTMLElement) => {
      const left = Number.parseFloat(marker.style.left || '');
      const top = Number.parseFloat(marker.style.top || '');
      if (!Number.isFinite(left) || !Number.isFinite(top)) return;

      const approximate = {
        x: (left - offsetX) / coverScale,
        y: (top - offsetY) / coverScale,
      };
      const radius = Math.max(22, Math.round(90 / coverScale));
      const exact = nearestRoutePixel(pixels, naturalWidth, naturalHeight, approximate, radius);
      if (!exact) return;

      marker.style.left = `${offsetX + exact.x * coverScale}px`;
      marker.style.top = `${offsetY + exact.y * coverScale}px`;
    };

    snap(startMarker);
    snap(finishMarker);
    snappedSourceByLayer.set(layer, sourceKey);
  } catch (error) {
    console.warn('[shareCardMapAlignment] Não foi possível encaixar marcadores na rota:', error);
  }
}

function scheduleSnap() {
  if (snapScheduled) return;
  snapScheduled = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      snapScheduled = false;
      document.querySelectorAll<HTMLElement>('.share-card-map-layer').forEach((layer) => {
        void snapLayerMarkers(layer);
      });
    });
  });
}

installMapStyleRequestOverride();
installMapOptionLabels();
installNavigationMapVisual();

const observer = new MutationObserver(() => {
  normalizeMapButtons();
  scheduleSnap();
});
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['src', 'class'],
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    normalizeMapButtons();
    scheduleSnap();
  }, { once: true });
} else {
  normalizeMapButtons();
  scheduleSnap();
}
