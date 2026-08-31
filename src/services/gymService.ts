import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  setDoc, 
  updateDoc, 
  serverTimestamp, 
  orderBy, 
  limit,
  addDoc
} from 'firebase/firestore';
import { Gym, UserProfile, RankingEntry } from '../types';
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
          const error = new Error(errData.error || `Erro no servidor (Status: ${response.status})`);
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
      
      // Adapt the new format to the component's expectations
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
   * Search for gyms by text query (Unified in new backend)
   */
  async searchGymsByText(query: string, lat: number, lng: number): Promise<any[]> {
    console.log(`[GymService] Searching by text: "${query}" near ${lat}, ${lng}`);
    return this.searchNearbyGyms(lat, lng, undefined, undefined, query);
  },

  /**
   * Join a gym
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

    try {
      // Use secure backend API instead of direct client-side write
      const idToken = await user.getIdToken();
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

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Falha ao vincular academia.');
      }

      return { success: true };
    } catch (error) {
      console.error('Error in joinGym:', error);
      throw error;
    }
  },

  /**
   * Register a gym manually (Fallback)
   */
  async registerGymManual(data: {
    name: string;
    latitude: number;
    longitude: number;
    address?: string;
    photo_url?: string;
  }) {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    try {
      const gymId = `manual_${Math.random().toString(36).substring(7)}`;
      const gymRef = doc(db, 'gyms', gymId);
      
      await setDoc(gymRef, {
        ...data,
        id: gymId,
        place_id: gymId,
        createdAt: new Date().toISOString()
      });

      // Update user
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        gymId: gymId,
        gymName: data.name,
        gymLocation: { lat: data.latitude, lng: data.longitude },
        updatedAt: serverTimestamp()
      });

      return { success: true, gymId };
    } catch (error) {
      console.error('Error registering gym manually:', error);
      throw error;
    }
  }
};
