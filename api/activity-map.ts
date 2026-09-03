import { cors, verifyAuth } from './_lib/common.js';
import Jimp from 'jimp';

// Endpoint server-side que gera a imagem do mapa da rota. Mapbox e o provedor
// principal; Google permanece como fallback para builds antigos. O frontend
// recebe somente a imagem pronta, nunca credenciais privadas.

// Codificacao de polyline no formato do Google (Encoded Polyline Algorithm Format)
// -- necessaria para o parametro "path" da Static Maps API sem estourar o limite
// de tamanho de URL em rotas longas (uma corrida de 10km pode ter centenas de pontos).
function encodePolyline(points) {
  let lastLat = 0;
  let lastLng = 0;
  let result = '';
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    result += encodeSignedNumber(lat - lastLat) + encodeSignedNumber(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return result;
}
function encodeSignedNumber(num) {
  let sgnNum = num << 1;
  if (num < 0) sgnNum = ~sgnNum;
  return encodeNumber(sgnNum);
}
function encodeNumber(num) {
  let encoded = '';
  while (num >= 0x20) {
    encoded += String.fromCharCode((0x20 | (num & 0x1f)) + 63);
    num >>= 5;
  }
  encoded += String.fromCharCode(num + 63);
  return encoded;
}

// #216: pontos de GPS podem vir em dois formatos usados no app: plano
// {lat,lng,timestamp} (AdvancedRunStats.trajectory, fluxo "Corrida Invictus") ou
// aninhado {timestamp, location:{lat,lng,accuracy}} (checkpoints do cardio geral,
// src/types.ts). O mapa ficava vazio porque so liamos o formato plano. Agora
// aceitamos os dois.
function extractLatLng(p) {
  if (!p) return null;
  const lat = Number(p.lat ?? p.latitude ?? p.location?.lat ?? p.location?.latitude);
  const lng = Number(p.lng ?? p.longitude ?? p.location?.lng ?? p.location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function decimatePoints(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

// Fallback sem chave para quando a Static Images API estiver indisponível.
// Ele usa tiles públicos de satélite/rua, monta um canvas vertical e desenha a
// mesma rota laranja com os marcadores do banner. Assim uma falha transitória
// do Mapbox não transforma o card inteiro em "mapa indisponível".
const FALLBACK_TILE_SIZE = 256;
const FALLBACK_SATELLITE_TILE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
const FALLBACK_ROAD_TILE = 'https://tile.openstreetmap.org';

function longitudeToWorldX(lng) {
  return (lng + 180) / 360;
}

function latitudeToWorldY(lat) {
  const safeLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const radians = safeLat * Math.PI / 180;
  return (0.5 - Math.log((1 + Math.sin(radians)) / (1 - Math.sin(radians))) / (4 * Math.PI));
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function drawFallbackCircle(image, cx, cy, radius, color) {
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(image.bitmap.width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(image.bitmap.height - 1, Math.ceil(cy + radius));
  const radiusSquared = radius * radius;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radiusSquared) image.setPixelColor(color, x, y);
    }
  }
}

function drawFallbackLine(image, from, to, width, color) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(distance));
  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    drawFallbackCircle(
      image,
      from.x + (to.x - from.x) * ratio,
      from.y + (to.y - from.y) * ratio,
      width / 2,
      color,
    );
  }
}

