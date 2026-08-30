import { useEffect, useState } from 'react';
import { ArrowLeft, Building2, CalendarDays, ChevronDown, CircleDot, ShieldCheck, TrendingUp } from 'lucide-react';
import { rankingService } from '../services/rankingService';
import { useUser } from '../UserContext';
import type { RankingSnapshot } from '../types';

type RankPeriod = 'weekly' | 'all' | 'monthly';
const periodLabels: Record<RankPeriod, string> = { weekly: 'SEMANA ATUAL', all: 'TEMPORADA', monthly: 'MÊS ATUAL' };
const periodOptions: { label: string; value: RankPeriod }[] = [
  { label: 'Semana atual', value: 'weekly' },
  { label: 'Mês atual', value: 'monthly' },
  { label: 'Temporada', value: 'all' }
];
const avatar = (entry: any) => entry.photoURL || '/capacete.webp';
const name = (entry: any) => entry.displayName || 'Atleta Invictus';
const gym = (entry: any) => entry.gymName || entry.gym || 'Sua academia';
const daysUntilWeekEnd = () => (7 - new Date().getDay()) % 7 || 7;
const formatUpdatedAt = (updatedAt?: string) => updatedAt ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(updatedAt)) : 'agora';

function TopAvatar({ entry, rank }: { entry: any; rank: number }) {
  const frame = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
  return <span className={`rank-avatar ${frame ? `rank-avatar--${frame}` : ''}`}><img src={avatar(entry)} alt={`Foto de ${name(entry)}`} onError={(event) => { event.currentTarget.src = '/capacete.webp'; }} />{frame ? <img className="rank-avatar-frame" src={`/ranking-frame-${frame}-reference.png`} alt="" aria-hidden="true" /> : null}</span>;
}

function RankingRow({ entry, rank, current }: { entry: any; rank: number; current?: boolean }) {
  const isPro = entry.subscriptionTier === 'performance' || entry.subscriptionTier === 'pro';
  return <div className={`rank-row ${current ? 'rank-row--current' : ''}`}><b className={`rank-number rank-number--${rank}`}>{rank}</b><TopAvatar entry={entry} rank={rank} /><span className="rank-row-name"><strong>{name(entry)}{isPro ? <span className="rank-plan-badge">PRO</span> : null}</strong><small>{gym(entry)}</small></span><span className="rank-score"><small>IGA</small><b>{Number(entry.score || 0).toLocaleString('pt-BR')}</b></span></div>;
}

