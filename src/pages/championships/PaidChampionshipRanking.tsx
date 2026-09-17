import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart3, Dumbbell, Footprints, RefreshCw, ShieldCheck, Trophy } from 'lucide-react';
import { InvictusLogo } from '../../components/InvictusLogo';
import { championshipService } from '../../services/championshipService';
import type { Championship, ChampionshipRegistration, UserChampionshipProgress } from '../../types/championships';
import './ChampionshipsNew.css';
import './ChampionshipsRound.css';
import './PaidChampionshipRanking.css';

type PaidChampionshipRankingProps = { modality: 'musculacao' | 'cardio' };
type LeaderboardEntry = { rank: number; name: string; gym: string; score: number; isUser?: boolean };

function scoreLabel(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

export function PaidChampionshipRanking({ modality }: PaidChampionshipRankingProps) {
  const navigate = useNavigate();
  const isStrength = modality === 'musculacao';
  const championshipId = isStrength ? 'invictus_strength_v1' : 'invictus_cardio_v1';
  const ModalityIcon = isStrength ? Dumbbell : Footprints;
  const previewPath = isStrength ? '/championships/preview/musculacao' : '/championships/preview/cardio';
  const [championship, setChampionship] = useState<Championship | null>(null);
  const [registration, setRegistration] = useState<ChampionshipRegistration | null>(null);
  const [progress, setProgress] = useState<UserChampionshipProgress | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
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

  return createPortal(<main className="ch-new-screen"><div className="ch-new-page paid-ranking-page">
    <header className="ch-detail-header"><button onClick={() => navigate('/championships')} aria-label="Voltar aos campeonatos"><ArrowLeft /></button><div><InvictusLogo size={40} /><b>INVICTUS</b><small>PERFORMANCE</small></div><span /></header>

    <section className="paid-ranking-hero">
      <div><ModalityIcon /><span><small>CAMPEONATO OFICIAL</small><h1>{championship?.title || (isStrength ? 'CAMPEONATO DE FORÇA' : 'CAMPEONATO DE CARDIO')}</h1></span></div>
      <p>{participating ? 'Você está participando desta edição. O ranking abaixo usa apenas atividades válidas e homologadas pelo servidor.' : 'O ranking oficial fica disponível para participantes com inscrição confirmada nesta edição.'}</p>
    </section>

    {loading ? <div className="paid-ranking-state"><b>CARREGANDO RANKING</b>Buscando sua inscrição e a classificação atual.</div> : error ? <div className="paid-ranking-state"><b>NÃO FOI POSSÍVEL CARREGAR</b>{error}<div className="paid-ranking-actions"><button type="button" onClick={() => setReload(value => value + 1)}><RefreshCw /> TENTAR NOVAMENTE</button></div></div> : !participating ? <div className="paid-ranking-state"><b>INSCRIÇÃO NÃO CONFIRMADA</b>Abra o campeonato para consultar o status da edição antes de acessar o ranking.<div className="paid-ranking-actions"><button type="button" onClick={() => navigate(previewPath)}><ShieldCheck /> VER CAMPEONATO</button></div></div> : <>
      <section className="paid-ranking-summary" aria-label="Resumo da participação">
        <article><small>MINHA POSIÇÃO</small><b>{currentRank > 0 ? `${currentRank}º` : '—'}</b></article>
        <article><small>PONTUAÇÃO</small><b>{scoreLabel(totalScore)}</b></article>
        <article><small>ATIVIDADES VÁLIDAS</small><b>{validSessions}</b></article>
      </section>

      <section className="paid-ranking-panel" aria-label="Ranking atual do campeonato">
        <div className="paid-ranking-panel__head"><h2>RANKING ATUAL</h2><span><BarChart3 size={14} /> CLASSIFICAÇÃO</span></div>
        {leaderboard.length ? <div className="paid-ranking-list">{leaderboard.map((entry) => <div key={`${entry.rank}-${entry.name}`} className={`paid-ranking-row${entry.isUser ? ' is-user' : ''}`}>
          <b className="paid-ranking-row__position">{entry.rank}º</b>
          <span className="paid-ranking-row__identity"><b>{entry.name || 'Atleta Invictus'}</b><small>{entry.isUser ? 'VOCÊ' : entry.gym || 'Invictus'}</small></span>
          <span className="paid-ranking-row__score">{scoreLabel(entry.score)}</span>
        </div>)}</div> : <div className="paid-ranking-state"><Trophy /><b>RANKING AINDA VAZIO</b>Assim que atividades válidas forem homologadas, a classificação aparecerá aqui.</div>}
      </section>

      <div className="paid-ranking-actions"><button type="button" className="secondary" onClick={() => navigate(previewPath)}><ShieldCheck /> VER DETALHES E REGULAMENTO</button></div>
    </>}
  </div></main>, document.body);
}
