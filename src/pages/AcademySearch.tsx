import { FormEvent, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Building2, MapPin, Plus, RefreshCw, Search, ShieldCheck, Trophy, UserRound, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { gymService } from '../services/gymService';
import { getCurrentLocation } from '../lib/locationUtils';
import { useUser } from '../UserContext';
import { InvictusLogo } from '../components/InvictusLogo';
import './ProfileSecondary.css';

type GeoContext = { lat: number; lng: number; neighborhood?: string; city?: string };

export function AcademySearch() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [query, setQuery] = useState('');
  const [gyms, setGyms] = useState<any[]>([]);
  const [geo, setGeo] = useState<GeoContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [gymError, setGymError] = useState('');
  const [locationNotice, setLocationNotice] = useState('');

  const go = (path: string, state?: unknown) => navigate(path, { state });

  const savedGeo = useCallback((): GeoContext | null => {
    const saved = (user as any)?.gymLocation;
    if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng)) {
      return { lat: saved.lat, lng: saved.lng };
    }
    return null;
  }, [user]);

  const resolveGeoContext = useCallback(async (): Promise<GeoContext> => {
    const point = await getCurrentLocation(true);
    let neighborhood: string | undefined;
    let city: string | undefined;
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${point.lat}&lon=${point.lng}&zoom=18&addressdetails=1`);
      const address = (await response.json())?.address || {};
      neighborhood = address.suburb || address.neighbourhood || address.district || address.city_district || undefined;
      city = address.city || address.town || address.village || address.municipality || undefined;
    } catch {
      // Contexto textual é opcional. O Nearby continua funcionando com lat/lng.
    }
    const context = { lat: point.lat, lng: point.lng, neighborhood, city };
    setGeo(context);
    return context;
  }, []);

  const loadNearby = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setGymError('');
    setLocationNotice('');
    try {
      let context: GeoContext;
      try {
        context = await resolveGeoContext();
      } catch {
        const saved = savedGeo();
        if (!saved) {
          setGyms([]);
          setLocationNotice('Localização indisponível. Você ainda pode buscar qualquer academia pelo nome sem ativar o GPS.');
          return;
        }
        context = saved;
        setGeo(saved);
        setLocationNotice('Usando a última localização conhecida para mostrar academias próximas.');
      }
      const result = await gymService.searchNearbyGyms(context.lat, context.lng, context.neighborhood, context.city);
      setGyms(result);
    } catch (error: any) {
      setGymError(error?.message || 'Não foi possível localizar academias próximas.');
    } finally {
      setLoading(false);
    }
  }, [loading, resolveGeoContext, savedGeo]);

  useEffect(() => {
    void loadNearby();
    // Executa somente na entrada. Repetições são iniciadas explicitamente pelo usuário.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const searchGym = async (event: FormEvent) => {
    event.preventDefault();
    const clean = query.trim();
    if (!clean || loading) return;
    setLoading(true);
    setGymError('');
    setLocationNotice('');
    try {
      const context = geo || savedGeo();
      const result = await gymService.searchGymsByText(clean, context?.lat, context?.lng);
      setGyms(result);
      if (!context) setLocationNotice('Busca realizada pelo nome, sem usar sua localização.');
    } catch (error: any) {
      setGymError(error?.message || 'Busca indisponível no momento.');
    } finally {
      setLoading(false);
    }
  };

  const rows = gyms.map((gym) => {
    const distance = Number(gym.distance);
    const detail = `${gym.vicinity || gym.address || 'Endereço não informado'}${Number.isFinite(distance) && distance >= 0 ? ` · ${distance.toFixed(1)} km` : ''}`;
    return <button
      key={gym.place_id || gym.id || `${gym.name}-${detail}`}
      className="profile-flow-row"
      onClick={() => go('/profile/academy/confirm', { gym })}
      type="button"
    >
      <span className="profile-flow-row-icon"><Building2 /></span>
      <span><b>{gym.name}</b><small>{detail}</small></span>
      <MapPin />
    </button>;
  });

  return createPortal(
    <main className="profile-flow-screen profile-flow-screen-new">
      <header>
        <button onClick={() => navigate('/profile/academy')} aria-label="Voltar"><ArrowLeft /></button>
        <div><InvictusLogo size={40}/><span><b>INVICTUS</b><small>PERFORMANCE</small></span></div>
        <span />
      </header>

      <section className="profile-flow-heading"><small>PERFIL E CONTA</small><h1>ALTERAR ACADEMIA</h1></section>
      <div className="profile-flow-content">
        <form className="profile-flow-search" onSubmit={searchGym}>
          <Search />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar academia por nome" />
          <button aria-label="Buscar academia" disabled={loading}><Search /></button>
        </form>

        <p className="profile-flow-section-label">{query.trim() ? 'RESULTADOS' : 'ACADEMIAS PRÓXIMAS'}</p>
        {loading && <p className="profile-flow-muted">Buscando academias…</p>}
        {!loading && locationNotice && <p className="profile-flow-muted"><MapPin /> {locationNotice}</p>}
        {!loading && gymError && <p className="profile-flow-notice"><X />{gymError}</p>}
        {!loading && <section className="profile-flow-list">{rows}</section>}
        {!loading && !gymError && !gyms.length && <p className="profile-flow-muted">Nenhuma academia encontrada. Tente buscar pelo nome completo ou inclua a cidade.</p>}
        {!loading && !query.trim() && <button className="profile-flow-primary" onClick={() => void loadNearby()}><RefreshCw /> LOCALIZAR PRÓXIMAS</button>}
      </div>

      <nav className="profile-flow-footer">
        <button onClick={() => go('/')}><InvictusLogo size={23}/><span>Início</span></button>
        <button onClick={() => go('/championships')}><Trophy/><span>Campeonatos</span></button>
        <button className="is-plus" onClick={() => go('/activity')} aria-label="Escolher modalidade"><Plus/></button>
        <button onClick={() => go('/challenges')}><ShieldCheck/><span>Desafios</span></button>
        <button className="is-active" onClick={() => go('/profile')}><UserRound/><span>Perfil</span></button>
      </nav>
    </main>,
    document.body,
  );
}

export default AcademySearch;
