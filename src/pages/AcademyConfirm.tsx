import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Check, Plus, ShieldCheck, Trophy, UserRound } from 'lucide-react';
import { InvictusLogo } from '../components/InvictusLogo';
import { useUser } from '../UserContext';
import { gymService } from '../services/gymService';
import './ProfileSecondary.css';

type GymSelection = {
  place_id?: string;
  id?: string;
  name?: string;
  vicinity?: string;
  address?: string;
  photoUrl?: string;
  lat?: number;
  lng?: number;
  geometry?: { location?: { lat?: number | (() => number); lng?: number | (() => number) } };
};

function coordinate(value: number | (() => number) | undefined): number | null {
  const resolved = typeof value === 'function' ? value() : value;
  return Number.isFinite(resolved) ? Number(resolved) : null;
}

export function AcademyConfirm() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshUser } = useUser();
  const selectedGym = (location.state as { gym?: GymSelection } | null)?.gym || null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const confirmGym = async () => {
    if (!selectedGym || loading) return;
    const point = selectedGym.geometry?.location;
    const latitude = coordinate(point?.lat) ?? coordinate(selectedGym.lat);
    const longitude = coordinate(point?.lng) ?? coordinate(selectedGym.lng);
    const placeId = selectedGym.place_id || selectedGym.id;
    const name = selectedGym.name?.trim();

    if (!placeId || !name || latitude === null || longitude === null) {
      setError('A seleção da academia está incompleta. Volte à busca e selecione a academia novamente.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await gymService.joinGym({
        place_id: placeId,
        name,
        latitude,
        longitude,
        photo_url: selectedGym.photoUrl,
        address: selectedGym.vicinity || selectedGym.address,
      });
      await refreshUser?.();
      navigate('/profile', { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar sua academia.');
    } finally {
      setLoading(false);
    }
  };

  const go = (path: string) => navigate(path);

  return createPortal(
    <main className="profile-flow-screen profile-flow-screen-new">
      <header>
        <button onClick={() => navigate('/profile/academy/search')} aria-label="Voltar à busca de academias"><ArrowLeft /></button>
        <div><InvictusLogo size={40}/><span><b>INVICTUS</b><small>PERFORMANCE</small></span></div>
        <span />
      </header>

      <section className="profile-flow-heading"><small>PERFIL E CONTA</small><h1>ACADEMIA SELECIONADA</h1></section>
      <div className="profile-flow-content">
        {selectedGym ? <section className="profile-flow-confirm">
          <span><Building2 /></span>
          <Check className="profile-flow-confirm-check" />
          <p>Academia selecionada!</p>
          <h2>{selectedGym.name || 'Academia'}</h2>
          <small>{selectedGym.vicinity || selectedGym.address || 'Localização informada pela busca'}</small>
          {error ? <p className="profile-flow-notice" role="alert">{error}</p> : null}
          <button className="profile-flow-primary" disabled={loading} onClick={() => void confirmGym()}>{loading ? 'SALVANDO…' : 'DEFINIR COMO MINHA ACADEMIA'}</button>
          <button className="profile-flow-text" disabled={loading} onClick={() => navigate('/profile/academy/search')}>CANCELAR</button>
        </section> : <section className="profile-flow-confirm">
          <span><Building2 /></span>
          <h2>SELEÇÃO EXPIRADA</h2>
          <p>A academia escolhida não está mais disponível nesta tela. Isso pode acontecer após recarregar o app ou abrir este endereço diretamente.</p>
          <button className="profile-flow-primary" onClick={() => navigate('/profile/academy/search', { replace: true })}>ESCOLHER ACADEMIA</button>
        </section>}
      </div>

      <nav className="profile-flow-footer">
        <button onClick={() => go('/')}><InvictusLogo size={23}/><span>Início</span></button>
        <button onClick={() => go('/championships')}><Trophy/><span>Campeonatos</span></button>
        <button className="is-plus" onClick={() => go('/musculacao')}><Plus/></button>
        <button onClick={() => go('/challenges')}><ShieldCheck/><span>Desafios</span></button>
        <button className="is-active" onClick={() => go('/profile')}><UserRound/><span>Perfil</span></button>
      </nav>
    </main>,
    document.body,
  );
}

export default AcademyConfirm;
