import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, CircleInfo, ShieldCheck, Trophy, TrendingUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../UserContext';
import { getNextSeasonCountdown } from '../lib/seasonUtils';

const formatNumber = (value: number) => value.toLocaleString('pt-BR');

export function League() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [countdown, setCountdown] = useState(getNextSeasonCountdown());

  useEffect(() => {
    const timer = window.setInterval(() => setCountdown(getNextSeasonCountdown()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const daysRemaining = Math.max(0, countdown.time.days);
  const score = Number(user?.weeklyScore || user?.igaAudit?.igaRanking || user?.score || 0);
  const position = Number(user?.positions?.league || user?.positions?.national || 0);
  const season = String(user?.activeSeason || '07').replace(/^.*?(\d+)$/, '$1').padStart(2, '0');

  return (
    <main className="league-screen">
      <header className="league-header">
        <button className="league-icon-button" onClick={() => navigate(-1)} aria-label="Voltar"><ArrowLeft /></button>
        <h1>LIGA INVICTUS</h1>
        <button className="league-icon-button" onClick={() => navigate('/rankings')} aria-label="Ver ranking"><CircleInfo /></button>
      </header>

      <section className="league-season" aria-label="Temporada atual">
        <h2>TEMPORADA {season}</h2>
        <p>{daysRemaining} {daysRemaining === 1 ? 'DIA RESTANTE' : 'DIAS RESTANTES'}</p>
      </section>

      <img className="league-trophy-art" src="/league-trophy-hero-v2.jpg" alt="Troféu dourado da Liga Invictus" />

      <section className="league-score-panel" aria-label="Seu desempenho na Liga">
        <div><span>SUA POSIÇÃO</span><strong>{position ? `${position}º` : '—'}</strong></div>
        <div><span>SUA PONTUAÇÃO</span><strong className="league-gold">{formatNumber(score)} PTS</strong></div>
        <button onClick={() => navigate('/rankings')}>VER RANKING <ChevronRight /></button>
      </section>

      <section className="league-rules">
        <h2>COMO FUNCIONA</h2>
        <div><Trophy /><p><b>Competição semanal de performance</b><span>Pontue com treinos e desafios validados para acompanhar sua posição.</span></p></div>
        <div><TrendingUp /><p><b>Acompanhe sua evolução</b><span>Compare sua performance com a comunidade Invictus a cada temporada.</span></p></div>
        <div><ShieldCheck /><p><b>Performance com integridade</b><span>Os registros passam por auditoria para manter a classificação justa.</span></p></div>
      </section>
    </main>
  );
}