function fallbackViewport(points, width, height, zoom) {
  const worldSize = FALLBACK_TILE_SIZE * (2 ** zoom);
  const xs = points.map(point => longitudeToWorldX(point.lng));
  const ys = points.map(point => latitudeToWorldY(point.lat));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const routeWidth = Math.max(maxX - minX, 1 / worldSize);
  const routeHeight = Math.max(maxY - minY, 1 / worldSize);
  const aspect = width / height;
  let viewWidth = routeWidth * 1.34;
  let viewHeight = routeHeight * 1.34;
  if (viewWidth / viewHeight < aspect) viewWidth = viewHeight * aspect;
  if (viewWidth / viewHeight > aspect) viewHeight = viewWidth / aspect;
  const centerX = ((minX + maxX) / 2) * worldSize;
  const centerY = ((minY + maxY) / 2) * worldSize;
  const viewportWidth = Math.max(width, viewWidth * worldSize);
  const viewportHeight = Math.max(height, viewHeight * worldSize);
  const left = centerX - viewportWidth / 2 - 3;
  const top = centerY - viewportHeight / 2 - 3;
  const right = centerX + viewportWidth / 2 + 3;
  const bottom = centerY + viewportHeight / 2 + 3;
  const tileMinX = Math.floor(left / FALLBACK_TILE_SIZE);
  const tileMaxX = Math.floor((right - 1) / FALLBACK_TILE_SIZE);
  const tileMinY = Math.max(0, Math.floor(top / FALLBACK_TILE_SIZE));
  const tileMaxY = Math.min(Math.ceil(worldSize / FALLBACK_TILE_SIZE) - 1, Math.floor((bottom - 1) / FALLBACK_TILE_SIZE));
  return { worldSize, centerX, centerY, left, top, right, bottom, tileMinX, tileMaxX, tileMinY, tileMaxY };
}

async function renderFallbackMap(points, width, height, mapType) {
  try {
    let zoom = 17;
    const initial = fallbackViewport(points, width, height, zoom);
    const fitScale = Math.min(
      width / Math.max(initial.right - initial.left, width),
      height / Math.max(initial.bottom - initial.top, height),
    );
    zoom = clampNumber(Math.floor(zoom + Math.log2(Math.max(fitScale, 0.000001))), 1, 18);

    let viewport = fallbackViewport(points, width, height, zoom);
    while ((viewport.tileMaxX - viewport.tileMinX + 1) * (viewport.tileMaxY - viewport.tileMinY + 1) > 30 && zoom > 1) {
      zoom -= 1;
      viewport = fallbackViewport(points, width, height, zoom);
    }

    const tileColumns = viewport.tileMaxX - viewport.tileMinX + 1;
    const tileRows = viewport.tileMaxY - viewport.tileMinY + 1;
    const stitched = new Jimp(
      tileColumns * FALLBACK_TILE_SIZE,
      tileRows * FALLBACK_TILE_SIZE,
      mapType === 'satellite' ? 0x101419ff : 0x12171cff,
    );
    let loadedTiles = 0;
    const worldTiles = 2 ** zoom;
    const tilePromises = [];

    for (let tileY = viewport.tileMinY; tileY <= viewport.tileMaxY; tileY += 1) {
      for (let tileX = viewport.tileMinX; tileX <= viewport.tileMaxX; tileX += 1) {
        const wrappedX = ((tileX % worldTiles) + worldTiles) % worldTiles;
        const tileUrl = mapType === 'satellite'
          ? `${FALLBACK_SATELLITE_TILE}/${zoom}/${tileY}/${wrappedX}`
          : `${FALLBACK_ROAD_TILE}/${zoom}/${wrappedX}/${tileY}.png`;
        const xOffset = (tileX - viewport.tileMinX) * FALLBACK_TILE_SIZE;
        const yOffset = (tileY - viewport.tileMinY) * FALLBACK_TILE_SIZE;
        tilePromises.push((async () => {
          try {
            const response = await fetch(tileUrl, {
              headers: { 'User-Agent': 'Invictus Performance map renderer/1.0' },
            });
            if (!response.ok) return;
            const tile = await Jimp.read(Buffer.from(await response.arrayBuffer()));
            tile.resize(FALLBACK_TILE_SIZE, FALLBACK_TILE_SIZE);
            stitched.composite(tile, xOffset, yOffset);
            loadedTiles += 1;
          } catch (error) {
            console.warn('[activity-map] Tile fallback indisponivel:', tileUrl, error);
          }
        })());
      }
    }

    await Promise.all(tilePromises);
    if (loadedTiles === 0) return null;

    // A referência usa um mapa noturno. Escurecemos os tiles sem remover a
    // leitura da rota e dos contornos urbanos.
    if (mapType === 'satellite') {
      stitched.brightness(-0.34).contrast(0.12);
    } else {
      stitched.brightness(-0.55).contrast(0.12);
    }

    const cropX = Math.round(viewport.centerX - width / 2 - viewport.tileMinX * FALLBACK_TILE_SIZE);
    const cropY = Math.round(viewport.centerY - height / 2 - viewport.tileMinY * FALLBACK_TILE_SIZE);
    const maxCropX = Math.max(0, stitched.bitmap.width - width);
    const maxCropY = Math.max(0, stitched.bitmap.height - height);
    const image = stitched.clone().crop(clampNumber(cropX, 0, maxCropX), clampNumber(cropY, 0, maxCropY), width, height);
    const routeLayer = new Jimp(width, height, 0x00000000);
    const worldSize = viewport.worldSize;
    const project = (point) => ({
      x: longitudeToWorldX(point.lng) * worldSize - (viewport.centerX - width / 2),
      y: latitudeToWorldY(point.lat) * worldSize - (viewport.centerY - height / 2),
    });
    const projected = points.map(project);
    const glowColor = Jimp.rgbaToInt(255, 157, 0, 92);
    const routeColor = Jimp.rgbaToInt(255, 173, 18, 255);
    for (let i = 1; i < projected.length; i += 1) {
      drawFallbackLine(routeLayer, projected[i - 1], projected[i], 18, glowColor);
      drawFallbackLine(routeLayer, projected[i - 1], projected[i], 7, routeColor);
    }
    const start = projected[0];
    const end = projected[projected.length - 1];
    drawFallbackCircle(routeLayer, start.x, start.y, 15, Jimp.rgbaToInt(255, 255, 255, 255));
    drawFallbackCircle(routeLayer, start.x, start.y, 8, Jimp.rgbaToInt(255, 173, 18, 255));
    drawFallbackCircle(routeLayer, end.x, end.y, 15, Jimp.rgbaToInt(255, 255, 255, 255));
    drawFallbackCircle(routeLayer, end.x, end.y, 8, Jimp.rgbaToInt(18, 18, 18, 255));
    image.composite(routeLayer, 0, 0);
    const buffer = await image.getBufferAsync(Jimp.MIME_PNG);
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.error('[activity-map] Fallback de tiles falhou:', error);
    return null;
  }
}

