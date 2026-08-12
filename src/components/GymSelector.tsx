import React, { useState, useEffect } from 'react';
import { MapPin, Search, Navigation, Plus, Check, AlertCircle, Loader2, Dumbbell, ChevronRight } from 'lucide-react';
import { gymService } from '../services/gymService';
import { useUser } from '../UserContext';
import { API_CONFIG } from '../config';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { getCurrentLocation } from '../lib/locationUtils';
import { requestAllNativePermissions } from '../lib/nativePermissions';
import { auth } from '../firebase';

export function GymSelector({ onSelect }: { onSelect?: () => void }) {
  const { user } = useUser();
  const [loading, setLoading] = useState(false);
  const [gyms, setGyms] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [neighborhood, setNeighborhood] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [diagnostic, setDiagnostic] = useState<any>(null);
  const [billingTip, setBillingTip] = useState<string | null>(null);
  const [selectedGym, setSelectedGym] = useState<any | null>(null);

  // Iniciar busca automática ao montar o componente
  useEffect(() => {
    requestLocation();
  }, []);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setLoading(true);
    setError(null);
    setBillingTip(null);
    setSelectedGym(null);
    try {
      const searchLocation = location || { lat: -23.55052, lng: -46.633308 };
      const results = await gymService.searchNearbyGyms(
        searchLocation.lat,
        searchLocation.lng,
        neighborhood || undefined,
        city || undefined,
        searchQuery
      );
      setGyms(results);
      if (results.length === 0) {
        setError(`Nenhuma academia encontrada para "${searchQuery}" nesta região.`);
      }
    } catch (err: any) {
      setError(err.message || 'Erro na busca.');
      if (err.tip) setBillingTip(err.tip);
    } finally {
      setLoading(false);
    }
  };

  const requestLocation = async () => {
    setLoading(true);
    setError(null);
    setBillingTip(null);
    setAddress(null);
    setNeighborhood(null);
    setCity(null);
    setAccuracy(null);
    try {
      try {
        await requestAllNativePermissions();
      } catch (e) {
        console.warn('[GymSelector] requestAllNativePermissions error:', e);
      }

      // Check for permission state if supported
      if (typeof navigator !== 'undefined' && 'permissions' in navigator) {
        try {
          const status = await navigator.permissions.query({ name: 'geolocation' as any });
          if (status.state === 'denied') {
            throw new Error('Permissão de localização negada. Ative nas configurações do navegador.');
          }
        } catch (e) {
          // Ignore if permission query is not supported for geolocation
        }
      }

      const loc = await getCurrentLocation(true); 
      setLocation(loc);
      if (loc.accuracy) setAccuracy(loc.accuracy);
      
      // Reverse geocoding with detailed address handling
      let finalNeighborhood = null;
      let finalCity = null;

      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${loc.lat}&lon=${loc.lng}&zoom=18&addressdetails=1`);
        const data = await response.json();
        
        const addr = data.address || {};
        finalNeighborhood = addr.suburb || addr.neighbourhood || addr.district || addr.city_district || '';
        finalCity = addr.city || addr.town || addr.village || addr.municipality || '';
        
        setNeighborhood(finalNeighborhood);
        setCity(finalCity);
        
        const detectedName = finalNeighborhood && finalCity 
          ? `${finalNeighborhood}, ${finalCity}` 
          : (data.display_name?.split(',')[0] || 'Sua Localização');
          
        setAddress(detectedName);
        console.log(`[DEBUG] GymSelector: Location context:`, { neighborhood: finalNeighborhood, city: finalCity, accuracy: loc.accuracy });
      } catch (e) {
        console.warn('Reverse geocoding failed', e);
      }

      searchGyms(loc.lat, loc.lng, finalNeighborhood || undefined, finalCity || undefined);
    } catch (err: any) {
      console.error('Location request failed:', err);
      setError(err.message || 'Erro ao obter localização.');
      if (err.tip) setBillingTip(err.tip);
      setLoading(false);
    }
  };

  const searchGyms = async (lat: number, lng: number, neighborhoodContext?: string, cityContext?: string) => {
    setLoading(true);
    setError(null);
    setBillingTip(null);
    setSelectedGym(null);
    try {
      const n = neighborhoodContext || neighborhood;
      const c = cityContext || city;

      console.log('Searching gyms with context:', { lat, lng, neighborhood: n, city: c });
      // Pass neighborhood and city to bias search results
      const results = await gymService.searchNearbyGyms(lat, lng, n || undefined, c || undefined);
      setGyms(results);
      
      // Try to get diagnostic info if results are potentially problematic
      if (results.length === 0) {
        try {
          const user = auth.currentUser;
          const headers: Record<string, string> = {
            'Content-Type': 'application/json'
          };
          if (user) {
            const token = await user.getIdToken();
            headers['Authorization'] = `Bearer ${token}`;
          }

          const diagRes = await fetch(`${API_CONFIG.baseUrl}/api/gyms?check=health`, { headers });
          if (diagRes.ok) {
            const diagData = await diagRes.json();
            setDiagnostic(diagData);
            if (diagData.is_denied) {
               setBillingTip('Suas chaves do Google Maps estão sendo negadas. Verifique se o faturamento (Billing) está ativo no Cloud Console.');
            }
          }
        } catch (e) {
          console.error('Failed to get diagnostic info', e);
        }
      } else {
        setDiagnostic(null);
      }
    } catch (err: any) {
      console.error('Gym search failed:', err);
      setError(err.message || 'Erro ao conectar ao serviço de busca.');
      if (err.tip) setBillingTip(err.tip);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinGym = async (gym: any) => {
    const gymId = gym.place_id || gym.id;
    const rawLat = gym.geometry?.location?.lat !== undefined 
      ? (typeof gym.geometry.location.lat === 'function' ? gym.geometry.location.lat() : gym.geometry.location.lat)
      : (gym.lat ?? gym.latitude);
    const rawLng = gym.geometry?.location?.lng !== undefined 
      ? (typeof gym.geometry.location.lng === 'function' ? gym.geometry.location.lng() : gym.geometry.location.lng)
      : (gym.lng ?? gym.longitude);

    const gymLat = rawLat !== undefined ? Number(rawLat) : undefined;
    const gymLng = rawLng !== undefined ? Number(rawLng) : undefined;
    const gymAddress = gym.vicinity || gym.address || 'N/A';

    // Defensive check
    if (!gymId || gymLat === undefined || gymLng === undefined) {
      setError('Dados da academia incompletos.');
      return;
    }

    setLoading(true);
    try {
      await gymService.joinGym({
        place_id: gymId,
        name: gym.name,
        latitude: gymLat,
        longitude: gymLng,
        photo_url: gym.photoUrl,
        address: gymAddress
      });
      if (onSelect) onSelect();
    } catch (err: any) {
      let errorMsg = err.message;
      if (err.message && err.message.startsWith('{')) {
        try {
          const parsed = JSON.parse(err.message);
          if (parsed.error && parsed.error.includes('permission-denied')) {
            errorMsg = 'Permissão negada no Firestore. Contate o administrador.';
          } else {
            errorMsg = parsed.error || err.message;
          }
        } catch (e) {
          // Fallback to raw message
        }
      }
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const calculateDistance = (lat2: number, lng2: number) => {
    if (!location || !lat2 || !lng2) return null;
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - location.lat);
    const dLon = deg2rad(lng2 - location.lng);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(deg2rad(location.lat)) * Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d.toFixed(1);
  };

  const deg2rad = (deg: number) => deg * (Math.PI / 180);

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center text-center space-y-2">
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary">
          <Dumbbell size={32} />
        </div>
        <h2 className="font-headline italic font-black text-2xl uppercase tracking-tight text-on-surface">
          {user?.gymId ? 'TROCAR DE ACADEMIA' : 'ENCONTRE SUA ACADEMIA'}
        </h2>
        <p className="text-on-surface-variant font-label text-xs uppercase tracking-widest max-w-xs">
          Participe de rankings exclusivos e desafios dentro da sua unidade.
        </p>
      </div>

      <div className="space-y-4 mb-8">
        <div className="flex flex-col gap-2">
          <button
            onClick={requestLocation}
            disabled={loading}
            className="w-full group relative overflow-hidden bg-primary/10 border-2 border-primary/20 p-4 sm:p-5 rounded-[1.5rem] sm:rounded-[2rem] flex flex-col items-center justify-center gap-1 hover:bg-primary/20 transition-all active:scale-[0.98]"
          >
            {loading ? (
              <div className="flex items-center gap-3 py-1">
                <Loader2 className="animate-spin text-primary" size={20} />
                <span className="font-headline italic font-black text-base text-primary uppercase tracking-widest">LOCALIZANDO...</span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <Navigation className="text-primary group-hover:rotate-12 transition-transform w-4 h-4" size={20} fill="currentColor" />
                  <span className="font-headline italic font-black text-base text-on-surface uppercase tracking-widest">MINHA LOCALIZAÇÃO</span>
                </div>
                {address && (
                  <div className="flex flex-col gap-0.5 animate-in fade-in slide-in-from-bottom-1 items-center">
                    <div className="flex items-center gap-1.5 text-primary">
                      <MapPin size={10} />
                      <span className="font-label text-[10px] font-black uppercase tracking-widest">{address}</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </button>
          
          {address && !loading && (
            <div className="px-4 py-2 bg-on-surface/[0.03] rounded-xl flex items-center justify-center gap-2 border border-outline-variant/5">
              <div className="w-1.5 h-1.5 bg-[#00E676] rounded-full animate-pulse" />
              <p className="font-label text-[8px] font-black text-on-surface-variant uppercase tracking-[0.1em]">
                BUSCANDO EM: <span className="text-primary">{neighborhood || city || 'ESTA REGIÃO'}</span>
              </p>
            </div>
          )}
        </div>

        <div className="relative">
          <form onSubmit={handleSearch} className="relative">
            <input 
              type="text"
              placeholder="PESQUISAR NOME OU BAIRRO..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-surface-container-high border-2 border-outline-variant/10 rounded-[1.5rem] sm:rounded-3xl py-3.5 sm:py-4 pl-12 pr-4 font-label text-[11px] sm:text-[12px] font-black uppercase tracking-widest text-on-surface focus:border-primary/50 focus:outline-none placeholder:text-on-surface-variant/30 transition-all shadow-inner"
            />
            <button 
              type="submit"
              className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant/30"
            >
              <Search size={20} />
            </button>
            {searchQuery && (
              <button 
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant/30"
              >
                <Plus size={20} className="rotate-45" />
              </button>
            )}
          </form>
        </div>
      </div>

      {accuracy && accuracy > 300 && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-prize-gold/10 border border-prize-gold/30 p-4 rounded-2xl flex items-start gap-3"
        >
          <AlertCircle className="text-prize-gold shrink-0 mt-0.5" size={16} />
          <div className="space-y-1">
            <p className="font-label text-[10px] font-black text-prize-gold uppercase tracking-widest">SINAL DE GPS IMPRECISO ({Math.round(accuracy)}m)</p>
            <p className="font-label text-[9px] font-bold text-on-surface-variant uppercase leading-relaxed">
              Sua localização está oscilando. Se as academias abaixo não forem as mais próximas, tente digitar o nome da sua academia na busca ou vá para um local com melhor sinal.
            </p>
          </div>
        </motion.div>
      )}

      <AnimatePresence>
        {loading && !gyms.length && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="flex flex-col items-center justify-center py-16 space-y-6"
          >
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full" />
              <div className="relative w-20 h-20 bg-surface-container-high rounded-full flex items-center justify-center shadow-2xl">
                <Loader2 className="animate-spin text-primary" size={40} />
              </div>
            </div>
            <div className="text-center">
              <p className="font-headline italic font-black text-xl text-primary uppercase tracking-tighter animate-pulse">RASTREANDO ACADEMIAS</p>
              <p className="text-on-surface-variant/60 font-label text-[10px] font-black uppercase mt-1 tracking-widest">SINCRONIZANDO COM GOOGLE PLACES...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {billingTip && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-error/10 border-2 border-error/30 p-5 rounded-3xl space-y-3"
        >
          <div className="flex items-center gap-3 text-error">
            <AlertCircle size={24} />
            <p className="font-headline italic font-black text-sm uppercase tracking-widest">AÇÃO NECESSÁRIA NO GOOGLE CLOUD</p>
          </div>
          <p className="text-on-surface font-label text-[10px] font-bold uppercase leading-relaxed">
            {billingTip}
          </p>
          <a 
            href="https://console.cloud.google.com/billing" 
            target="_blank" 
            rel="noopener noreferrer"
            className="block text-center bg-error text-on-error py-3 rounded-xl font-label text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-opacity"
          >
            ABRIR CONSOLE DE FATURAMENTO
          </a>
        </motion.div>
      )}

      {error && (
        <div className="space-y-4">
          <div className="bg-error/10 border border-error/20 p-4 rounded-2xl flex items-center gap-3 text-error">
            <AlertCircle size={20} />
            <p className="font-label text-[10px] font-bold uppercase tracking-tight">{error}</p>
          </div>
          {error.includes('Permissão') ? (
            <div className="bg-surface-container-high p-4 rounded-2xl text-[9px] text-on-surface-variant font-label uppercase tracking-widest leading-relaxed text-center">
              Dica: Clique no ícone de "Cadeado" ou "Configurações" na barra de endereços do seu navegador e mude "Localização" para "Permitir".
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <p className="text-on-surface-variant font-label text-[9px] uppercase font-bold text-center">Sua localização pode estar imprecisa ou o GPS falhou.</p>
              <button
                onClick={requestLocation}
                className="text-primary font-headline italic font-black text-xs uppercase tracking-widest flex items-center gap-2 hover:underline p-2"
              >
                <Navigation size={14} />
                TENTAR LOCALIZAR NOVAMENTE
              </button>
            </div>
          )}
        </div>
      )}

      {!loading && gyms.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
          <div className="w-16 h-16 bg-surface-container-high rounded-full flex items-center justify-center text-on-surface-variant/30">
            <Search size={32} />
          </div>
          <div>
            <p className="font-headline italic font-black text-lg text-on-surface uppercase tracking-tight">NENHUMA ACADEMIA POR PERTO</p>
            <p className="text-on-surface-variant font-label text-[10px] uppercase font-bold mt-1">NÃO ENCONTRAMOS UNIDADES VALIDADAS NUM RAIO DE 30KM.</p>
            <p className="text-on-surface-variant/60 font-label text-[8px] uppercase font-bold mt-2">DICA: Tente digitar o nome da academia na busca acima.</p>
          </div>
          <div className="flex flex-col gap-2 w-full max-w-xs px-6">
            <button
              onClick={requestLocation}
              className="bg-primary text-on-primary px-8 py-3 rounded-full font-label text-[10px] font-black uppercase tracking-widest shadow-lg active:scale-95 transition-all w-full"
            >
              REESCANEAR ÁREA
            </button>
            <button
              onClick={() => {
                setSearchQuery('Academia');
                setTimeout(() => handleSearch(), 100);
              }}
              className="text-primary font-label text-[10px] font-black uppercase tracking-widest p-2 hover:underline"
            >
              FORÇAR BUSCA POR TEXTO
            </button>
          </div>
        </div>
      )}

      {diagnostic && !loading && gyms.length === 0 && (
        <div className="mt-4 p-4 bg-surface-container-high rounded-xl w-full max-w-md mx-auto text-left border border-outline-variant/10">
          <p className="font-label text-[8px] font-black text-on-surface-variant uppercase mb-2">Painel de Diagnóstico API</p>
          <div className="space-y-1 font-mono text-[7px] text-on-surface-variant/70 uppercase">
            <p>Status API: <span className={diagnostic.success ? "text-green-500" : "text-red-500"}>{diagnostic.success ? 'ONLINE' : 'OFFLINE'}</span></p>
            <p>Google Legacy: <span className={diagnostic.legacy_v1_status === 'OK' ? "text-green-500" : "text-yellow-500"}>{diagnostic.legacy_v1_status || 'DESCONHECIDO'}</span></p>
            <p>Google New (V1): <span className={diagnostic.new_v1_status === 'OK' ? "text-green-500" : "text-yellow-500"}>{diagnostic.new_v1_status || 'DESCONHECIDO'}</span></p>
            
            {diagnostic.legacy_v1_status === 'REQUEST_DENIED' && (
              <div className="mt-4 p-3 bg-error/10 border border-error/20 rounded-lg">
                <p className="text-error font-bold mb-1">AÇÃO NECESSÁRIA NO CONSOLE GOOGLE:</p>
                <p className="normal-case text-[10px] leading-tight text-on-surface-variant">
                  Sua chave API está funcionando, mas as permissões do Places API estão desativadas.
                </p>
                <ul className="list-disc pl-4 mt-2 normal-case text-[9px] space-y-1 text-on-surface-variant/80">
                  <li>Ative a <strong>Places API</strong></li>
                  <li>Ative a <strong>Places API (New)</strong></li>
                  <li>Verifique em "Credentials" se a chave não possui restrições de API que bloqueiam o Places.</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {[...gyms]
          .sort((a, b) => {
            const aLat = a.geometry?.location?.lat !== undefined ? a.geometry.location.lat : a.lat;
            const aLng = a.geometry?.location?.lng !== undefined ? a.geometry.location.lng : a.lng;
            const bLat = b.geometry?.location?.lat !== undefined ? b.geometry.location.lat : b.lat;
            const bLng = b.geometry?.location?.lng !== undefined ? b.geometry.location.lng : b.lng;
            const distA = parseFloat(calculateDistance(aLat, aLng) || '999');
            const distB = parseFloat(calculateDistance(bLat, bLng) || '999');
            return distA - distB;
          })
          .map((gym, index) => {
            const gymId = gym.place_id || gym.id;
            const gymLat = gym.geometry?.location?.lat !== undefined ? gym.geometry.location.lat : gym.lat;
            const gymLng = gym.geometry?.location?.lng !== undefined ? gym.geometry.location.lng : gym.lng;
            const isCurrentGym = user?.gymId === gymId;
            const isSelected = selectedGym && (selectedGym.place_id || selectedGym.id) === gymId;
            const distance = calculateDistance(gymLat, gymLng);

          return (
            <motion.div
              key={gymId}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              onClick={() => {
                if (!isCurrentGym) {
                  setSelectedGym(gym);
                }
              }}
              className={cn(
                "w-full p-3.5 sm:p-5 rounded-[2rem] sm:rounded-[2.5rem] flex flex-col gap-3 transition-all group relative overflow-hidden shadow-md border text-left cursor-pointer",
                isCurrentGym 
                  ? "bg-primary/5 border-primary/40 cursor-default" 
                  : isSelected
                    ? "bg-primary/10 border-primary ring-2 ring-primary/20 scale-[1.01]" 
                    : "bg-surface-container-low border-outline-variant/10 hover:border-primary/40 hover:bg-surface-container"
              )}
            >
              {isCurrentGym && (
                <div className="absolute top-0 right-0 px-3 sm:px-4 py-1 bg-primary text-on-primary font-label text-[7px] sm:text-[8px] font-black uppercase tracking-[0.2em] rounded-bl-2xl shadow-lg z-10">
                  SUA UNIDADE ATUAL
                </div>
              )}
              {isSelected && !isCurrentGym && (
                <div className="absolute top-0 right-0 px-3 sm:px-4 py-1 bg-primary text-on-primary font-label text-[7px] sm:text-[8px] font-black uppercase tracking-[0.2em] rounded-bl-2xl shadow-lg z-10 flex items-center gap-1">
                  <Check size={8} /> SELECIONADO
                </div>
              )}
              
              <div className="flex items-center gap-3 sm:gap-6 w-full">
                <div className="w-16 h-16 sm:w-20 sm:h-20 bg-surface-container-high rounded-[1.2rem] sm:rounded-[1.5rem] overflow-hidden flex-shrink-0 border border-outline-variant/10 shadow-inner group-hover:shadow-none transition-shadow">
                  {gym.photoUrl ? (
                    <img 
                      src={gym.photoUrl}
                      alt={gym.name}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                      referrerPolicy="no-referrer"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-on-surface-variant/30">
                      <Dumbbell size={28} strokeWidth={1.5} className="sm:hidden" />
                      <Dumbbell size={32} strokeWidth={1.5} className="hidden sm:block" />
                    </div>
                  )}
                </div>
   
                <div className="flex-1 text-left min-w-0">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mb-1 sm:mb-2">
                    <h4 className={cn(
                      "font-headline italic font-black text-base sm:text-xl truncate uppercase tracking-tight transition-colors",
                      isCurrentGym ? "text-primary" : "text-on-surface group-hover:text-primary"
                    )}>
                      {gym.name}
                    </h4>
                    {gym.rating && (
                      <div className="flex items-center gap-0.5 px-2 py-0.5 bg-prize-gold/10 rounded-full w-fit">
                        <span className="text-prize-gold text-[8px] sm:text-[9px] font-black italic">
                          {gym.rating}
                        </span>
                        <span className="text-prize-gold text-[8px]">★</span>
                      </div>
                    )}
                  </div>
                  
                  <p className="text-on-surface-variant font-label text-[8px] sm:text-[9px] uppercase font-bold truncate opacity-40 mb-2 sm:mb-4 flex items-center gap-1">
                    <MapPin size={10} className="shrink-0" />
                    {gym.vicinity}
                  </p>
   
                  <div className="flex items-center gap-2 sm:gap-3">
                    <span className={cn(
                      "font-label text-[8px] sm:text-[9px] font-black px-2.5 sm:px-4 py-1 rounded-full uppercase tracking-wider shadow-sm border",
                      isCurrentGym 
                        ? "bg-primary text-on-primary border-primary/20" 
                        : "bg-surface-container-high text-on-surface-variant border-outline-variant/10"
                    )}>
                      {distance} KM
                    </span>
                    {!isCurrentGym && !isSelected && (
                      <span className="text-[7px] sm:text-[8px] font-black text-primary uppercase tracking-[0.2em] opacity-0 group-hover:opacity-100 transition-all sm:translate-x-[-10px] sm:group-hover:translate-x-0 hidden sm:block">
                        SELECIONAR &rsaquo;
                      </span>
                    )}
                  </div>
                </div>
   
                {!isCurrentGym && (
                  <div className={cn(
                    "w-8 h-8 sm:w-11 sm:h-11 rounded-full flex items-center justify-center transition-all shadow-sm shrink-0",
                    isSelected
                      ? "bg-primary text-on-primary rotate-0"
                      : "bg-surface-container-high text-on-surface-variant group-hover:bg-primary group-hover:text-on-primary group-hover:rotate-[-10deg]"
                  )}>
                    {isSelected ? (
                      <>
                        <Check size={18} className="sm:hidden" />
                        <Check size={22} className="hidden sm:block" />
                      </>
                    ) : (
                      <>
                        <ChevronRight size={18} className="sm:hidden" />
                        <ChevronRight size={22} className="hidden sm:block" />
                      </>
                    )}
                  </div>
                )}
              </div>

              {isSelected && !isCurrentGym && (
                <div className="mt-3 pt-3 border-t border-primary/20 animate-fade-in w-full">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleJoinGym(gym);
                    }}
                    disabled={loading}
                    className="w-full bg-primary text-black py-3 rounded-2xl font-headline italic font-black text-xs sm:text-sm uppercase tracking-wider hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary/20 cursor-pointer"
                  >
                    {loading ? (
                      <Loader2 className="animate-spin text-black" size={16} />
                    ) : (
                      <>
                        CONFIRMAR E VINCULAR ESTA UNIDADE <ChevronRight size={16} />
                      </>
                    )}
                  </button>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      <AnimatePresence>
        {selectedGym && (
          <motion.div
            initial={{ opacity: 0, y: 100, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 100, scale: 0.95 }}
            transition={{ type: "spring", damping: 20, stiffness: 200 }}
            className="fixed bottom-24 sm:bottom-28 left-0 right-0 z-[60] px-4 md:px-6 max-w-sm sm:max-w-md mx-auto pointer-events-none"
          >
            <div className="bg-surface-container-high/95 backdrop-blur-2xl border border-primary/30 p-4 rounded-[2rem] sm:rounded-[2.5rem] shadow-[0_24px_50px_rgba(230,0,118,0.25)] pointer-events-auto flex flex-col gap-3">
              <div className="flex items-center gap-3 px-2">
                <div className="w-10 h-10 bg-primary/15 rounded-2xl flex items-center justify-center text-primary shrink-0 border border-primary/20">
                  <Dumbbell size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-label text-[8px] sm:text-[9px] font-black text-primary uppercase tracking-[0.2em] leading-none mb-1">
                    UNIDADE SELECIONADA
                  </p>
                  <h4 className="font-headline italic font-black text-xs sm:text-sm text-on-surface uppercase truncate leading-none mb-0.5">
                    {selectedGym.name}
                  </h4>
                  <p className="text-on-surface-variant/60 font-label text-[7px] sm:text-[8px] uppercase font-bold truncate">
                    {selectedGym.vicinity}
                  </p>
                </div>
              </div>
              
              <button
                onClick={() => handleJoinGym(selectedGym)}
                disabled={loading}
                className="w-full bg-primary text-on-primary py-3.5 sm:py-4 rounded-[1.5rem] sm:rounded-[2rem] font-headline italic font-black text-sm sm:text-base uppercase tracking-wider hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary/20"
              >
                {loading ? (
                  <Loader2 className="animate-spin text-on-primary" size={20} />
                ) : (
                  <>
                    CONFIRMAR E VINCULAR <ChevronRight size={20} />
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
