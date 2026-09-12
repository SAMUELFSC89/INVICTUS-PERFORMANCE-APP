import { toPng } from 'html-to-image';
import { shareCardExportService } from '../services/shareCardExportService';
import './shareCardRoundEnhancer.css';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SOCIAL_EXPORT_WIDTH = 2160;
const SOCIAL_EXPORT_HEIGHT = 3840;
const MAPBOX_MAX_AUTO_FIT_ZOOM = 16.5;

type GeoPoint = { lat: number; lng: number };
type MapRequestSnapshot = {
  trajectory: GeoPoint[];
  width: number;
  height: number;
  zoomAdjust: number;
  provider?: string;
};

let exportInProgress = false;
let lastMapRequest: MapRequestSnapshot | null = null;

function getCard(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.share-card-art');
}

function getMapLayer(card = getCard()): HTMLElement | null {
  return card?.querySelector<HTMLElement>('.share-card-map-layer') ?? null;
}

function numberAttr(element: Element | null, name: string): number | null {
  if (!element) return null;
  const value = Number(element.getAttribute(name));
  return Number.isFinite(value) ? value : null;
}

function ensureSvgRouteMarkers(card = getCard()) {
  if (!card) return;

  const startMarker = card.querySelector<SVGGElement>('.share-route-start-marker');
  if (startMarker && !startMarker.querySelector('[data-invictus-start-flag]')) {
    const reference = startMarker.querySelector('circle');
    const cx = numberAttr(reference, 'cx');
    const cy = numberAttr(reference, 'cy');
    if (cx !== null && cy !== null) {
      const pole = document.createElementNS(SVG_NS, 'line');
      // A base do mastro nasce exatamente no primeiro ponto do polyline.
      pole.setAttribute('x1', String(cx));
      pole.setAttribute('y1', String(cy));
      pole.setAttribute('x2', String(cx));
      pole.setAttribute('y2', String(cy - 70));
      pole.setAttribute('stroke', '#f3b324');
      pole.setAttribute('stroke-width', '12');
      pole.setAttribute('stroke-linecap', 'round');
      pole.setAttribute('data-invictus-start-flag', 'true');

      const flag = document.createElementNS(SVG_NS, 'path');
      flag.setAttribute('d', `M ${cx + 4} ${cy - 68} L ${cx + 60} ${cy - 52} L ${cx + 4} ${cy - 34} Z`);
      flag.setAttribute('fill', '#f3b324');
      flag.setAttribute('stroke', '#fff4cf');
      flag.setAttribute('stroke-width', '4');
      flag.setAttribute('stroke-linejoin', 'round');
      flag.setAttribute('data-invictus-start-flag', 'true');
      startMarker.append(pole, flag);
    }
  }

  const finishMarker = card.querySelector<SVGGElement>('.share-route-finish-marker');
  if (finishMarker && !finishMarker.querySelector('[data-invictus-end-dot]')) {
    const reference = finishMarker.querySelector('circle');
    const cx = numberAttr(reference, 'cx');
    const cy = numberAttr(reference, 'cy');
    if (cx !== null && cy !== null) {
      Array.from(finishMarker.children).forEach((child) => child.setAttribute('data-invictus-legacy-finish', 'true'));
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', String(cx));
      dot.setAttribute('cy', String(cy));
      dot.setAttribute('r', '18');
      dot.setAttribute('fill', '#f3b324');
      dot.setAttribute('stroke', '#fff4cf');
      dot.setAttribute('stroke-width', '6');
      dot.setAttribute('data-invictus-end-dot', 'true');
      finishMarker.appendChild(dot);
    }
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function decimatePoints(points: GeoPoint[], maxPoints: number): GeoPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const output: GeoPoint[] = [];
  for (let index = 0; index < points.length; index += step) output.push(points[index]);
  if (output[output.length - 1] !== points[points.length - 1]) output.push(points[points.length - 1]);
  return output;
}

function longitudeToWorldX(lng: number): number {
  return (lng + 180) / 360;
}

function latitudeToWorldY(lat: number): number {
  const safeLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const radians = safeLat * Math.PI / 180;
  return 0.5 - Math.log((1 + Math.sin(radians)) / (1 - Math.sin(radians))) / (4 * Math.PI);
}

function latRad(lat: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  const radX2 = Math.log((1 + sin) / (1 - sin)) / 2;
  return clampNumber(radX2, -Math.PI, Math.PI) / 2;
}

function computeMapProjection(snapshot: MapRequestSnapshot) {
  const { trajectory: points, width, height, zoomAdjust } = snapshot;
  if (points.length < 2) return null;

  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const mapPadding = Math.round(Math.min(width, height) * 0.16);
  const safeWidth = Math.max(1, width - mapPadding * 2);
  const safeHeight = Math.max(1, height - mapPadding * 2);
  const latFraction = (latRad(maxLat) - latRad(minLat)) / Math.PI;
  const lngFraction = Math.max(0, maxLng - minLng) / 360;
  const latZoom = latFraction > 0 ? Math.log2(safeHeight / 256 / latFraction) : 21;
  const lngZoom = lngFraction > 0 ? Math.log2(safeWidth / 256 / lngFraction) : 21;
  const fitZoom = Math.min(latZoom, lngZoom);
  const finalZoom = clampNumber(Math.min(fitZoom, MAPBOX_MAX_AUTO_FIT_ZOOM) + zoomAdjust, 3, 18);
  const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  const worldSize = 256 * (2 ** finalZoom);
  const centerWorldX = longitudeToWorldX(center.lng) * worldSize;
  const centerWorldY = latitudeToWorldY(center.lat) * worldSize;

  const project = (point: GeoPoint) => ({
    x: (longitudeToWorldX(point.lng) * worldSize - centerWorldX) + width / 2,
    y: (latitudeToWorldY(point.lat) * worldSize - centerWorldY) + height / 2,
  });

  return { start: project(points[0]), finish: project(points[points.length - 1]), width, height };
}

function positionMarkerForCover(
  marker: HTMLElement | null,
  point: { x: number; y: number },
  projection: { width: number; height: number },
  layer: HTMLElement,
) {
  if (!marker) return;
  const layerWidth = layer.clientWidth || projection.width;
  const layerHeight = layer.clientHeight || projection.height;
  const coverScale = Math.max(layerWidth / projection.width, layerHeight / projection.height);
  const renderedWidth = projection.width * coverScale;
  const renderedHeight = projection.height * coverScale;
  const offsetX = (layerWidth - renderedWidth) / 2;
  const offsetY = (layerHeight - renderedHeight) / 2;

  marker.style.left = `${offsetX + point.x * coverScale}px`;
  marker.style.top = `${offsetY + point.y * coverScale}px`;
}

function ensureMapEndpointMarkers(card = getCard()) {
  if (!card || card.classList.contains('share-card-art--photo-route')) return;
  const layer = getMapLayer(card);
  const snapshot = lastMapRequest;
  if (!layer || !snapshot) return;

  // A projeção abaixo corresponde ao Mapbox. Em um fallback excepcional,
  // é melhor não mostrar marcadores do que posicioná-los fora do traçado.
  if (snapshot.provider && snapshot.provider !== 'mapbox') {
    layer.querySelector('[data-share-map-markers]')?.remove();
    return;
  }

  const projection = computeMapProjection(snapshot);
  if (!projection) return;

  let overlay = layer.querySelector<HTMLElement>('[data-share-map-markers]');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'share-round-map-markers';
    overlay.setAttribute('data-share-map-markers', 'true');
    const start = document.createElement('span');
    start.className = 'share-round-map-marker share-round-map-marker--start';
    start.setAttribute('data-map-start', 'true');
    const finish = document.createElement('span');
    finish.className = 'share-round-map-marker share-round-map-marker--finish';
    finish.setAttribute('data-map-finish', 'true');
    overlay.append(start, finish);
    layer.appendChild(overlay);
  }

  positionMarkerForCover(overlay.querySelector<HTMLElement>('[data-map-start]'), projection.start, projection, layer);
  positionMarkerForCover(overlay.querySelector<HTMLElement>('[data-map-finish]'), projection.finish, projection, layer);
}

