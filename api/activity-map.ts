import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from './_lib/common.js';

// #202/#204: endpoint server-side que gera a imagem do mapa da rota (Google Static
// Maps) para a tela de detalhe do cardio e para o card de compartilhamento. A
// chave GOOGLE_MAPS_API_KEY NUNCA e exposta ao cliente -- o frontend so recebe a
// imagem ja pronta (base64) e o rotulo de localizacao (cidade/UF).

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

// Reduz o numero de pontos enviados ao Static Maps (limite pratico de URL) mantendo
// o formato geral da rota -- pega 1 a cada N pontos, sempre preservando o primeiro e o ultimo.
function decimatePoints(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

// Estilo escuro (aproximado do padrao usado por apps fitness estilo Strava) para o
// Google Static Maps -- fundo quase preto, ruas em cinza escuro, agua em azul
// petroleo, parques em verde escuro, para o tracado laranja da rota se destacar.
const DARK_STYLE_RULES = [
  'element:geometry|color:0x1a1a1a',
  'element:labels.text.fill|color:0x8a8a8a',
  'element:labels.text.stroke|color:0x1a1a1a',
  'feature:road|element:geometry|color:0x2c2c2c',
  'feature:road|element:geometry.stroke|color:0x1a1a1a',
  'feature:water|element:geometry|color:0x0d2b3e',
  'feature:poi.park|element:geometry|color:0x1f2e1a',
  'feature:administrative|element:geometry|color:0x3a3a3a',
  'feature:poi|element:labels.icon|visibility:off',
  'feature:transit|visibility:off'
];

export default async function handler(req, res) {
  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, userMessage: 'Metodo nao permitido.' });
  }

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ success: false, userMessage: 'Sessao expirada. Entre novamente.' });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error('[activity-map] GOOGLE_MAPS_API_KEY nao configurada no ambiente.');
    return res.status(500).json({ success: false, userMessage: 'Mapa indisponivel no momento.' });
  }

  try {
    const { trajectory, width, height } = req.body || {};
    if (!Array.isArray(trajectory) || trajectory.length < 2) {
      return res.status(400).json({ success: false, userMessage: 'Rota GPS insuficiente para gerar o mapa desta atividade.' });
    }

    let points = trajectory
      .map((p) => ({ lat: Number(p.lat ?? p.latitude), lng: Number(p.lng ?? p.longitude) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

    if (points.length < 2) {
      return res.status(400).json({ success: false, userMessage: 'Rota GPS invalida para esta atividade.' });
    }

    points = decimatePoints(points, 300);

    const w = Math.min(1280, Math.max(200, Number(width) || 640));
    const h = Math.min(1280, Math.max(200, Number(height) || 400));
    const encoded = encodePolyline(points);
    const start = points[0];
    const end = points[points.length - 1];

    const styleParams = DARK_STYLE_RULES.map((s) => `style=${encodeURIComponent(s)}`).join('&');

    const mapUrl =
      `https://maps.googleapis.com/maps/api/staticmap?size=${w}x${h}&scale=2&maptype=roadmap` +
      `&${styleParams}` +
      `&path=color:0xFFA500FF|weight:4|enc:${encodeURIComponent(encoded)}` +
      `&markers=color:0xFF7A00|size:mid|${start.lat},${start.lng}` +
      `&markers=color:0x111111|size:mid|${end.lat},${end.lng}` +
      `&key=${apiKey}`;

    const mapRes = await fetch(mapUrl);
    if (!mapRes.ok) {
      const errText = await mapRes.text().catch(() => '');
      console.error('[activity-map] Google Static Maps error:', mapRes.status, errText);
      return res.status(502).json({ success: false, userMessage: 'Nao foi possivel gerar a imagem do mapa agora.' });
    }
    const arrBuf = await mapRes.arrayBuffer();
    const buffer = Buffer.from(arrBuf);
    const imageDataUrl = `data:image/png;base64,${buffer.toString('base64')}`;

    // Reverse geocoding leve (1 chamada) so para obter "Cidade, UF" do ponto
    // inicial da rota, usado no cabecalho da tela de detalhe/card de compartilhamento.
    let location = { label: null };
    try {
      const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${start.lat},${start.lng}&key=${apiKey}&language=pt-BR`;
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

    return res.json({ success: true, imageDataUrl, location });
  } catch (err) {
    console.error('[activity-map] Erro inesperado:', err);
    return res.status(500).json({ success: false, userMessage: 'Erro ao gerar o mapa da atividade.' });
  }
}