// Estilo escuro (aproximado do padrao usado por apps fitness estilo Strava) para o
// Google Static Maps. Mantemos os rotulos de bairro/localidade e de parques
// visiveis (apenas escondemos ruido de POI comercial) para o mapa parecer o mais
// proximo possivel da referencia (nomes de bairro, "Parque do Povo", etc).
const DARK_STYLE_RULES = [
  'element:geometry|color:0x1a1a1a',
  'element:labels.text.fill|color:0xb0b0b0',
  'element:labels.text.stroke|color:0x0d0d0d',
  'feature:road|element:geometry|color:0x2c2c2c',
  'feature:road|element:geometry.stroke|color:0x1a1a1a',
  'feature:road|element:labels|visibility:simplified',
  'feature:water|element:geometry|color:0x0d2b3e',
  'feature:water|element:labels.text.fill|color:0x4a90c2',
  'feature:poi.park|element:geometry|color:0x1f3a1a',
  'feature:poi.park|element:labels.text.fill|color:0x8fce6a',
  'feature:poi.business|element:labels|visibility:off',
  'feature:poi.medical|element:labels|visibility:off',
  'feature:poi.school|element:labels|visibility:off',
  'feature:poi.attraction|element:labels|visibility:off',
  'feature:poi.government|element:labels|visibility:off',
  'feature:administrative.neighborhood|element:labels.text.fill|color:0xd8d8d8',
  'feature:administrative.locality|element:labels.text.fill|color:0xd8d8d8',
  'feature:administrative|element:geometry|color:0x3a3a3a',
  'feature:transit|visibility:off'
];

// Clima atual (sem chave de API -- Open-Meteo). Aproximacao honesta: mostra o
// clima ATUAL na localizacao inicial da rota, nao o clima no momento exato da
// atividade (nao temos historico de clima integrado).
async function fetchWeather(lat, lng) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const tempC = json?.current?.temperature_2m;
    const code = json?.current?.weather_code;
    if (tempC === undefined) return null;
    // Mapeamento simplificado do WMO weather code para um emoji de icone
    let icon = '☀️';
    if (code >= 1 && code <= 3) icon = '⛅';
    else if (code >= 45 && code <= 48) icon = '🌫️';
    else if (code >= 51 && code <= 67) icon = '🌧️';
    else if (code >= 71 && code <= 86) icon = '🌨️';
    else if (code >= 95) icon = '⛈️';
    return { tempC: Math.round(tempC), icon };
  } catch (err) {
    console.warn('[activity-map] fetchWeather falhou (nao critico):', err);
    return null;
  }
}

