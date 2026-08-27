import { useEffect, useState } from 'react';
import { ArrowLeft, Building2, CalendarDays, ChevronDown, ChevronRight, CircleDot, MapPin, ShieldCheck, TrendingUp, Trophy } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { rankingService } from '../services/rankingService';
import { useUser } from '../UserContext';
import type { RankingSnapshot } from '../types';

type RankScope = 'gym' | 'city' | 'global';
type RankPeriod = 'weekly' | 'all' | 'monthly';
const scopeLabels: Record<RankScope, string> = { gym: 'ACADEMIA', city: 'CIDADE', global: 'NACIONAL' };
const periodLabels: Record<RankPeriod, string> = { weekly: 'SEMANA ATUAL', all: 'TEMPORADA', monthly: 'MÊS ATUAL' };
const periodOptions: { label: string; value: RankPeriod }[] = [{ label: 'Semana atual', value: 'weekly' }, { label: 'Mês atual', value: 'monthly' }, { label: 'Temporada', value: 'all' }];
const avatar = (entry: any) => entry.photoURL || '/capacete.webp';
const name = (entry: any) => entry.displayName || 'Atleta Invictus';
const gym = (entry: any) => entry.gymName || entry.gym || 'Academia Invictus';
const daysUntilWeekEnd = () => (7 - new Date().getDay()) % 7 || 7;
const formatUpdatedAt = (updatedAt?: string) => updatedAt ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(updatedAt)) : 'agora';

function TopAvatar({ entry, rank }: { entry: any; rank: number }) {
  const frame = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
  return <span className={`rank-avatar ${frame ? `rank-avatar--${frame}` : ''}`}><img src={avatar(entry)} alt={`Foto de ${name(entry)}`} onError={(event) => { event.currentTarget.src = '/capacete.webp'; }} />{frame && <img className="rank-avatar-frame" src={`/ranking-frame-${frame}-reference.png`} alt="" aria-hidden="true" />}</span>;
}

function RankingRow({ entry, rank, current }: { entry: any; rank: number; current?: boolean }) {
  return <div className={`rank-row ${current ? 'rank-row--current' : ''}`}><b className={`rank-number rank-number--${rank}`}>{rank}</b><TopAvatar entry={entry} rank={rank} /><span className="rank-row-name"><strong>{name(entry)}</strong><small>{gym(entry)}</small></span><span className="rank-score"><small>IGA</small><b>{Number(entry.score || 0).toLocaleString('pt-BR')}</b></span></div>;
}