function enhanceShareCard() {
  const card = getCard();
  if (!card) return;
  card.classList.add('share-card-round-v3');
  ensureSvgRouteMarkers(card);
  ensureMapEndpointMarkers(card);
}

function setFeedback(message: string) {
  const notices = document.querySelector<HTMLElement>('.share-card-notices');
  if (!notices) return;
  let feedback = notices.querySelector<HTMLElement>('[data-share-round-feedback]');
  if (!feedback) {
    feedback = document.createElement('p');
    feedback.className = 'share-card-feedback';
    feedback.setAttribute('data-share-round-feedback', 'true');
    notices.appendChild(feedback);
  }
  feedback.textContent = message;
}

async function highQualityExport(mode: 'share' | 'download') {
  if (exportInProgress) return;
  const card = getCard();
  if (!card) return;
  exportInProgress = true;
  card.classList.add('is-exporting');
  setFeedback('Gerando imagem em alta definição…');

  try {
    await document.fonts?.ready;
    const images = Array.from(card.querySelectorAll('img'));
    await Promise.all(images.map(async (image) => {
      try { await image.decode?.(); } catch { /* best effort */ }
    }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error('Card sem dimensão para exportação.');

    // Render em 2K vertical. O arquivo continua PNG sem recompressão no plugin
    // nativo; redes sociais podem reduzir depois, mas recebem uma fonte muito
    // mais definida do que o antigo raster 1080x1920.
    const widthRatio = SOCIAL_EXPORT_WIDTH / rect.width;
    const heightRatio = SOCIAL_EXPORT_HEIGHT / rect.height;
    const pixelRatio = Math.max(1, Math.min(6, widthRatio, heightRatio));
    const dataUrl = await toPng(card, {
      pixelRatio,
      cacheBust: true,
      backgroundColor: '#050608',
      skipAutoScale: true,
    });
    const fileName = `invictus-atividade-${Date.now()}.png`;

    if (mode === 'share') {
      const result = await shareCardExportService.share(dataUrl, fileName);
      setFeedback(result === 'shared' ? 'Imagem pronta para compartilhar.' : 'Compartilhamento indisponível; imagem salva.');
    } else {
      await shareCardExportService.save(dataUrl, fileName);
      setFeedback('Imagem salva em alta definição PNG.');
    }
  } catch (error) {
    console.error('[shareCardRoundEnhancer] Falha na exportação social:', error);
    setFeedback('Não foi possível gerar a imagem em alta qualidade.');
  } finally {
    card.classList.remove('is-exporting');
    exportInProgress = false;
  }
}

function installExportCapture() {
  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const button = target?.closest<HTMLButtonElement>('button');
    if (!button || !document.querySelector('.share-screen')) return;
    const label = button.getAttribute('aria-label');
    if (label !== 'Compartilhar imagem' && label !== 'Salvar imagem') return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void highQualityExport(label === 'Compartilhar imagem' ? 'share' : 'download');
  }, true);
}

