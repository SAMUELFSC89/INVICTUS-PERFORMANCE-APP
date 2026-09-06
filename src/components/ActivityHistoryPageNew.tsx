import { createPortal } from 'react-dom';
import { ArrowLeft, Bell, History, Plus, ShieldCheck, Trophy, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ActivityHistorySectionV3 } from './ActivityHistorySectionV3';
import { InvictusLogo } from './InvictusLogo';
import './ActivityHistoryPageNew.css';

export function ActivityHistoryPageNew() {
  const navigate = useNavigate();

  return createPortal(
    <main className="ah-new-screen">
      <div className="ah-new-page">
        <header className="ah-new-header">
          <button onClick={() => navigate('/challenges')} aria-label="Voltar"><ArrowLeft /></button>
          <div><InvictusLogo size={42} /><span><b>INVICTUS</b><small>PERFORMANCE</small></span></div>
          <button onClick={() => navigate('/notifications')} aria-label="Notificações"><Bell /></button>
        </header>

        <section className="ah-new-title">
          <span><History /></span>
          <div>
            <small>SUA JORNADA</small>
            <h1>ATIVIDADES</h1>
            <p>Treinos, cardio, métricas e validações em um único histórico.</p>
          </div>
        </section>

        <div className="ah-new-content"><ActivityHistorySectionV3 /></div>
      </div>

      <nav className="ah-new-footer">
        <button onClick={() => navigate('/')}><InvictusLogo size={24} /><span>Início</span></button>
        <button onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button>
        <button className="is-plus" onClick={() => navigate('/activity')} aria-label="Escolher modalidade"><Plus /></button>
        <button className="is-active" onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button>
        <button onClick={() => navigate('/profile')}><UserRound /><span>Perfil</span></button>
      </nav>
    </main>,
    document.body,
  );
}
