import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, ChevronDown, ChevronRight, List, Plus, RefreshCw, ShieldCheck, Trophy, UserRound } from 'lucide-react';
import { InvictusLogo } from '../../components/InvictusLogo';
import { PodiumTopThree } from '../../components/ranking/PodiumTopThree';
import type { RankingEntry } from '../../types';
import { useUser } from '../../UserContext';
import {
  communityChampionshipService,
  type CommunityChampionshipStatus,
  type CommunityLeaderboardEntry,
} from '../../services/communityChampionshipService';
import '../../components/ranking/AcademyRanking.css';
import './CommunityRanking.css';
import './ChampionshipsNew.css';

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
  const [status, setStatus] = useState<CommunityChampionshipStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showFullRanking, setShowFullRanking] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    setStatus(null);
    try {
      // O ranking da academia agora é exclusivamente o acumulado da temporada.
      // Não existem mais classificações paralelas de semana/mês nesta tela.
      const result = await communityChampionshipService.status('all');
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
  }, [navigate, user?.uid]);

  useEffect(() => { void load(); }, [load]);

  const openProfile = (uid: string) => {
    navigate(`/profile/${uid}`, { state: { returnTo: '/championships/community/ranking' } });
  };

  if (!user) return null;
  const championship = status?.championship;
  const gymId = championship?.gymId || user.gymId || '';
  const athletes = (championship?.leaderboard || []).map((entry) => toRankingEntry(entry, gymId));
  const topThree = athletes.filter((entry) => entry.rank <= 3);
  const fourth = athletes.find((entry) => entry.rank === 4) || null;
  const remaining = athletes.filter((entry) => entry.rank > 4);
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

    {loading ? <section className="academy-ranking-state academy-ranking-loading"><RefreshCw /><p>ATUALIZANDO CLASSIFICAÇÃO…</p></section> : error ? <section className="academy-ranking-state"><RefreshCw /><h2>NÃO FOI POSSÍVEL CARREGAR</h2><p>{error}</p><button type="button" onClick={() => void load()}>TENTAR NOVAMENTE <RefreshCw /></button></section> : <>
      <section className="community-ranking-top3">
        <header className="community-ranking-season-head"><div><small>TEMPORADA</small><h2>PÓDIO DA TEMPORADA</h2><p>OS MAIS DEDICADOS DO ANO</p></div><span><Trophy /><b>DISCIPLINA<br/>GERA RESULTADOS</b></span></header>
        <PodiumTopThree entries={topThree} currentUserId={user.uid} onSelect={openProfile} showEmptySlots />
      </section>

      <section className="community-ranking-summary" aria-label="Destaques do ranking da temporada">
        {fourth ? <button type="button" className="community-ranking-summary-row" onClick={() => openProfile(fourth.uid)}>
          <strong className="community-ranking-summary-rank">4º</strong><img src={fourth.photoURL || fallbackAvatar} alt="" onError={(event) => { event.currentTarget.src = fallbackAvatar; }} /><span><b>4º LUGAR</b><small>{fourth.displayName}</small></span><em>{Number(fourth.score || 0).toLocaleString('pt-BR')} <small>IGA</small></em><ChevronRight />
        </button> : <div className="community-ranking-summary-row is-empty">
          <strong className="community-ranking-summary-rank">4º</strong><span className="community-ranking-summary-avatar"><UserRound /></span><span><b>4º LUGAR</b><small>VAGA ABERTA</small></span><em>—</em><span aria-hidden="true" />
        </div>}

        <div className="community-ranking-summary-row is-current">
          <span className="community-ranking-summary-me"><UserRound /></span><img src={current?.photoURL || user.photoURL || fallbackAvatar} alt="" onError={(event) => { event.currentTarget.src = fallbackAvatar; }} /><span><b>MINHA POSIÇÃO</b><small>{current ? `${current.rank}º lugar` : 'AINDA SEM CLASSIFICAÇÃO'}</small></span><em>{current ? Number(current.score || 0).toLocaleString('pt-BR') : '—'} {current ? <small>IGA</small> : null}</em><span aria-hidden="true" />
        </div>

        <button type="button" className="community-ranking-disclosure" onClick={() => setShowFullRanking((visible) => !visible)} aria-expanded={showFullRanking}>
          <List /><span><b>RANKING COMPLETO</b><small>{athletes.length ? `${athletes.length} atleta${athletes.length === 1 ? '' : 's'} classificado${athletes.length === 1 ? '' : 's'}` : 'OS ATLETAS APARECERÃO AQUI'}</small></span>{showFullRanking ? <ChevronDown className="is-open" /> : <ChevronRight />}
        </button>
      </section>

      {showFullRanking ? <section className="community-ranking-list" aria-label="Ranking completo da temporada">
        {fourth ? <button key={fourth.uid} type="button" className={fourth.uid === user.uid ? 'is-current' : ''} onClick={() => openProfile(fourth.uid)}><b>{fourth.rank}</b><img src={fourth.photoURL || fallbackAvatar} alt="" onError={(event) => { event.currentTarget.src = fallbackAvatar; }} /><strong>{fourth.uid === user.uid ? 'Você' : fourth.displayName}</strong><span>{Number(fourth.score || 0).toLocaleString('pt-BR')} <small>IGA</small></span></button> : null}
        {remaining.map((entry) => <button key={entry.uid} type="button" className={entry.uid === user.uid ? 'is-current' : ''} onClick={() => openProfile(entry.uid)}><b>{entry.rank}</b><img src={entry.photoURL || fallbackAvatar} alt="" onError={(event) => { event.currentTarget.src = fallbackAvatar; }} /><strong>{entry.uid === user.uid ? 'Você' : entry.displayName}</strong><span>{Number(entry.score || 0).toLocaleString('pt-BR')} <small>IGA</small></span></button>)}
        {!fourth && !remaining.length ? <p className="community-ranking-list-empty">Ainda não há atletas classificados fora do pódio.</p> : null}
      </section> : null}
    </>}
  </div><nav className="ch-new-footer"><button onClick={() => navigate('/')}><InvictusLogo size={24} /><span>Início</span></button><button className="is-active" onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button><button className="is-plus" onClick={() => navigate('/activity')} aria-label="Escolher modalidade"><Plus /></button><button onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button><button onClick={() => navigate('/profile')}><UserRound /><span>Perfil</span></button></nav></main>, document.body);
}
