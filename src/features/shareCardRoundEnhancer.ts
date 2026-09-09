import { toPng } from 'html-to-image';
import { shareCardExportService } from '../services/shareCardExportService';
import './shareCardRoundEnhancer.css';

const MAP_OPACITY_KEY = 'invictus:share-card:map-opacity';
const MAP_VISIBLE_KEY = 'invictus:share-card:map-visible';
const SVG_NS = 'http://www.w3.org/2000/svg';

let exportInProgress = false;

function getCard(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.share-card-art');
}

function getMapLayer(card = getCard()): HTMLElement | null {
  return card?.querySelector<HTMLElement>('.share-card-map-layer') ?? null;
}

function currentOpacity(): number {
  const saved = Number(localStorage.getItem(MAP_OPACITY_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(1, saved)) : 0.5;
}

function currentVisibility(): boolean {
  return localStorage.getItem(MAP_VISIBLE_KEY) !== 'false';
}

function applyMapPreferences(card = getCard()) {
  if (!card) return;
  card.classList.add('share-card-round-v3');
  const layer = getMapLayer(card);
  if (!layer) return;

  const isPhotoMap = card.classList.contains('share-card-art--photo-map');
  const opacity = isPhotoMap ? currentOpacity() : 1;
  layer.style.opacity = String(opacity);
  layer.style.display = currentVisibility() ? '' : 'none';
  card.style.setProperty('--share-map-opacity', String(opacity));
}

function ensureStartFlag(card = getCard()) {
  const marker = card?.querySelector<SVGGElement>('.share-route-start-marker');
  if (!marker || marker.querySelector('[data-invictus-start-flag]')) return;

  const pole = document.createElementNS(SVG_NS, 'line');
  pole.setAttribute('x1', '0');
  pole.setAttribute('y1', '0');
  pole.setAttribute('x2', '0');
  pole.setAttribute('y2', '-70');
  pole.setAttribute('stroke', '#f3b324');
  pole.setAttribute('stroke-width', '12');
  pole.setAttribute('stroke-linecap', 'round');
  pole.setAttribute('data-invictus-start-flag', 'true');

  const flag = document.createElementNS(SVG_NS, 'path');
  flag.setAttribute('d', 'M 4 -68 L 58 -52 L 4 -34 Z');
  flag.setAttribute('fill', '#f3b324');
  flag.setAttribute('stroke', '#fff4cf');
  flag.setAttribute('stroke-width', '4');
  flag.setAttribute('data-invictus-start-flag', 'true');

  marker.appendChild(pole);
  marker.appendChild(flag);
}

function hideLegacyMapStyleRow(customizer: HTMLElement) {
  customizer.querySelectorAll<HTMLElement>('.share-customizer-row').forEach((row) => {
    if (row.textContent?.includes('Estilo do mapa')) row.style.display = 'none';
  });
}

function createRoundControls(customizer: HTMLElement) {
  if (customizer.querySelector('[data-share-round-controls]')) return;
  const card = getCard();
  if (!card || card.classList.contains('share-card-art--photo-route')) return;

  const box = document.createElement('div');
  box.className = 'share-round-controls';
  box.setAttribute('data-share-round-controls', 'true');

  const privacy = document.createElement('p');
  privacy.className = 'share-round-privacy';
  privacy.textContent = 'Mapa privado: nomes de ruas, bairros e locais ficam ocultos.';

  const visibilityRow = document.createElement('label');
  visibilityRow.className = 'share-round-toggle';
  const visibilityText = document.createElement('span');
  visibilityText.textContent = 'Mostrar mapa';
  const visibility = document.createElement('input');
  visibility.type = 'checkbox';
  visibility.checked = currentVisibility();
  visibility.addEventListener('change', () => {
    localStorage.setItem(MAP_VISIBLE_KEY, visibility.checked ? 'true' : 'false');
    applyMapPreferences();
  });
  visibilityRow.append(visibilityText, visibility);

  const opacityRow = document.createElement('label');
  opacityRow.className = 'share-round-slider';
  const opacityHeader = document.createElement('span');
  const opacityValue = document.createElement('b');
  const setOpacityLabel = (value: number) => { opacityValue.textContent = `${Math.round(value * 100)}%`; };
  opacityHeader.textContent = 'Opacidade do mapa';
  setOpacityLabel(currentOpacity());
  const opacity = document.createElement('input');
  opacity.type = 'range';
  opacity.min = '0';
  opacity.max = '100';
  opacity.step = '1';
  opacity.value = String(Math.round(currentOpacity() * 100));
  opacity.addEventListener('input', () => {
    const value = Number(opacity.value) / 100;
    localStorage.setItem(MAP_OPACITY_KEY, String(value));
    setOpacityLabel(value);
    applyMapPreferences();
  });
  const headerWrap = document.createElement('div');
  headerWrap.append(opacityHeader, opacityValue);
  opacityRow.append(headerWrap, opacity);

  box.append(privacy, visibilityRow, opacityRow);

  const modes = customizer.querySelector('.share-customizer-modes');
  modes?.insertAdjacentElement('afterend', box);
  hideLegacyMapStyleRow(customizer);
}

function enhanceShareCard() {
  const card = getCard();
  if (!card) return;
  card.classList.add('share-card-round-v3');
  applyMapPreferences(card);
  ensureStartFlag(card);
  document.querySelectorAll<HTMLElement>('.share-customizer').forEach(createRoundControls);
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
  setFeedback('Gerando imagem em alta qualidade…');

  try {
    await document.fonts?.ready;
    const images = Array.from(card.querySelectorAll('img'));
    await Promise.all(images.map(async (image) => {
      try { await image.decode?.(); } catch { /* best effort */ }
    }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error('Card sem dimensão para exportação.');

    // Meta 2160x3840 (9:16). Mantém limite para não estourar memória em aparelhos antigos.
    const pixelRatio = Math.max(2, Math.min(6, 2160 / rect.width));
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
      setFeedback('Imagem salva em alta qualidade.');
    }
  } catch (error) {
    console.error('[shareCardRoundEnhancer] Falha na exportação HD:', error);
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

function installPrivateMapFetch() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const pathname = new URL(url, window.location.href).pathname;
      if (pathname.endsWith('/api/activity-map') && init?.method?.toUpperCase() === 'POST' && typeof init.body === 'string') {
        const body = JSON.parse(init.body);
        // satellite-v9 não contém labels de ruas/bairros/POIs. A privacidade vence a escolha visual antiga.
        body.mapType = 'satellite-plain';
        return originalFetch(input, { ...init, body: JSON.stringify(body) });
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', enhanceShareCard, { once: true });
} else {
  enhanceShareCard();
}
