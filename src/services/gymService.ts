import { auth } from '../firebase';
import { API_CONFIG } from '../config';

export const gymService = {
  /**
   * Search for gyms near a location using the new backend proxy
   */
  async searchNearbyGyms(lat: number, lng: number, neighborhood?: string, city?: string, q?: string): Promise<any[]> {
    let url = `${API_CONFIG.baseUrl}/api/gyms?lat=${lat}&lng=${lng}`;

    if (neighborhood) url += `&neighborhood=${encodeURIComponent(neighborhood)}`;
    if (city) url += `&city=${encodeURIComponent(city)}`;
    if (q) url += `&q=${encodeURIComponent(q)}`;

    return this.fetchGyms(url);
  },

  async fetchGyms(url: string): Promise<any[]> {
    try {
      const user = auth.currentUser;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      if (user) {
        const token = await user.getIdToken();
        headers['Authorization'] = `Bearer ${token}`;
      }

      console.log(`[GymService] SEARCH Fetching: ${url}`);
      const response = await fetch(url, { headers }).catch(e => {
        console.error(`[GymService] SEARCH Fetch call failed (Net/CORS): ${url}`, e);
        throw e;
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`[GymService] API Error: ${response.status}`, text);
        try {
          const errData = JSON.parse(text);
          const error = new Error([errData.error || `Erro no servidor (Status: ${response.status})`, errData.tip].filter(Boolean).join(' '));
          (error as any).isBillingError = errData.isBillingError;
          (error as any).tip = errData.tip;
          throw error;
        } catch (e: any) {
          if (e.isBillingError || e.tip) throw e;
          throw new Error(`Erro no servidor (Status: ${response.status}). ${text.substring(0, 50)}`);
        }
      }

      const data = await response.json();
      console.log(`[GymService] API Success: ${data.gyms?.length || 0} gyms`);

      if (!data.success) {
        throw new Error(data.error || 'Erro desconhecido na busca');
      }

      return (data.gyms || []).map((g: any) => ({
        place_id: g.id,
        name: g.name,
        vicinity: g.address,
        geometry: { location: { lat: g.lat, lng: g.lng } },
        rating: g.rating,
        photoUrl: g.photoUrl,
        photoReference: g.photoReference,
        distance: g.distance
      }));
    } catch (error: any) {
      console.error('[GymService] Error searching gyms:', error);
      throw error;
    }
  },

  /**
   * Busca por nome funciona com ou sem GPS. Quando há coordenadas elas são
   * usadas apenas como viés de relevância; sem elas o backend faz text search
   * normal, sem bloquear o usuário.
   */
  async searchGymsByText(query: string, lat?: number, lng?: number): Promise<any[]> {
    const clean = query.trim();
    if (!clean) return [];
    let url = `${API_CONFIG.baseUrl}/api/gyms?q=${encodeURIComponent(clean)}`;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      url += `&lat=${lat}&lng=${lng}`;
      console.log(`[GymService] Searching by text: "${clean}" near ${lat}, ${lng}`);
    } else {
      console.log(`[GymService] Searching by text without GPS: "${clean}"`);
    }
    return this.fetchGyms(url);
  },

  /**
   * Join a gym. The authenticated UID is captured before the token request and
   * checked again before and after the network mutation. A response started by
   * account A must never be consumed as if it belonged to account B after a
   * fast logout/login on the same device.
   *
   * Manual client-side gym creation was intentionally removed. Gym coordinates
   * become a geofence/security boundary, so unknown gyms must be resolved and
   * persisted by the authenticated backend instead of trusting client input.
   */
  async joinGym(gymData: {
    place_id: string;
    name: string;
    latitude: number;
    longitude: number;
    photo_url?: string;
    address?: string;
  }) {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');
    const expectedUid = user.uid;

    try {
      const idToken = await user.getIdToken();
      if (auth.currentUser?.uid !== expectedUid) {
        throw new Error('A conta mudou antes da atualização da academia. Tente novamente na conta correta.');
      }
      const response = await fetch('/api/gyms/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          gym: {
            id: gymData.place_id,
            name: gymData.name,
            latitude: gymData.latitude,
            longitude: gymData.longitude,
            photo_url: gymData.photo_url,
            address: gymData.address
          }
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (auth.currentUser?.uid !== expectedUid) {
        throw new Error('A conta mudou durante a atualização da academia. Reabra o perfil da conta atual.');
      }
      if (!response.ok) {
        throw new Error(payload.error || 'Falha ao vincular academia.');
      }

      return { success: true, userId: expectedUid };
    } catch (error) {
      console.error('Error in joinGym:', error);
      throw error;
    }
  }
};