import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, cors, verifyAuth, serverTimestamp } from '../_lib/common.js';
import { getGooglePlacesApiKey } from '../_lib/google-places-config.js';

type CanonicalGym = {
  name: string;
  latitude: number;
  longitude: number;
  address: string;
  photo_url: string;
};

async function resolveCanonicalGoogleGym(placeId: string): Promise<CanonicalGym> {
  const apiKey = getGooglePlacesApiKey();
  if (!apiKey) {
    throw Object.assign(new Error('A validação de academias está indisponível no momento.'), { statusCode: 503 });
  }

  const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,photos'
    }
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.warn('[Gym Join] Google Places recusou placeId:', response.status, payload?.error?.status || 'unknown');
    throw Object.assign(new Error('Não foi possível confirmar esta academia. Faça uma nova busca e tente novamente.'), {
      statusCode: response.status === 404 ? 400 : 503
    });
  }

  const canonicalId = String(payload?.id || '').trim();
  const name = String(payload?.displayName?.text || '').trim().slice(0, 128);
  const latitude = Number(payload?.location?.latitude);
  const longitude = Number(payload?.location?.longitude);
  if (canonicalId !== placeId || !name || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw Object.assign(new Error('A academia retornou dados inválidos. Faça uma nova busca.'), { statusCode: 400 });
  }

  const photoRef = typeof payload?.photos?.[0]?.name === 'string' ? payload.photos[0].name : '';
  const photo_url = photoRef && photoRef.startsWith('places/') && photoRef.includes('/photos/')
    ? `/api/gyms/photo?ref=${encodeURIComponent(photoRef)}`
    : '';

  return {
    name,
    latitude,
    longitude,
    address: String(payload?.formattedAddress || '').slice(0, 256),
    photo_url
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Não autorizado.' });

  const { gym } = req.body;
  if (!gym || !gym.id || !gym.name) {
    return res.status(400).json({ error: 'Dados da academia incompletos' });
  }

  const gymId = String(gym.id).trim();
  if (!gymId || gymId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(gymId)) {
    return res.status(400).json({ error: 'ID de academia inválido.' });
  }

  try {
    if (!db) return res.status(500).json({ error: 'Falha na inicialização do banco de dados.' });

    const gymRef = db.collection('gyms').doc(gymId);
    const userRef = db.collection('users').doc(auth.uid);

    const [userSnap, gymSnap] = await Promise.all([userRef.get(), gymRef.get()]);
    if (!userSnap.exists) return res.status(404).json({ error: 'Perfil do usuário não encontrado.' });

    const userData = userSnap.data();
    const lastChange = userData?.lastGymChange;
    if (lastChange) {
      const lastChangeDate = new Date(lastChange);
      const diffDays = (new Date().getTime() - lastChangeDate.getTime()) / (1000 * 3600 * 24);
      if (Number.isFinite(diffDays) && diffDays < 7) {
        return res.status(400).json({
          error: `Você só pode trocar de academia uma vez por semana. Tente novamente em ${Math.ceil(7 - diffDays)} dias.`
        });
      }
    }

    // Academia já conhecida: a associação usa exclusivamente o documento
    // canônico existente. Academia nova: o servidor resolve o placeId direto no
    // Google Places; nome/coordenadas/endereço enviados pelo cliente são apenas
    // dados de apresentação e nunca viram a geofence oficial.
    let canonical: CanonicalGym;
    if (gymSnap.exists) {
      const existingGym = gymSnap.data() || {};
      const latitude = Number(existingGym.latitude ?? existingGym.lat);
      const longitude = Number(existingGym.longitude ?? existingGym.lng);
      const name = String(existingGym.name || '').trim().slice(0, 128);
      if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)
        || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return res.status(409).json({ error: 'O cadastro desta academia precisa ser revisado antes de novos vínculos.' });
      }
      canonical = {
        name,
        latitude,
        longitude,
        address: String(existingGym.address || '').slice(0, 256),
        photo_url: String(existingGym.photo_url || '').slice(0, 2048)
      };
    } else {
      canonical = await resolveCanonicalGoogleGym(gymId);
    }

    const batch = db.batch();
    if (gymSnap.exists) {
      batch.set(gymRef, { updatedAt: serverTimestamp() }, { merge: true });
    } else {
      batch.create(gymRef, {
        id: gymId,
        name: canonical.name,
        latitude: canonical.latitude,
        longitude: canonical.longitude,
        address: canonical.address,
        photo_url: canonical.photo_url,
        source: 'google_places',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    batch.update(userRef, {
      gymId,
      gymName: canonical.name,
      gymLocation: { lat: canonical.latitude, lng: canonical.longitude },
      lastGymChange: new Date().toISOString(),
      updatedAt: serverTimestamp()
    });

    await batch.commit();

    return res.json({ success: true, gymName: canonical.name });
  } catch (error: any) {
    console.error('Gym Join API Error:', error);
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    return res.status(status).json({ error: status < 500 ? error.message : 'Não foi possível vincular a academia agora.' });
  }
}
