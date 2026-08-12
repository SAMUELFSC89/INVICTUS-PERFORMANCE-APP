import { cors, verifyAuth } from '../_lib/common.js';
import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 1800 }); // 30 minutes cache for gyms

export default async function handler(req: any, res: any) {
  const requestId = Math.random().toString(36).substring(7);
  
  if (cors(req, res)) return;

  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });

  try {
    const latStr = req.query.lat as string;
    const lngStr = req.query.lng as string;
    const q = req.query.q as string;
    const neighborhood = req.query.neighborhood as string;
    const city = req.query.city as string;

    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Latitude e longitude são obrigatórios' });
    }

    // Cache key based on coordinates (rounded to 3 decimal places ~110m accuracy)
    // and query term to save quota on repeated looks in the same area
    const roundedLat = lat.toFixed(3);
    const roundedLng = lng.toFixed(3);
    const cacheKey = q ? `gyms_search_${q}_${roundedLat}_${roundedLng}` : `gyms_nearby_${roundedLat}_${roundedLng}`;
    
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log(`[GymAPI][${requestId}] Returning cached results for ${cacheKey}`);
      return res.json(cached);
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'API key não configurada.' });
    }

    // Helpers for Legacy Google Places API
    const fetchPlacesLegacy = async (type: 'nearbysearch' | 'textsearch', params: Record<string, string>) => {
      const requestId_f = Math.random().toString(36).substring(7);
      const url = new URL(`https://maps.googleapis.com/maps/api/place/${type}/json`);
      Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));
      url.searchParams.append('key', apiKey);
      
      try {
        console.log(`[GymAPI][${requestId}][${requestId_f}] REQUEST: ${type} with params:`, params);
        
        const response = await fetch(url.toString());
        
        if (!response.ok) {
          const text = await response.text().catch(() => 'no body');
          console.error(`[GymAPI][${requestId}][${requestId_f}] HTTP ERROR:`, response.status, text);
          return [];
        }

        const data: any = await response.json();
        
        if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
          console.error(`[GymAPI][${requestId}][${requestId_f}] GOOGLE API STATUS ERROR:`, data.status, data.error_message || 'No error message');
          
          if (data.status === 'REQUEST_DENIED') {
            const isBillingError = data.error_message?.toLowerCase().includes('billing');
            return { 
              error: true, 
              status: data.status, 
              message: data.error_message,
              isBillingError 
            };
          }
        } else {
          console.log(`[GymAPI][${requestId}][${requestId_f}] GOOGLE API STATUS: ${data.status} (Results: ${data.results?.length || 0})`);
        }
        
        return data.results || [];
      } catch (err: any) {
        console.error(`[GymAPI][${requestId}][${requestId_f}] FETCH EXCEPTION:`, err.message);
        return [];
      }
    };

    const resultGyms = await (async () => {
      // Internal function to try the "New" Places API (V1) if legacy fails
      const tryPlacesV1 = async (q?: string) => {
        try {
          const url = `https://places.googleapis.com/v1/places:${q ? 'searchText' : 'searchNearby'}`;
          const body = q ? {
            textQuery: q,
            locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 15000.0 } }
          } : {
            locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 5000.0 } },
            includedTypes: ['gym']
          };

          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': apiKey,
              'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.photos'
            },
            body: JSON.stringify(body)
          });

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            if (data.error) {
              return { error: true, status: 'V1_ERROR', message: data.error.message };
            }
            return null;
          }
          const data = await response.json();
          return (data.places || []).map((p: any) => ({
            place_id: p.id,
            name: p.displayName?.text,
            vicinity: p.formattedAddress,
            geometry: { location: { lat: p.location.latitude, lng: p.location.longitude } },
            rating: p.rating,
            photos: p.photos
          }));
        } catch (e) {
          return null;
        }
      };

      if (q) {
        console.log(`[GymAPI][${requestId}] User searching for specific term: ${q}`);
        const legacy = await fetchPlacesLegacy('textsearch', {
          query: q,
          location: `${lat},${lng}`,
          radius: '20000'
        });
        
        if (legacy && (legacy as any).error) return legacy;
        if (!legacy || (legacy as any[]).length === 0) return await tryPlacesV1(q);
        return legacy;
      }

      // First try nearby search specifically within a broader radius for better discovery
      console.log(`[GymAPI][${requestId}] Primary search (5km radius)...`);
      let gyms = await fetchPlacesLegacy('nearbysearch', {
        location: `${lat},${lng}`,
        radius: '5000',
        type: 'gym'
      });

      if (gyms && (gyms as any).error) return gyms;

      // Also try with keyword 'academia' as it's very specific in Brazil
      if (!gyms || (gyms as any[]).length < 3) {
        const moreGyms = await fetchPlacesLegacy('nearbysearch', {
          location: `${lat},${lng}`,
          radius: '5000',
          keyword: 'academia'
        });
        
        if (moreGyms && !Array.isArray(moreGyms) && (moreGyms as any).error) return moreGyms;
        
        if (Array.isArray(moreGyms)) {
          const existingIds = new Set((gyms as any[] || []).map(g => g.place_id));
          moreGyms.forEach(g => {
            if (!existingIds.has(g.place_id)) {
              (gyms as any[]).push(g);
            }
          });
        }
      }

      // Fallback: Try V1 API if legacy is still thin
      if (!gyms || (gyms as any[]).length < 2) {
        const v1Results = await tryPlacesV1();
        if (v1Results && (v1Results as any).error) return v1Results;
        if (v1Results && Array.isArray(v1Results)) {
           const existingIds = new Set((gyms as any[] || []).map(g => g.place_id));
           v1Results.forEach(g => {
            if (!existingIds.has(g.place_id)) {
              (gyms as any[]).push(g);
            }
          });
        }
      }

      // Fallback 1: try neighborhood text search (up to 5km)
      if ((!gyms || (gyms as any[]).length === 0) && neighborhood) {
        const query = `${neighborhood} academia`;
        console.log(`[GymAPI][${requestId}] Trying text search for neighborhood: ${query}`);
        gyms = await fetchPlacesLegacy('textsearch', {
          query,
          location: `${lat},${lng}`,
          radius: '5000'
        });
        if (gyms && (gyms as any).error) return gyms;
      }

      // Fallback 2: Broader search if still empty
      if (!gyms || (gyms as any[]).length === 0) {
        const query = [city, 'academia fitness'].filter(Boolean).join(' ');
        console.log(`[GymAPI][${requestId}] No immediate results, trying broader city search: ${query}`);
        gyms = await fetchPlacesLegacy('textsearch', {
          query,
          location: `${lat},${lng}`,
          radius: '10000'
        });
        if (gyms && (gyms as any).error) return gyms;
      }
      
      // Fallback 3: Last resort (extreme radius)
      if (!gyms || (gyms as any[]).length === 0) {
        console.log(`[GymAPI][${requestId}] Last resort: wide area search...`);
        gyms = await fetchPlacesLegacy('textsearch', {
          query: 'academia',
          location: `${lat},${lng}`,
          radius: '20000'
        });
        if (gyms && (gyms as any).error) return gyms;
      }

      return gyms || [];
    })();

    if (resultGyms && (resultGyms as any).error) {
      const err = resultGyms as any;
      console.warn(`[GymAPI] Google API failed with error: ${err.message}. Providing robust local mock gyms fallback for uninterrupted testing.`);
      
      const mockNames = [
        "Invictus Prime Unidade Centro",
        "Invictus Club Unidade Jardins",
        "Academia Smart Fit - Proximidade",
        "Bluefit Academia Unidade Real",
        "Invictus Arena & Fitness"
      ];
      
      const fallbackGyms = mockNames.map((name, idx) => {
        const offsetLat = lat + (idx % 2 === 0 ? 0.0003 : -0.0003) * (idx + 1);
        const offsetLng = lng + (idx % 2 === 1 ? 0.0003 : -0.0003) * (idx + 1);
        const distance = calculateDistance({ lat, lng }, { lat: offsetLat, lng: offsetLng });
        
        return {
          id: `mock_gym_${idx + 1}_${roundedLat.replace('.', '')}`,
          name,
          address: `Rua do Esporte Real, ${100 * (idx + 1)}, Bairro Fitness - Fallback`,
          lat: offsetLat,
          lng: offsetLng,
          rating: 4.8,
          photoUrl: null,
          distance,
          score: distance
        };
      });
      
      return res.status(200).json({
        success: true,
        count: fallbackGyms.length,
        gyms: fallbackGyms,
        isDemoFallback: true,
        originalError: err.message,
        tip: err.isBillingError 
          ? 'Modo de simulação ativo: Sua conta do Google Cloud precisa de faturamento ativo. Ative em: https://console.cloud.google.com/billing' 
          : 'Modo de simulação ativo: Verifique se a Places API está ativada no seu console do Google Cloud.'
      });
    }

    const gymsArray = Array.isArray(resultGyms) ? resultGyms : [];
    const formatted = gymsArray.map((g: any) => {
      const gLat = g.geometry?.location?.lat;
      const gLng = g.geometry?.location?.lng;
      const distance = calculateDistance({lat, lng}, {lat: gLat, lng: gLng});
      const gymAddress = (g.vicinity || g.formatted_address || '').toLowerCase();
      
      // Neighborhood match score (for better sorting)
      let score = distance;
      if (neighborhood && gymAddress.includes(neighborhood.toLowerCase())) {
        score -= 0.5; // Slight boost for being in the same neighborhood
      }

      // Robust photo URL generation
      let photoUrl = null;
      if (g.photos?.[0]) {
        const photo = g.photos[0];
        const ref = photo.photo_reference || photo.name;
        
        if (ref) {
          const isV1 = ref.startsWith('places/');
          const isValidV1 = isV1 && ref.includes('/photos/');
          const isLegacy = !isV1 && ref.length > 20; // Ref is usually long

          if (isValidV1 || isLegacy) {
            photoUrl = `/api/gyms/photo?ref=${encodeURIComponent(ref)}`;
          }
        }
      }

      return {
        id: g.place_id,
        name: g.name || 'Academia',
        address: g.vicinity || g.formatted_address || 'N/A',
        lat: gLat,
        lng: gLng,
        rating: g.rating || null,
        photoUrl,
        distance,
        score
      };
    });

    formatted.sort((a: any, b: any) => a.score - b.score);

    const finalResult = {
      success: true,
      count: formatted.length,
      gyms: formatted,
      requestId
    };

    cache.set(cacheKey, finalResult);
    return res.status(200).json(finalResult);

  } catch (error) {
    console.error('SERVERLESS_GYMS_ERROR:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno no servidor'
    });
  }
}

function calculateDistance(p1: any, p2: any) {
  const rad = (x: number) => x * Math.PI / 180;
  const R = 6371;
  const dLat = rad(p2.lat - p1.lat);
  const dLng = rad(p2.lng - p1.lng);
  
  if (isNaN(dLat) || isNaN(dLng)) return 999;
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(rad(p1.lat)) * Math.cos(rad(p2.lat)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
