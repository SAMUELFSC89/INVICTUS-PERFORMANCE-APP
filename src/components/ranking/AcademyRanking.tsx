import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, ChevronRight, LoaderCircle, Medal, RefreshCw, ShieldCheck, Trophy } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../UserContext';
import { rankingService, type AcademyRankingPeriod } from '../../services/rankingService';
import type { RankingEntry, RankingSnapshot } from '../../types';
import { PodiumTopThree } from './PodiumTopThree';
import './AcademyRanking.css';

const periods: { value: AcademyRankingPeriod; label: string }[] = [
  { value: 'weekly', label: 'SEMANA' },
  { value: 'monthly', label: 'MÊS' },
  { value: 'all', label: 'TEMPORADA' },
];
const fallbackAvatar = '/capacete.webp';

function RankingRow({ entry, currentUserId, onSelect }: {
  entry: RankingEntry;
  currentUserId: string;
  onSelect: (uid: string) => void;
}) {
  const isCurrent = entry.uid === currentUserId;
  return <button type="button" className={`academy-ranking-row${isCurrent ? ' is-current' : ''}`} onClick={() => onSelect(entry.uid)}>
    <b className="academy-ranking-position">{entry.rank}º</b>
    <img src={entry.photoURL || fallbackAvatar} alt="" onError={(event) => { event.currentTarget.src = fallbackAvatar; }} />
    <span><strong>{entry.displayName || 'Atleta Invictus'}{isCurrent ? <em>VOCÊ</em> : null}</strong>{Number(entry.streak) > 0 ? <small>{entry.streak} dias em sequência</small> : <small>Atleta da sua academia</small>}</span>
    <b className="academy-ranking-score">{Number(entry.score || 0).toLocaleString('pt-BR')}<small>IGA</small></b>
    <ChevronRight aria-hidden="true" />
  </button>;
}