function normalizeTrajectory(value: unknown): GeoPoint[] {
  if (!Array.isArray(value)) return [];
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') return null;
    const source = candidate as Record<string, unknown>;
    const location = source.location && typeof source.location === 'object'
      ? source.location as Record<string, unknown>
      : undefined;
    const lat = Number(source.lat ?? source.latitude ?? location?.lat ?? location?.latitude);
    const lng = Number(source.lng ?? source.longitude ?? location?.lng ?? location?.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }).filter((point): point is GeoPoint => Boolean(point));
}

function installPrivateMapFetch() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const pathname = new URL(url, window.location.href).pathname;
      if (pathname.endsWith('/api/activity-map') && init?.method?.toUpperCase() === 'POST' && typeof init.body === 'string') {
        const body = JSON.parse(init.body);
        const trajectory = normalizeTrajectory(body.trajectory);
        if (trajectory.length >= 2) {
          // O backend Mapbox faz a mesma decimação antes de calcular fit/center.
          // Usar exatamente os mesmos pontos elimina o deslocamento dos endpoints.
          lastMapRequest = {
            trajectory: decimatePoints(trajectory, 140),
            width: Math.max(200, Number(body.width) || 720),
            height: Math.max(200, Number(body.height) || 1280),
            zoomAdjust: Number.isFinite(Number(body.zoomAdjust)) ? Number(body.zoomAdjust) : 0,
          };
        }

        // satellite-v9 não contém labels de ruas/bairros/POIs. A privacidade
        // continua preservada sem interferir na geometria da rota.
        body.mapType = 'satellite-plain';
        const response = await originalFetch(input, { ...init, body: JSON.stringify(body) });
        try {
          const json = await response.clone().json();
          if (lastMapRequest) lastMapRequest.provider = String(json?.mapProvider || '');
        } catch { /* resposta sem JSON válido: o componente tratará o erro */ }
        queueMicrotask(() => enhanceShareCard());
        return response;
      }
    } catch (error) {
      console.warn('[shareCardRoundEnhancer] Não foi possível aplicar mapa privado:', error);
    }
    return originalFetch(input, init);
  };
}

installPrivateMapFetch();
installExportCapture();

const observer = new MutationObserver(() => enhanceShareCard());
observer.observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener('resize', () => ensureMapEndpointMarkers());

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', enhanceShareCard, { once: true });
} else {
  enhanceShareCard();
}
