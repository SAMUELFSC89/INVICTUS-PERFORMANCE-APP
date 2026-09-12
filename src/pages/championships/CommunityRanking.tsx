import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Medal, Plus, RefreshCw, ShieldCheck, Trophy, UserRound } from 'lucide-react';
import { InvictusLogo } from '../../components/InvictusLogo';
import { PodiumTopThree } from '../../components/ranking/PodiumTopThree';
import type { RankingEntry } from '../../types';
import { useUser } from '../../UserContext';
import {
  communityChampionshipService,
  type CommunityChampionshipStatus,
  type CommunityLeaderboardEntry,
  type CommunityRankingPeriod,
} from '../../services/communityChampionshipService';
import '../../components/ranking/AcademyRanking.css';
import './CommunityRanking.css';
import './ChampionshipsNew.css';

const periods: { value: CommunityRankingPeriod; label: string }[] = [
  { value: 'weekly', label: 'SEMANA' },
  { value: 'monthly', label: 'MÊS' },
  { value: 'all', label: 'TEMPORADA' },
];
const fallbackAvatar = '/capacete.webp';

function toRankingEntry(entry: CommunityLeaderboardEntry, gymId: string): RankingEntry {
  return {
    uid: entry.userId,
    displayName: entry.userName || 'Atleta Invictus',
    photoURL: entry.photoURL || '',
    score: Number(entry.score || 0),
    rank: Number(entry.rank || 0),
    streak: 0,
    gymId,
  } as RankingEntry;
}

export function CommunityRanking() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [period, setPeriod] = useState<CommunityRankingPeriod>('weekly');
  const [status, setStatus] = useState<CommunityChampionshipStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    // Não mantenha classificação de outro período na tela enquanto a nova
    // consulta ainda está pendente. Ranking antigo parecendo atual é pior do
    // que um estado de carregamento explícito.
    setStatus(null);
    try {
      const result = await communityChampionshipService.status(period);
      if (result.enrolled !== true) {
        navigate('/championships/community', { replace: true });
        return;
      }
      setStatus(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o ranking.');
    } finally {
      setLoading(false);
    }
  }, [navigate, period, user?.uid]);

  useEffect(() => { void load(); }, [load]);

  if (!user) return null;
  const championship = status?.championship;
  const gymId = championship?.gymId || user.gymId || '';
  const athletes = (championship?.leaderboard || []).map((entry) => toRankingEntry(entry, gymId));
  const topThree = athletes.filter((entry) => entry.rank <= 3);
  const rows = athletes.filter((entry) => entry.rank > 3);
  const current = athletes.find((entry) => entry.uid === user.uid) || (championship?.rank ? ({
    uid: user.uid,
    displayName: user.displayName || 'Você',
    photoURL: user.photoURL || '',
    score: championship.score || 0,
    rank: championship.rank,
    streak: 0,
    gymId,
  } as RankingEntry) : null);
  const gymName = championship?.gymName || user.gymName || 'Sua academia';

  return createPortal(<main className="ch-new-screen community-ranking-screen"><div className="ch-new-page community-ranking-page">
    <header className="ch-detail-header community-ranking-topbar"><button type="button" onClick={() => navigate('/championships')} aria-label="Voltar"><ArrowLeft /></button><div><InvictusLogo size={43} /><b>INVICTUS</b><small>PERFORMANCE</small></div><button type="button" className="community-ranking-profile" onClick={() => navigate('/profile')} aria-label="Perfil">{user.photoURL ? <img src={user.photoURL} alt="" /> : <UserRound />}</button></header>

    <section className="community-ranking-hero"><div><small>CLASSIFICAÇÃO EXCLUSIVA</small><h1>RANKING DA ACADEMIA</h1><p><Building2 /> {gymName}</p><em>CAMPEONATO ENTRE AMIGOS</em></div><div className="community-ranking-hero-motto"><span>MAIS QUE TREINO<br/>É EVOLUÇÃO.</span><i /></div></section>

    <div className="academy-ranking-periods community-ranking-periods" role="tablist" aria-label="Período do ranking">{periods.map((option) => <button type="button" role="tab" aria-selected={period === option.value} className={period === option.value ? 'is-active' : ''} key={option.value} onClick={() => setPeriod(option.value)} disabled={loading}>{option.label}</button>)}</div>

    {loading ? <section className="academy-ranking-state academy-ranking-loading"><RefreshCw /><p>ATUALIZANDO CLASSIFICAÇÃO…</p></section> : error ? <section className="academy-ranking-state"><RefreshCw /><h2>NÃO FOI POSSÍVEL CARREGAR</h2><p>{error}</p><button type="button" onClick={() => void load()}>TENTAR NOVAMENTE <RefreshCw /></button></section> : athletes.length === 0 ? <section className="academy-ranking-state"><Medal /><h2>O PÓDIO AINDA ESTÁ ABERTO</h2><p>Finalize atividades válidas para inaugurar a classificação deste período.</p></section> : <>
      <section className="community-ranking-top3"><header><span /><h2>TOP 3</h2><span /></header><p>ATLETAS QUE FAZEM A DIFERENÇA</p><PodiumTopThree entries={topThree} currentUserId={user.uid} onSelect={(uid) => navigate(`/profile/${uid}`)} /></section>

      {rows.length ? <section className="community-ranking-list" aria-label="Demais posições"><header><span>POS</span><span>ATLETA</span><span>PONTOS IGA</span></header>{rows.map((entry) => <button key={entry.uid} type="button" className={entry.uid === user.uid ? 'is-current' : ''} onClick={() => navigate(`/profile/${entry.uid}`)}><b>{entry.rank}</b><img src={entry.photoURL || fallbackAvatar} alt="" onError={(event) => { event.currentTarget.src = fallbackAvatar; }} /><strong>{entry.uid === user.uid ? 'Você' : entry.displayName}</strong><span>{Number(entry.score || 0).toLocaleString('pt-BR')} <small>IGA</small></span></button>)}</section> : null}

      {current ? <section className="community-current-position"><div><small>SUA POSIÇÃO</small><strong>{current.rank}º</strong></div><span><img src={current.photoURL || fallbackAvatar} alt="" /><b>{current.uid === user.uid ? 'Você' : current.displayName}<small>{Number(current.score || 0).toLocaleString('pt-BR')} IGA</small></b></span><p>CONSTÂNCIA<br/>TE COLOCA<br/>SEMPRE MAIS LONGE.<i /></p></section> : null}
    </>}
  </div><nav className="ch-new-footer"><button onClick={() => navigate('/')}><InvictusLogo size={24} /><span>Início</span></button><button className="is-active" onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button><button className="is-plus" onClick={() => navigate('/musculacao')} aria-label="Iniciar treino"><Plus /></button><button onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button><button onClick={() => navigate('/profile')}><UserRound /><span>Perfil</span></button></nav></main>, document.body);
}