export default async function handler(req, res) {
  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, userMessage: 'Metodo nao permitido.' });
  }

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ success: false, userMessage: 'Sessao expirada. Entre novamente.' });
  }

  // MAPBOX_PUBLIC_TOKEN is the canonical Vercel variable used by the other
  // map endpoint. Keep the older aliases for existing environments.
  const mapboxToken = process.env.MAPBOX_PUBLIC_TOKEN || process.env.VITE_MAPBOX_WEB_TOKEN || process.env.VITE_MAPBOX_MOBILE_TOKEN || process.env.MAPBOX_ACCESS_TOKEN;
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!mapboxToken && !googleApiKey) console.warn('[activity-map] Provedor principal nao configurado; usando tiles de fallback.');

  try {
    const { trajectory, width, height, mapType } = req.body || {};
    if (!Array.isArray(trajectory) || trajectory.length < 2) {
      return res.status(400).json({ success: false, userMessage: 'Rota GPS insuficiente para gerar o mapa desta atividade.' });
    }

    let points = trajectory.map(extractLatLng).filter(Boolean);

    if (points.length < 2) {
      return res.status(400).json({ success: false, userMessage: 'Rota GPS invalida para esta atividade.' });
    }

    points = decimatePoints(points, mapboxToken ? 140 : 300);

    const w = Math.min(1280, Math.max(200, Number(width) || 640));
    const h = Math.min(1280, Math.max(200, Number(height) || 400));
    const start = points[0];
    const end = points[points.length - 1];
    const requestedMapType = mapType === 'satellite' ? 'satellite' : 'roadmap';

    let mapUrl = null;
    const buildGoogleMapUrl = () => {
      // A Static Maps API limita o tamanho básico a 640px por eixo. O card
      // continua vertical porque o fallback de tiles assume o tamanho real.
      const googleWidth = Math.min(640, w);
      const googleHeight = Math.min(640, h);
      const encoded = encodePolyline(points);
      const styleParams = requestedMapType === 'roadmap' ? `&${DARK_STYLE_RULES.map((s) => `style=${encodeURIComponent(s)}`).join('&')}` : '';
      return `https://maps.googleapis.com/maps/api/staticmap?size=${googleWidth}x${googleHeight}&scale=2&maptype=${requestedMapType}` + styleParams + `&path=color:0xFFAA00FF|weight:5|enc:${encodeURIComponent(encoded)}` + `&markers=color:0xFFFFFF|size:mid|${start.lat},${start.lng}` + `&markers=color:0xFFAA00|size:small|${start.lat},${start.lng}` + `&markers=color:0xFFFFFF|size:mid|${end.lat},${end.lng}` + `&markers=color:0x111111|size:small|${end.lat},${end.lng}` + `&key=${googleApiKey}`;
    };

    if (mapboxToken) {
      const styleId = requestedMapType === 'satellite' ? 'satellite-streets-v12' : 'dark-v11';
      const buildMapboxUrl = (routePoints) => {
        const overlay = {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: { stroke: '#ffad12', 'stroke-width': 6, 'stroke-opacity': 1 }, geometry: { type: 'LineString', coordinates: routePoints.map((point) => [point.lng, point.lat]) } },
            // Duas camadas por ponto reproduzem os marcadores circulares da
            // arte de referencia: aro claro + centro laranja no inicio e aro
            // claro + centro escuro na chegada.
            { type: 'Feature', properties: { 'marker-size': 'medium', 'marker-color': '#ffffff' }, geometry: { type: 'Point', coordinates: [start.lng, start.lat] } },
            { type: 'Feature', properties: { 'marker-size': 'small', 'marker-color': '#ffad12' }, geometry: { type: 'Point', coordinates: [start.lng, start.lat] } },
            { type: 'Feature', properties: { 'marker-size': 'medium', 'marker-color': '#ffffff' }, geometry: { type: 'Point', coordinates: [end.lng, end.lat] } },
            { type: 'Feature', properties: { 'marker-size': 'small', 'marker-color': '#151515' }, geometry: { type: 'Point', coordinates: [end.lng, end.lat] } }
          ]
        };
        return `https://api.mapbox.com/styles/v1/mapbox/${styleId}/static/geojson(${encodeURIComponent(JSON.stringify(overlay))})/auto/${w}x${h}@2x?padding=55&access_token=${encodeURIComponent(mapboxToken)}`;
      };

      mapUrl = buildMapboxUrl(points);
      // A Static Images API recebe a rota na própria URL. Em atividades
      // longas, 140 coordenadas em GeoJSON escapado podem ultrapassar o
      // limite aceito por proxies/CDNs e produzir mapa vazio. Reduzimos só a
      // geometria visual até caber, preservando sempre início e fim; os dados
      // completos da atividade continuam intactos no histórico/antifraude.
      while (mapUrl.length > 7500 && points.length > 20) {
        points = decimatePoints(points, Math.max(20, Math.floor(points.length * 0.7)));
        mapUrl = buildMapboxUrl(points);
      }
    } else if (googleApiKey) {
      mapUrl = buildGoogleMapUrl();
    }

    const [mapRes, weather] = await Promise.all([
      mapUrl ? fetch(mapUrl) : Promise.resolve(null),
      fetchWeather(start.lat, start.lng)
    ]);

    let imageDataUrl = null;
    if (mapRes?.ok) {
      const arrBuf = await mapRes.arrayBuffer();
      const buffer = Buffer.from(arrBuf);
      imageDataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
    } else {
      const errText = mapRes ? await mapRes.text().catch(() => '') : 'nenhum provedor configurado';
      console.error('[activity-map] Static map error:', mapRes?.status || 'none', errText);

      // Se o Mapbox falhar, ainda tentamos a chave Google quando disponível.
      if (mapboxToken && googleApiKey) {
        try {
          const googleRes = await fetch(buildGoogleMapUrl());
          if (googleRes.ok) {
            const buffer = Buffer.from(await googleRes.arrayBuffer());
            imageDataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
          } else {
            console.warn('[activity-map] Google Static Maps tambem falhou:', googleRes.status, await googleRes.text().catch(() => ''));
          }
        } catch (googleError) {
          console.warn('[activity-map] Tentativa Google falhou:', googleError);
        }
      }

      if (!imageDataUrl) imageDataUrl = await renderFallbackMap(points, w, h, requestedMapType);
      if (!imageDataUrl) return res.status(502).json({ success: false, userMessage: 'Nao foi possivel gerar a imagem do mapa agora.' });
    }

    // Reverse geocoding leve (1 chamada) so para obter "Cidade, UF" do ponto
    // inicial da rota, usado no cabecalho da tela de detalhe/card de compartilhamento.
    let location = { label: null };
    try {
      if (!googleApiKey) throw new Error('Reverse geocoding Google nao configurado.');
      const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${start.lat},${start.lng}&key=${googleApiKey}&language=pt-BR`;
      const geoRes = await fetch(geoUrl);
      if (geoRes.ok) {
        const geoJson = await geoRes.json();
        const result = geoJson && geoJson.results && geoJson.results[0];
        if (result) {
          const comp = (type) => {
            const found = (result.address_components || []).find((c) => c.types.includes(type));
            return found ? found.short_name : undefined;
          };
          const city = comp('administrative_area_level_2') || comp('locality');
          const state = comp('administrative_area_level_1');
          location.label = [city, state].filter(Boolean).join(', ') || null;
        }
      }
    } catch (geoErr) {
      console.warn('[activity-map] Reverse geocoding falhou (nao critico):', geoErr);
    }

    return res.json({ success: true, imageDataUrl, location, weather: weather || null });
  } catch (err) {
    console.error('[activity-map] Erro inesperado:', err);
    return res.status(500).json({ success: false, userMessage: 'Erro ao gerar o mapa da atividade.' });
  }
}
