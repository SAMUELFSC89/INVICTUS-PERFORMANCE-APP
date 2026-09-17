import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronRight, Dumbbell, Footprints, List, RefreshCw, ShieldCheck, Trophy, UserRound } from 'lucide-react';
import { InvictusLogo } from '../../components/InvictusLogo';
import { PodiumTopThree } from '../../components/ranking/PodiumTopThree';
import { championshipService, type PaidChampionshipLeaderboardEntry } from '../../services/championshipService';
import type { RankingEntry } from '../../types';
import type { Championship, ChampionshipRegistration, UserChampionshipProgress } from '../../types/championships';
import { useUser } from '../../UserContext';
import '../../components/ranking/AcademyRanking.css';
import './ChampionshipsNew.css';
import './ChampionshipsRound.css';
import './CommunityRanking.css';
import './CommunityRankingPodium.css';
import './PaidChampionshipRanking.css';

type PaidChampionshipRankingProps = { modality: 'musculacao' | 'cardio' };

const fallbackAvatar = '/capacete.webp';

function scoreLabel(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function paidRankingUid(entry: PaidChampionshipLeaderboardEntry, currentUserId?: string): string {
  if (entry.userId) return entry.userId;
  if (entry.isUser && currentUserId) return currentUserId;
  return `paid-placeholder-${entry.rank}-${entry.name}`;
}

function toRankingEntry(entry: PaidChampionshipLeaderboardEntry, currentUserId?: string, currentUserPhoto?: string): RankingEntry {
  return {
    uid: paidRankingUid(entry, currentUserId),
    displayName: entry.name || 'Atleta Invictus',
    photoURL: entry.photoURL || (entry.isUser ? currentUserPhoto || '' : ''),
    score: Number(entry.score || 0),
    rank: Number(entry.rank || 0),
    streak: 0,
    gymId: '',
  } as RankingEntry;
}

export function PaidChampionshipRanking({ modality }: PaidChampionshipRankingProps) {
  const navigate = useNavigate();
  const { user } = useUser();
  const isStrength = modality === 'musculacao';
  const championshipId = isStrength ? 'invictus_strength_v1' : 'invictus_cardio_v1';
  const ModalityIcon = isStrength ? Dumbbell : Footprints;
  const previewPath = isStrength ? '/championships/preview/musculacao' : '/championships/preview/cardio';
  const returnPath = isStrength ? '/championships/ranking/musculacao' : '/championships/ranking/cardio';
  const [championship, setChampionship] = useState<Championship | null>(null);
  const [registration, setRegistration] = useState<ChampionshipRegistration | null>(null);
  const [progress, setProgress] = useState<UserChampionshipProgress | null>(null);
  const [leaderboard, setLeaderboard] = useState<PaidChampionshipLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [showFullRanking, setShowFullRanking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setShowFullRanking(false);
    void Promise.all([
      championshipService.getChampionshipById(championshipId, true),
      championshipService.getRegistration(championshipId),
      championshipService.getUserProgress(championshipId),
      championshipService.getLeaderboard(championshipId),
    ]).then(([catalogItem, currentRegistration, currentProgress, currentLeaderboard]) => {
      if (cancelled) return;
      setChampionship(catalogItem || null);
      setRegistration(currentRegistration || null);
      setProgress(currentProgress || null);
      setLeaderboard(currentLeaderboard || []);
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Não foi possível carregar o ranking agora.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [championshipId, reload]);

  const participating = registration?.status === 'ACTIVE' && registration.paymentStatus === 'PAID';
  const ownEntry = useMemo(() => leaderboard.find((entry) => entry.isUser), [leaderboard]);
  const currentRank = ownEntry?.rank || progress?.currentRank || 0;
  const totalScore = ownEntry?.score ?? progress?.totalScore ?? 0;
  const validSessions = progress?.validSessionsCount || 0;
  const athletes = useMemo(
    () => leaderboard.map((entry) => toRankingEntry(entry, user?.uid, user?.photoURL || '')),
    [leaderboard, user?.uid, user?.photoURL],
  );
  const topThree = athletes.filter((entry) => entry.rank <= 3);
  const fourth = athletes.find((entry) => entry.rank === 4) || null;
  const remaining = athletes.filter((entry) => entry.rank > 4);
  const current = useMemo(() => {
    const fromLeaderboard = athletes.find((entry) => entry.uid === user?.uid)
      || (ownEntry ? athletes.find((entry) => entry.rank === ownEntry.rank && entry.displayName === ownEntry.name) : null);
    if (fromLeaderboard) return fromLeaderboard;
    if (!user || currentRank <= 0) return null;
    return {
      uid: user.uid,
      displayName: user.displayName || 'Você',
      photoURL: user.photoURL || '',
      score: Number(totalScore || 0),
      rank: currentRank,
      streak: 0,
      gymId: '',
    } as RankingEntry;
  }, [athletes, currentRank, ownEntry, totalScore, user]);

  const openProfile = (uid: string) => {
    if (!uid || uid.startsWith('paid-placeholder-')) return;
    navigate(`/profile/${uid}`, { state: { returnTo: returnPath } });
  };

  const modalityTitle = isStrength ? 'RANKING MUSCULAÇÃO' : 'RANKING CARDIO';
  const podiumTitle = isStrength ? 'PÓDIO DA MUSCULAÇÃO' : 'PÓDIO DO CARDIO';
  const championshipTitle = championship?.title || (isStrength ? 'CAMPEONATO DE FORÇA' : 'CAMPEONATO DE CARDIO');

  return createPortal(<main className="ch-new-screen community-ranking-screen paid-ranking-screen"><div className="ch-new-page community-ranking-page paid-ranking-page">
    <header className="ch-detail-header community-ranking-topbar">
      <button type="button" onClick={() => navigate('/championships')} aria-label="Voltar aos campeonatos"><ArrowLeft /></button>
      <div><InvictusLogo size={43} /><b>INVICTUS</b><small>PERFORMANCE</small></div>
      <button type="button" className="community-ranking-profile" onClick={() => navigate('/profile')} aria-label="Perfil">{user?.photoURL ? <img src={user.photoURL} alt="" /> : <UserRound />}</button>
    </header>

    <section className="community-ranking-hero paid-ranking-official-hero">
      <div><small>CLASSIFICAÇÃO OFICIAL</small><h1>{modalityTitle}</h1><p><ModalityIcon /> {championshipTitle}</p><em>{championship?.edition ? `EDIÇÃO ${championship.edition}` : 'CAMPEONATO OFICIAL INVICTUS'}</em></div>
      <div className="community-ranking-hero-motto"><span>RESULTADO VÁLIDO<br/>É RESULTADO HOMOLOGADO.</span><i /></div>
    </section>

    {loading ? <section className="academy-ranking-state academy-ranking-loading"><RefreshCw /><p>ATUALIZANDO CLASSIFICAÇÃO…</p></section> : error ? <section className="academy-ranking-state"><RefreshCw /><h2>NÃO FOI POSSÍVEL CARREGAR</h2><p>{error}</p><button type="button" onClick={() => setReload((value) => value + 1)}>TENTAR NOVAMENTE <RefreshCw /></button></section> : !participating ? <div className="paid-ranking-state"><b>INSCRIÇÃO NÃO CONFIRMADA</b>Abra o campeonato para consultar o status da edição antes de acessar o ranking.<div className="paid-ranking-actions"><button type="button" onClick={() => navigate(previewPath)}><ShieldCheck /> VER CAMPEONATO</button></div></div> : <>
      <section className="community-ranking-top3 paid-ranking-top3">
        <header className="community-ranking-season-head"><div><small>RANKING ATUAL</small><h2>{podiumTitle}</h2><p>ATIVIDADES VÁLIDAS E HOMOLOGADAS</p></div><span><Trophy /><b>DISCIPLINA<br/>GERA RESULTADOS</b></span></header>
        <PodiumTopThree entries={topThree} currentUserId={user?.uid} onSelect={openProfile} showEmptySlots cleanSeasonLayout scoreUnit="PTS" theme={isStrength ? "musculacao" : "cardio"} />
      </section>

      <section className="community-ranking-summary" aria-label={`Destaques do ${modalityTitle.toLowerCase()}`}>
        {fourth ? <button type="button" className="community-ranking-summary-row" onClick={() => openProfile(fourth.uid)}>
          <strong className="community-ranking-summary-rank">4º</strong><img src={fourth.photoURL || fallbackAvatar} alt="" onError={(event) => { event.currentTarget.src = fallbackAvatar; }} /><span><b>4º LUGAR</b><small>{fourth.displayName}</small></span><em>{scoreLabel(fourth.score)} <small>PTS</small></em><ChevronRight />
        </button> : <div className="community-ranking-summary-row is-empty">
          <strong className="community-ranking-summary-rank">4º</strong><span className="community-ranking-summary-avatar"><UserRound /></span><span><b>4º LUGAR</b><small>VAGA ABERTA</small></span><em>—</em><span aria-hidden="true" />
        </div>}

        <div className="community-ranking-summary-row is-current">
          <span className="community-ranking-summary-me"><UserRound /></span><img src={current?.photoURL || user?.photoURL || fallbackAvatar} alt="" onError={(event) => { event.currentTarget.src = fallbackAvatar; }} /><span><b>MINHA POSIÇÃO</b><small>{current ? `${current.rank}º lugar • ${validSessions} atividade${validSessions === 1 ? '' : 's'} válida${validSessions === 1 ? '' : 's'}` : 'AINDA SEM CLASSIFICAÇÃO'}</small></span><em>{current ? scoreLabel(current.score) : '—'} {current ? <small>PTS</small> : null}</em><span aria-hidden="true" />
        </div>

        <button type="button" className="community-ranking-disclosure" onClick={() => setShowFullRanking((visible) => !visible)} aria-expanded={showFullRanking}>
          <List /><span><b>RANKING COMPLETO</b><small>{athletes.length ? `${athletes.length} atleta${athletes.length === 1 ? '' : 's'} classificado${athletes.length === 1 ? '' : 's'}` : 'OS ATLETAS APARECERÃO AQUI'}</small></span>{showFullRanking ? <ChevronDown className="is-open" /> : <ChevronRight />}
        </button>
      </section>

      {showFullRanking ? <section className="community-ranking-list paid-ranking-full-list" aria-label={`Ranking completo de ${isStrength ? 'musculação' : 'cardio'}`}>
        {fourth ? <button key={fourth.uid} type="button" className={fourth.uid === user?.uid ? 'is-current' : ''} onClick={() => openProfile(fourth.uid)}><b>{fourth.rank}</b><img src={fourth.photoURL || fallbackAvatar} alt="" onError={(event) => { event.currentTarget.src = fallbackAvatar; }} /><strong>{fourth.uid === user?.uid ? 'Você' : fourth.displayName}</strong><span>{scoreLabel(fourth.score)} <small>PTS</small></span></button> : null}
        {remaining.map((entry) => <button key={entry.uid} type="button" className={entry.uid === user?.uid ? 'is-current' : ''} onClick={() => openProfile(entry.uid)}><b>{entry.rank}</b><img src={entry.photoURL || fallbackAvatar} alt="" onError={(event) => { event.currentTarget.src = fallbackAvatar; }} /><strong>{entry.uid === user?.uid ? 'Você' : entry.displayName}</strong><span>{scoreLabel(entry.score)} <small>PTS</small></span></button>)}
        {!fourth && !remaining.length ? <p className="community-ranking-list-empty">Ainda não há atletas classificados fora do pódio.</p> : null}
      </section> : null}

      <div className="paid-ranking-actions"><button type="button" className="secondary" onClick={() => navigate(previewPath)}><ShieldCheck /> VER DETALHES E REGULAMENTO</button></div>
    </>}
  </div></main>, document.body);
}