export function Rankings() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [scope, setScope] = useState<RankScope>('gym');
  const [period, setPeriod] = useState<RankPeriod>('weekly');
  const [ranking, setRanking] = useState<RankingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTop50, setShowTop50] = useState(false);
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);
  const [showGymPicker, setShowGymPicker] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState('Semana atual');
  const [selectedGymId, setSelectedGymId] = useState('');
  const [selectedGymName, setSelectedGymName] = useState('SUA ACADEMIA');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    const levelId = scope === 'gym' ? selectedGymId || user.gymId || '' : scope === 'city' ? user.city || '' : '';
    rankingService.getRanking(scope, levelId, period, user.subscriptionTier === 'performance' ? 'performance' : 'open').then((data) => { if (!cancelled) setRanking(data); }).catch((error) => console.error('Falha ao carregar ranking:', error)).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, period, selectedGymId, user?.uid, user?.gymId, user?.city, user?.subscriptionTier]);

  const athletes = ranking?.topUsers || [];
  const myRank = athletes.findIndex((entry) => entry.uid === user?.uid) + 1 || user?.positions?.[scope === 'global' ? 'national' : scope] || 0;
  const myEntry = athletes.find((entry) => entry.uid === user?.uid) || { ...user, score: period === 'weekly' ? user?.weeklyScore || user?.score : user?.score };
  const academyOptions = Array.from(new Map([{ id: user.gymId || '', label: (user as any).gymName || (user as any).gym || 'Sua academia atual' }, ...athletes.map((entry: any) => ({ id: entry.gymId || '', label: gym(entry) }))].map((entry) => [entry.id || entry.label, entry])).values());
  if (!user) return null;

  if (showTop50) return <section className="ranking-flow">
    <header className="ranking-flow-header"><button onClick={() => setShowTop50(false)} aria-label="Voltar"><ArrowLeft /></button><div><h1>TOP 50 – {scope === 'gym' ? 'SUA ACADEMIA' : scopeLabels[scope]}</h1><p>{period === 'weekly' ? 'Semana atual' : periodLabels[period]}</p></div></header>
    <div className="rank-selectors"><div className="rank-select-wrap"><button onClick={() => setShowPeriodPicker(!showPeriodPicker)}><CalendarDays />{selectedWeek.toUpperCase()}<ChevronDown /></button>{showPeriodPicker && <div className="rank-options">{periodOptions.map((option) => <button key={option.value} onClick={() => { setSelectedWeek(option.label); setPeriod(option.value); setShowPeriodPicker(false); }}><span>{option.label}</span>{option.label === selectedWeek && <span>✓</span>}</button>)}</div>}</div><div className="rank-select-wrap"><button onClick={() => setShowGymPicker(!showGymPicker)}><Building2 />{selectedGymName}<ChevronDown /></button>{showGymPicker && <div className="rank-options rank-options--right">{academyOptions.map((option) => <button key={option.id || option.label} onClick={() => { setSelectedGymId(option.id); setSelectedGymName(option.label.toUpperCase()); setShowGymPicker(false); }}><span>{option.label}</span>{option.label.toUpperCase() === selectedGymName && <span>✓</span>}</button>)}</div>}</div></div>
    <div className="rank-table-head"><span>POSIÇÃO</span><span>ATLETA</span><span>IGA (PONTUAÇÃO)</span></div><div className="rank-list">{loading ? <p className="rank-loading">ATUALIZANDO RANKING…</p> : athletes.slice(0, 50).map((entry, index) => <RankingRow key={entry.uid} entry={entry} rank={index + 1} current={entry.uid === user.uid} />)}</div>
    {myRank > 0 && !athletes.slice(0, 50).some((entry) => entry.uid === user.uid) && <RankingRow entry={myEntry} rank={myRank} current />}<button className="rank-position-button" onClick={() => document.querySelector('.rank-row--current')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><CircleDot /> VER MINHA POSIÇÃO</button>
  </section>;

  return <section className="ranking-flow ranking-flow--overview">
    {/* O sino de notificacoes e GLOBAL (Layout.tsx, position:fixed no topo direito).
        Esta tela desenhava um segundo sino no proprio header, entao apareciam DOIS
        sinos sobrepostos so no Ranking. A 3a coluna do grid continua reservada
        (grid-template-columns: 2.5rem 1fr 2.5rem) justamente para o sino global
        pousar ali sem cobrir o titulo. */}
    <header className="ranking-overview-header"><div><h1>RANKING</h1><p>COMPITA. EVOLUA. SEJA INVICTUS.</p></div></header>
    
    <nav className="rank-scope-tabs">{(['gym', 'city', 'global'] as RankScope[]).map((item) => <button key={item} onClick={() => setScope(item)} className={scope === item ? 'is-active' : ''}>{item === 'gym' ? <Building2 /> : item === 'city' ? <MapPin /> : <ShieldCheck />}{scopeLabels[item]}</button>)}</nav>
    <article className="rank-summary-card"><div><small>SUA POSIÇÃO</small><b>{myRank ? `${myRank}º` : '—'}</b><span>de {athletes.length || 0}</span></div><span className="rank-summary-emblem"><img src="/ranking-emblem-user-provided.png" alt="Emblema de posição Invictus" /></span><div><small>SUA PONTUAÇÃO (IGA)</small><b className="rank-gold">{Number(myEntry.score || 0).toLocaleString('pt-BR')}</b><span>Atualizado às {formatUpdatedAt(ranking?.updatedAt)}</span></div></article>
    <div className="rank-overview-selectors"><button onClick={() => setPeriod(period === 'weekly' ? 'all' : 'weekly')}><CalendarDays /> {periodLabels[period]} <ChevronDown /></button><button onClick={() => setScope(scope === 'gym' ? 'city' : scope === 'city' ? 'global' : 'gym')}><Building2 /> {scope === 'gym' ? 'SUA ACADEMIA' : scopeLabels[scope]} <ChevronDown /></button></div>
    <div className="rank-list rank-list--overview">{loading ? <p className="rank-loading">ATUALIZANDO RANKING…</p> : athletes.slice(0, 5).map((entry, index) => <RankingRow key={entry.uid} entry={entry} rank={index + 1} current={entry.uid === user.uid} />)}</div><button className="rank-top50-button" onClick={() => setShowTop50(true)}>VER TOP 50 <ArrowLeft /></button>
    <article className="rank-evolution"><h2><TrendingUp /> EVOLUÇÃO DA SUA POSIÇÃO</h2><div className="rank-evolution-empty">O histórico da sua posição aparecerá aqui conforme o ranking for atualizado.</div></article>
    <div className="rank-mini-stats"><div><img src="/ranking-stat-athletes-reference.png" alt="Atletas no ranking" /><b>{athletes.length}</b><small>Atletas no ranking</small></div><div><img src="/ranking-stat-location-reference.png" alt="Escopo do ranking" /><b>{scopeLabels[scope]}</b><small>Escopo atual</small></div><div><img src="/ranking-stat-calendar-reference.png" alt="Calendário da semana" /><b>{daysUntilWeekEnd()} dias</b><small>para o fim da semana</small></div><div><img src="/ranking-stat-fire-reference.png" alt="Sequência de treino" /><b>{user.streak || 0}</b><small>dias em sequência</small></div></div>
  </section>;
}
