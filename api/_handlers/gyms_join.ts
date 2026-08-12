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

  try {
    if (!db) return res.status(500).json({ error: 'Falha na inicialização do banco de dados.' });

    const gymRef = db.collection('gyms').doc(gym.id);
    const userRef = db.collection('users').doc(auth.uid);

    const userSnap = await userRef.get();
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

    // 1. Ensure gym exists or update it
    batch.set(gymRef, {
      ...gym,
      updatedAt: serverTimestamp()
    }, { merge: true });

    // 2. Update user
    batch.update(userRef, {
      gymId: gym.id,
      gymName: gym.name,
      gymLocation: { lat: gym.latitude, lng: gym.longitude },
      lastGymChange: new Date().toISOString(),
      updatedAt: serverTimestamp()
    });

    await batch.commit();

    return res.json({ success: true });
  } catch (error: any) {
    console.error('Gym Join API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
