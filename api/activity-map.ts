import { cors, verifyAuth } from './_lib/common.js';

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

  const mapboxToken = process.env.VITE_MAPBOX_WEB_TOKEN || process.env.VITE_MAPBOX_MOBILE_TOKEN || process.env.MAPBOX_ACCESS_TOKEN;
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!mapboxToken && !googleApiKey) {
    console.error('[activity-map] Nenhum provedor de mapa configurado.');
    return res.status(500).json({ success: false, userMessage: 'Mapa indisponivel no momento.' });
  }

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

    let mapUrl;
    if (mapboxToken) {
      const styleId = requestedMapType === 'satellite' ? 'satellite-streets-v12' : 'dark-v11';
      const buildMapboxUrl = (routePoints) => {
        const overlay = {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: { stroke: '#ffad12', 'stroke-width': 6, 'stroke-opacity': 1 }, geometry: { type: 'LineString', coordinates: routePoints.map((point) => [point.lng, point.lat]) } },
            { type: 'Feature', properties: { 'marker-size': 'small', 'marker-color': '#ffad12' }, geometry: { type: 'Point', coordinates: [start.lng, start.lat] } },
            { type: 'Feature', properties: { 'marker-size': 'small', 'marker-color': '#ffffff' }, geometry: { type: 'Point', coordinates: [end.lng, end.lat] } }
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
    } else {
      const encoded = encodePolyline(points);
      const styleParams = requestedMapType === 'roadmap' ? `&${DARK_STYLE_RULES.map((s) => `style=${encodeURIComponent(s)}`).join('&')}` : '';
      mapUrl = `https://maps.googleapis.com/maps/api/staticmap?size=${w}x${h}&scale=2&maptype=${requestedMapType}` + styleParams + `&path=color:0xFFAA00FF|weight:5|enc:${encodeURIComponent(encoded)}` + `&markers=color:0xFF7A00|size:mid|${start.lat},${start.lng}` + `&markers=color:0x111111|size:mid|${end.lat},${end.lng}` + `&key=${googleApiKey}`;
    }

    const [mapRes, weather] = await Promise.all([
      fetch(mapUrl),
      fetchWeather(start.lat, start.lng)
    ]);

    if (!mapRes.ok) {
      const errText = await mapRes.text().catch(() => '');
      console.error('[activity-map] Static map error:', mapRes.status, errText);
      return res.status(502).json({ success: false, userMessage: 'Nao foi possivel gerar a imagem do mapa agora.' });
    }
    const arrBuf = await mapRes.arrayBuffer();
    const buffer = Buffer.from(arrBuf);
    const imageDataUrl = `data:image/png;base64,${buffer.toString('base64')}`;

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