export function Rankings() {
  const { user } = useUser();
  const [period, setPeriod] = useState<RankPeriod>('weekly');
  const [ranking, setRanking] = useState<RankingSnapshot | null>(null);
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [error, setError] = useState('');
  const [showTop50, setShowTop50] = useState(false);
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    rankingService.getEnrollment()
      .then((state) => { if (!cancelled) setEnrolled(state.enrolled); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Falha ao consultar o ranking.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.uid]);

  useEffect(() => {
    if (!user || enrolled !== true) return;
    let cancelled = false;
    setLoading(true);
    rankingService.getRanking('gym', user.gymId || '', period)
      .then((data) => { if (!cancelled) setRanking(data); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Falha ao carregar o ranking.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, enrolled, user?.uid, user?.gymId]);

  if (!user) return null;

  const handleEnrollment = async () => {
    setEnrolling(true);
    setError('');
    try {
      await rankingService.enroll(user.gymId || '');
      setEnrolled(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível entrar no ranking.');
    } finally {
      setEnrolling(false);
    }
  };

  if (loading && enrolled === null) return <section className="ranking-flow"><p className="rank-loading">CARREGANDO RANKING…</p></section>;

  if (enrolled !== true) return <section className="ranking-flow ranking-flow--consent">
    <header className="ranking-overview-header"><div><h1>RANKING DA ACADEMIA</h1><p>COMPARE SUA EVOLUÇÃO COM QUEM TREINA COM VOCÊ.</p></div></header>
    <article className="rank-consent-card">
      <span className="rank-consent-icon"><ShieldCheck /></span>
      <h2>ENTRAR NO RANKING</h2>
      <p>A participação é opcional. Ao entrar, seu nome, foto, academia e pontuação IGA ficam visíveis somente no ranking da sua academia.</p>
      <ul><li>Free e Pro competem juntos.</li><li>Não há prêmio em dinheiro.</li><li>Você pode sair quando quiser.</li><li>Atividades anteriores à adesão não entram retroativamente.</li></ul>
      {error ? <p className="rank-consent-error" role="alert">{error}</p> : null}
      <button className="rank-position-button" onClick={handleEnrollment} disabled={enrolling}><ShieldCheck /> {enrolling ? 'ENTRANDO…' : 'ACEITAR E ENTRAR'}</button>
    </article>
  </section>;

  const athletes = ranking?.topUsers || [];
  const myRank = athletes.findIndex((entry) => entry.uid === user.uid) + 1;
  const myEntry = athletes.find((entry) => entry.uid === user.uid) || { ...user, score: period === 'weekly' ? user.weeklyScore || user.score : user.score };

  if (showTop50) return <section className="ranking-flow">
    <header className="ranking-flow-header"><button onClick={() => setShowTop50(false)} aria-label="Voltar"><ArrowLeft /></button><div><h1>TOP 50 – SUA ACADEMIA</h1><p>{periodLabels[period]}</p></div></header>
    <div className="rank-selectors"><div className="rank-select-wrap"><button onClick={() => setShowPeriodPicker((current) => !current)}><CalendarDays />{periodLabels[period]}<ChevronDown /></button>{showPeriodPicker ? <div className="rank-options">{periodOptions.map((option) => <button key={option.value} onClick={() => { setPeriod(option.value); setShowPeriodPicker(false); }}><span>{option.label}</span>{option.value === period ? <span>✓</span> : null}</button>)}</div> : null}</div><div className="rank-select-wrap"><button disabled><Building2 />SUA ACADEMIA</button></div></div>
    <div className="rank-table-head"><span>POSIÇÃO</span><span>ATLETA</span><span>IGA (PONTUAÇÃO)</span></div><div className="rank-list">{loading ? <p className="rank-loading">ATUALIZANDO RANKING…</p> : athletes.slice(0, 50).map((entry, index) => <RankingRow key={entry.uid} entry={entry} rank={index + 1} current={entry.uid === user.uid} />)}</div>
    {myRank > 50 ? <RankingRow entry={myEntry} rank={myRank} current /> : null}<button className="rank-position-button" onClick={() => document.querySelector('.rank-row--current')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><CircleDot /> VER MINHA POSIÇÃO</button>
  </section>;

  return <section className="ranking-flow ranking-flow--overview">
    <header className="ranking-overview-header"><div><h1>RANKING</h1><p>SUA EVOLUÇÃO. SUA ACADEMIA.</p></div></header>
    <nav className="rank-scope-tabs"><button className="is-active"><Building2 /> ACADEMIA</button></nav>
    <article className="rank-summary-card"><div><small>SUA POSIÇÃO</small><b>{myRank ? `${myRank}º` : '—'}</b><span>de {athletes.length}</span></div><span className="rank-summary-emblem"><img src="/ranking-emblem-user-provided.png" alt="Emblema de posição Invictus" /></span><div><small>SUA PONTUAÇÃO (IGA)</small><b className="rank-gold">{Number(myEntry.score || 0).toLocaleString('pt-BR')}</b><span>Atualizado às {formatUpdatedAt(ranking?.updatedAt)}</span></div></article>
    <div className="rank-overview-selectors"><button onClick={() => setShowPeriodPicker((current) => !current)}><CalendarDays /> {periodLabels[period]} <ChevronDown /></button><button disabled><Building2 /> SUA ACADEMIA</button>{showPeriodPicker ? <div className="rank-options">{periodOptions.map((option) => <button key={option.value} onClick={() => { setPeriod(option.value); setShowPeriodPicker(false); }}>{option.label}</button>)}</div> : null}</div>
    <div className="rank-list rank-list--overview">{loading ? <p className="rank-loading">ATUALIZANDO RANKING…</p> : athletes.slice(0, 5).map((entry, index) => <RankingRow key={entry.uid} entry={entry} rank={index + 1} current={entry.uid === user.uid} />)}</div><button className="rank-top50-button" onClick={() => setShowTop50(true)}>VER TOP 50 <ArrowLeft /></button>
    <article className="rank-evolution"><h2><TrendingUp /> EVOLUÇÃO DA SUA POSIÇÃO</h2><div className="rank-evolution-empty">O histórico aparecerá após as próximas atualizações do ranking.</div></article>
    <div className="rank-mini-stats"><div><img src="/ranking-stat-athletes-reference.png" alt="Atletas no ranking" /><b>{athletes.length}</b><small>Atletas no ranking</small></div><div><img src="/ranking-stat-location-reference.png" alt="Academia" /><b>Academia</b><small>Escopo do ranking</small></div><div><img src="/ranking-stat-calendar-reference.png" alt="Calendário" /><b>{daysUntilWeekEnd()} dias</b><small>para o fim da semana</small></div><div><img src="/ranking-stat-fire-reference.png" alt="Sequência" /><b>{user.streak || 0}</b><small>dias em sequência</small></div></div>
  </section>;
}