export function AcademyRanking() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [period, setPeriod] = useState<AcademyRankingPeriod>('weekly');
  const [ranking, setRanking] = useState<RankingSnapshot | null>(null);
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [visibleCount, setVisibleCount] = useState(20);

  const loadRanking = useCallback(async (force = false) => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const result = await rankingService.getAcademyRanking(period, force);
      setRanking(result);
      setEnrolled(result.enrolled === true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o ranking da academia.');
    } finally {
      setLoading(false);
    }
  }, [period, user?.uid]);

  useEffect(() => {
    if (!user) return;
    if (!user.gymId) {
      setEnrolled(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    rankingService.getEnrollment()
      .then((state) => { if (!cancelled) setEnrolled(state.enrolled); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Falha ao consultar sua adesão.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.uid, user?.gymId]);

  useEffect(() => {
    if (enrolled !== true) return;
    void loadRanking();
  }, [enrolled, loadRanking]);

  useEffect(() => setVisibleCount(20), [period]);

  const athletes = ranking?.topUsers || [];
  const rows = athletes.slice(3, visibleCount);
  const currentEntry = ranking?.currentUser || athletes.find((entry) => entry.uid === user?.uid) || null;
  const showCurrentCard = currentEntry && currentEntry.rank > visibleCount;
  const gymName = ranking?.gymName || user?.gymName || 'Sua academia';
  const updatedAt = useMemo(() => ranking?.updatedAt
    ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(ranking.updatedAt))
    : '', [ranking?.updatedAt]);

  if (!user) return null;

  const enroll = async () => {
    setWorking(true);
    setError('');
    try {
      await rankingService.enroll();
      setEnrolled(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível entrar no ranking.');
    } finally {
      setWorking(false);
    }
  };

  const withdraw = async () => {
    if (!window.confirm('Sair do ranking remove sua participação e reinicia a pontuação competitiva. Deseja continuar?')) return;
    setWorking(true);
    setError('');
    try {
      await rankingService.withdraw();
      setRanking(null);
      setEnrolled(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível sair do ranking.');
    } finally {
      setWorking(false);
    }
  };

  if (!user.gymId) return <section className="academy-ranking-state">
    <Building2 />
    <h2>VINCULE SUA ACADEMIA</h2>
    <p>Cadastre sua academia no perfil para acessar uma classificação privada entre atletas do mesmo local.</p>
    <button type="button" onClick={() => navigate('/profile/academy')}>CADASTRAR ACADEMIA <ChevronRight /></button>
  </section>;

  if (loading && enrolled === null) return <section className="academy-ranking-state academy-ranking-loading" aria-live="polite"><LoaderCircle /><p>CARREGANDO RANKING…</p></section>;

  if (enrolled !== true) return <section className="academy-ranking-state academy-ranking-consent">
    <ShieldCheck />
    <h2>ENTRAR NO RANKING DA ACADEMIA</h2>
    <p>A participação é opcional. Seu nome, foto e pontuação IGA ficam visíveis somente para participantes vinculados à mesma academia.</p>
    <ul><li>FREE e PRO competem pela mesma regra.</li><li>Não existe comparação nacional ou entre academias.</li><li>Você pode sair quando quiser.</li></ul>
    {error ? <p className="academy-ranking-error" role="alert">{error}</p> : null}
    <button type="button" onClick={enroll} disabled={working}>{working ? 'ENTRANDO…' : 'ACEITAR E ENTRAR'} <ChevronRight /></button>
  </section>;

  return <section className="academy-ranking-content">
    <header className="academy-ranking-header">
      <span><Trophy /></span>
      <div><small>CLASSIFICAÇÃO EXCLUSIVA</small><h1>RANKING DA ACADEMIA</h1><p><Building2 /> {gymName}</p></div>
    </header>

    <div className="academy-ranking-periods" role="tablist" aria-label="Período do ranking">
      {periods.map((option) => <button type="button" role="tab" aria-selected={period === option.value} className={period === option.value ? 'is-active' : ''} key={option.value} onClick={() => setPeriod(option.value)}>{option.label}</button>)}
    </div>

    {loading && !ranking ? <section className="academy-ranking-state academy-ranking-loading" aria-live="polite"><LoaderCircle /><p>ATUALIZANDO CLASSIFICAÇÃO…</p></section> : error ? <section className="academy-ranking-state">
      <RefreshCw /><h2>NÃO FOI POSSÍVEL CARREGAR</h2><p>{error}</p><button type="button" onClick={() => void loadRanking(true)}>TENTAR NOVAMENTE <RefreshCw /></button>
    </section> : athletes.length === 0 ? <section className="academy-ranking-state">
      <Medal /><h2>O PÓDIO AINDA ESTÁ ABERTO</h2><p>Nenhum participante possui pontuação validada neste período.</p>
    </section> : <>
      <PodiumTopThree entries={athletes.slice(0, 3)} currentUserId={user.uid} onSelect={(uid) => navigate(`/profile/${uid}`)} />
      <div className="academy-ranking-meta"><span>{Number(ranking?.participantCount || athletes.length).toLocaleString('pt-BR')} participantes</span><span>Atualizado às {updatedAt}</span></div>
      {showCurrentCard ? <section className="academy-current-position"><small>SUA POSIÇÃO</small><RankingRow entry={currentEntry} currentUserId={user.uid} onSelect={(uid) => navigate(`/profile/${uid}`)} /></section> : null}
      {rows.length ? <section className="academy-ranking-list" aria-label="Demais posições">
        {rows.map((entry) => <RankingRow key={entry.uid} entry={entry} currentUserId={user.uid} onSelect={(uid) => navigate(`/profile/${uid}`)} />)}
      </section> : null}
      {visibleCount < athletes.length ? <button type="button" className="academy-ranking-more" onClick={() => setVisibleCount((count) => Math.min(count + 20, athletes.length))}>MOSTRAR MAIS POSIÇÕES</button> : null}
    </>}

    <footer className="academy-ranking-footer"><ShieldCheck /><span>Somente atletas vinculados à mesma academia aparecem aqui. O Power Lift mantém classificações próprias por modalidade.</span><button type="button" onClick={withdraw} disabled={working}>SAIR DO RANKING</button></footer>
  </section>;
}
