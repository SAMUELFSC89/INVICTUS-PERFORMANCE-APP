import { auth } from '../firebase';
import { API_CONFIG } from '../config';

/**
 * Invictus Power Lift é um campeonato de força GRATUITO: não existe
 * inscrição/checkout separado, a pessoa passa a "participar" assim que envia
 * seu primeiro levantamento em vídeo (aprovado ou ainda em auditoria). O hub
 * de Campeonatos usa isso para decidir entre o card explicativo (ainda não
 * participa) e o card compacto de ranking (já participa), na mesma lógica
 * usada pelos campeonatos pagos de Musculação/Cardio.
 */
class PowerLiftService {
  async hasParticipated(): Promise<boolean> {
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) return false;
      const token = await firebaseUser.getIdToken();
      const resp = await fetch(`${API_CONFIG.baseUrl}/api/powerlift?action=me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return false;
      const data = await resp.json();
      return Array.isArray(data.records) && data.records.length > 0;
    } catch (erro) {
      console.warn('[powerLiftService] falha ao verificar participação:', erro);
      return false;
    }
  }
}

export const powerLiftService = new PowerLiftService();
