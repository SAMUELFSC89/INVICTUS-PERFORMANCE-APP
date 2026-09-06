import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, cors, verifyAuth, serverTimestamp } from '../_lib/common.js';

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
  const declaredName = String(gym.name).trim().slice(0, 128);
  const declaredLat = Number(gym.latitude);
  const declaredLng = Number(gym.longitude);
  const hasValidDeclaredCoords = Number.isFinite(declaredLat) && Number.isFinite(declaredLng) &&
    declaredLat >= -90 && declaredLat <= 90 && declaredLng >= -180 && declaredLng <= 180;

  try {
    if (!db) return res.status(500).json({ error: 'Falha na inicialização do banco de dados.' });

    const gymRef = db.collection('gyms').doc(gymId);
    const userRef = db.collection('users').doc(auth.uid);

    const [userSnap, gymSnap] = await Promise.all([userRef.get(), gymRef.get()]);
    if (userSnap.exists) {
      const userData = userSnap.data();
      const lastChange = userData?.lastGymChange;
      if (lastChange) {
        const lastChangeDate = new Date(lastChange);
        const diffDays = (new Date().getTime() - lastChangeDate.getTime()) / (1000 * 3600 * 24);
        if (diffDays < 7) {
          return res.status(400).json({
            error: `Você só pode trocar de academia uma vez por semana. Tente novamente em ${Math.ceil(7 - diffDays)} dias.`
          });
        }
      }
    }

    // Atomic update
    const batch = db.batch();

    // SEC-02 (auditoria 6167c8f): "entrar" numa academia é uma ação de um
    // único usuário, mas antes gravava o objeto `gym` inteiro (inclusive
    // latitude/longitude) direto do corpo da requisição no documento
    // COMPARTILHADO `gyms/{gymId}` via merge -- qualquer conta autenticada
    // podia forjar a localização de uma academia real e corromper a geofence
    // de check-in (gyms_checkin.ts) de todos os outros membros. Agora: se a
    // academia já existe, o nome/local compartilhados vêm exclusivamente do
    // registro canônico já salvo, nunca do que quem está entrando declarar;
    // só um cadastro de academia NOVA usa os dados declarados (e mesmo assim
    // com validação de coordenadas).
    let canonicalName = declaredName;
    let canonicalLat: number | undefined = hasValidDeclaredCoords ? declaredLat : undefined;
    let canonicalLng: number | undefined = hasValidDeclaredCoords ? declaredLng : undefined;

    if (gymSnap.exists) {
      const existingGym = gymSnap.data() || {};
      canonicalName = String(existingGym.name || declaredName).slice(0, 128);
      const eLat = existingGym.latitude ?? existingGym.lat;
      const eLng = existingGym.longitude ?? existingGym.lng;
      if (eLat !== undefined && eLng !== undefined && !isNaN(Number(eLat)) && !isNaN(Number(eLng))) {
        canonicalLat = Number(eLat);
        canonicalLng = Number(eLng);
      }
      // Nenhum campo compartilhado (nome, local, endereço) é reescrito por
      // quem está apenas entrando -- só um carimbo de atividade.
      batch.set(gymRef, { updatedAt: serverTimestamp() }, { merge: true });
    } else {
      if (!hasValidDeclaredCoords) {
        return res.status(400).json({ error: 'Latitude/longitude inválidas para cadastrar uma nova academia.' });
      }
      batch.set(gymRef, {
        id: gymId,
        name: canonicalName,
        latitude: canonicalLat,
        longitude: canonicalLng,
        address: typeof gym.address === 'string' ? gym.address.slice(0, 256) : '',
        photo_url: typeof gym.photo_url === 'string' ? gym.photo_url.slice(0, 2048) : '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    // 2. Update user's own association only
    batch.update(userRef, {
      gymId,
      gymName: canonicalName,
      gymLocation: (canonicalLat !== undefined && canonicalLng !== undefined)
        ? { lat: canonicalLat, lng: canonicalLng }
        : null,
      lastGymChange: new Date().toISOString(),
      updatedAt: serverTimestamp()
    });

    await batch.commit();

    return res.json({ success: true, gymName: canonicalName });
  } catch (error: any) {
    console.error('Gym Join API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
