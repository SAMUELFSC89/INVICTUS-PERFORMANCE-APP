import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Bell, CalendarDays, Check, Dumbbell, Plus, RefreshCw, ShieldCheck, Trophy, UserRound } from 'lucide-react';
import { InvictusLogo } from '../../components/InvictusLogo';
import { useUser } from '../../UserContext';
import { hasActiveProEntitlement } from '../../lib/proEntitlement';
import { communityChampionshipService } from '../../services/communityChampionshipService';
import { championshipService } from '../../services/championshipService';
import { powerLiftService } from '../../services/powerLiftService';
import {
  cardioPreviewCard,
  ChampionshipPreviewCard,
  FriendsChampionshipCard,
  FriendsRankingCard,
  PaidRankingCard,
  powerLiftRankingCard,
  PowerLiftFeatureCard,
  strengthPreviewCard,
} from './ChampionshipCards';
import './ChampionshipsNew.css';
import './ChampionshipsRound.css';

const PAID_CHAMPIONSHIP_IDS = ['invictus_strength_v1', 'invictus_cardio_v1'] as const;

type PaidParticipationState = Record<(typeof PAID_CHAMPIONSHIP_IDS)[number], boolean>;

export function ChampionshipsHub() {
  const navigate = useNavigate();
  const { user } = useUser();
  const paid = hasActiveProEntitlement(user);
  const [friendsEnrolled, setFriendsEnrolled] = useState<boolean | null>(null);
  const [friendsStatusError, setFriendsStatusError] = useState('');
  const [friendsStatusReload, setFriendsStatusReload] = useState(0);
  const [paidParticipation, setPaidParticipation] = useState<PaidParticipationState | null>(null);
  const [powerLiftParticipating, setPowerLiftParticipating] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPowerLiftParticipating(null);
    powerLiftService.hasParticipated()
      .then((participating) => { if (!cancelled) setPowerLiftParticipating(participating); })
      .catch(() => { if (!cancelled) setPowerLiftParticipating(false); });
    return () => { cancelled = true; };
  }, [user?.uid]);

  useEffect(() => {
    let cancelled = false;
    setFriendsEnrolled(null);
    setFriendsStatusError('');
    communityChampionshipService.status()
      .then((result) => { if (!cancelled) setFriendsEnrolled(result.enrolled === true); })
      .catch((error) => {
        if (!cancelled) {
          setFriendsEnrolled(null);
          setFriendsStatusError(error instanceof Error ? error.message : 'Não foi possível confirmar sua participação agora.');
        }
      });
    return () => { cancelled = true; };
  }, [user?.uid, friendsStatusReload]);

  useEffect(() => {
    let cancelled = false;
    setPaidParticipation(null);

    void Promise.all([
      championshipService.getChampionships(true),
      championshipService.getUserRegistrations(),
    ]).then(([catalog, registrations]) => {
      if (cancelled) return;
      const next = Object.fromEntries(PAID_CHAMPIONSHIP_IDS.map((championshipId) => {
        const championship = catalog.find((item) => item.id === championshipId);
        const participating = !!championship?.editionId && registrations.some((registration) => (
          registration.championshipId === championshipId
          && registration.editionId === championship.editionId
          && registration.status === 'ACTIVE'
          && registration.paymentStatus === 'PAID'
        ));
        return [championshipId, participating];
      })) as PaidParticipationState;
      setPaidParticipation(next);
    }).catch((error) => {
      console.warn('[ChampionshipsHub] falha ao carregar participações oficiais:', error);
      if (!cancelled) setPaidParticipation({ invictus_strength_v1: false, invictus_cardio_v1: false });
    });

    return () => { cancelled = true; };
  }, [user?.uid]);

  const strengthParticipating = paidParticipation?.invictus_strength_v1 === true;
  const cardioParticipating = paidParticipation?.invictus_cardio_v1 === true;
  const hasPaidParticipation = strengthParticipating || cardioParticipating;
  const hasAvailablePaidCard = paidParticipation === null || !strengthParticipating || !cardioParticipating;

  return createPortal(<main className="ch-new-screen"><div className="ch-new-page">
    <header className="ch-new-header"><button onClick={() => navigate('/notifications')} aria-label="Notificações"><Bell /></button><div><InvictusLogo size={45} /><b>INVICTUS</b><small>PERFORMANCE</small></div><button className="ch-new-avatar" onClick={() => navigate('/profile')} aria-label="Abrir perfil">{user?.photoURL ? <img src={user.photoURL} alt="" /> : <UserRound />}{paid ? <em>PRO</em> : null}</button></header>

    <h2 className="ch-new-title ch-new-title--first">FORÇA</h2>
    {powerLiftParticipating === null ? <div className="ch-friends-status-loading" aria-label="Carregando Power Lift" /> : powerLiftParticipating ? <div className="ch-paid-participating-stack">
      <PaidRankingCard {...powerLiftRankingCard} onOpen={() => navigate('/power')} />
    </div> : <PowerLiftFeatureCard onEnroll={() => navigate('/power')} />}

    {friendsStatusError ? <section className="ch-security"><ShieldCheck /><span>Não foi possível confirmar sua participação no Campeonato Entre Amigos. Nenhuma nova inscrição será sugerida até o status ser confirmado.</span><button type="button" onClick={() => setFriendsStatusReload(value => value + 1)}><RefreshCw /> TENTAR NOVAMENTE</button></section> : friendsEnrolled === false ? <><h2 className="ch-new-title">DESTAQUE</h2><FriendsChampionshipCard onParticipate={() => navigate('/championships/community')} /></> : null}

    {hasPaidParticipation ? <>
      <div className="ch-my-championship-head"><h2>MEUS CAMPEONATOS</h2><span>Acompanhe seu desempenho</span></div>
      <div className="ch-paid-participating-stack">
        {strengthParticipating ? <PaidRankingCard {...strengthPreviewCard} onOpen={() => navigate('/championships/ranking/musculacao')} /> : null}
        {cardioParticipating ? <PaidRankingCard {...cardioPreviewCard} onOpen={() => navigate('/championships/ranking/cardio')} /> : null}
      </div>
    </> : null}

    {hasAvailablePaidCard ? <>
      <div className="ch-paid-head ch-paid-head--first"><h2>CAMPEONATOS</h2><span>{paidParticipation === null ? 'CARREGANDO' : 'OFICIAIS'}</span></div>
      {paidParticipation === null ? <div className="ch-friends-status-loading" aria-label="Carregando campeonatos oficiais" /> : <section className="ch-future">
        {!strengthParticipating ? <ChampionshipPreviewCard {...strengthPreviewCard} onPreview={() => navigate('/championships/preview/musculacao')} /> : null}
        {!cardioParticipating ? <ChampionshipPreviewCard {...cardioPreviewCard} onPreview={() => navigate('/championships/preview/cardio')} /> : null}
      </section>}
    </> : null}

    {!friendsStatusError && friendsEnrolled === null ? <div className="ch-friends-status-loading" aria-label="Carregando Campeonato Entre Amigos" /> : friendsEnrolled ? <>
      <div className="ch-my-championship-head"><h2>MEU CAMPEONATO</h2><span>Acompanhe seu desempenho</span></div>
      <FriendsRankingCard onOpen={() => navigate('/championships/community/ranking')} />
    </> : null}

    <h2 className="ch-new-title">COMO FUNCIONA</h2><section className="ch-how">{[[CalendarDays,'1. ESCOLHA','Escolha o campeonato'],[Check,'2. INSCREVA-SE','Confirme sua participação'],[Dumbbell,'3. TREINE','Registre atividades reais'],[BarChart3,'4. RANKING','Acompanhe sua posição'],[Trophy,'5. EVOLUA','Supere suas marcas']].map(([Icon,title,text]:any) => <article key={title}><Icon /><b>{title}</b><span>{text}</span></article>)}</section><div className="ch-security"><ShieldCheck /><span>Validação avançada e sistema antifraude ajudam a manter competições justas.</span></div>
  </div><nav className="ch-new-footer"><button onClick={() => navigate('/')}><InvictusLogo size={24} /><span>Início</span></button><button className="is-active" onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button><button className="is-plus" onClick={() => navigate('/activity')} aria-label="Escolher modalidade"><Plus /></button><button onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button><button onClick={() => navigate('/profile')}><UserRound /><span>Perfil</span></button></nav></main>, document.body);
}
