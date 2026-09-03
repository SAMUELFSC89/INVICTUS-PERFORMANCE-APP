
import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowRight, MapPin, Square, Timer, Zap } from 'lucide-react';
import { activityService } from '../services/activityService';
import { activityNotificationService } from '../services/activityNotificationService';
import { activityLiveActivityService } from '../services/activityLiveActivityService';

export function FloatingSessionIndicator() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeSession, setActiveSession] = useState<any>(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  // A sessão canônica fica em `activityService`. O indicador também tenta
  // restaurar uma sessão remota uma vez ao abrir o app, para que o atleta não
  // perca o acesso depois de recarregar a página ou trocar de rota.
  useEffect(() => {
    let cancelled = false;

    const applySession = (session: any) => {
      if (!session) {
        setActiveSession(null);
        return;
      }
      setActiveSession(session);
      const start = new Date(session.startTime).getTime();
      const pauseStarted = session.pauseStartedAt ? new Date(session.pauseStartedAt).getTime() : 0;
      const pausedMs = Number(session.pausedMs) || 0;
      const currentPauseMs = session.isPaused && pauseStarted ? Math.max(0, Date.now() - pauseStarted) : 0;
      setElapsedTime(Math.max(0, Math.floor((Date.now() - start - pausedMs - currentPauseMs) / 1000)));
    };

    const checkSessions = () => {
      const session = activityService.getCurrentSession();
      if (session) {
        applySession(session);
        return;
      }
      applySession(null);
    };

    checkSessions();
    if (!activityService.getCurrentSession()) {
      void activityService.restoreActiveSession().then((session) => {
        if (!cancelled && session) applySession(session);
      }).catch((error) => {
        if (!cancelled) console.warn('[FloatingSessionIndicator] Não foi possível restaurar a atividade:', error);
      });
    }
    const interval = setInterval(checkSessions, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!activeSession) return null;

  // Nessas rotas a própria tela de atividade já está visível.
  if (location.pathname.startsWith('/challenges') || location.pathname === '/activity/ongoing' || location.pathname === '/running') return null;

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const label = activeSession.type === 'workout' ? 'TREINO EM ANDAMENTO' : 'CARDIO EM ANDAMENTO';
  const modalityLabel = activeSession.type === 'cardio'
    ? (activeSession.cardioTypeLabel || 'Atividade cardio')
    : (activeSession.muscleGroup ? `Treino de ${activeSession.muscleGroup}` : 'Treino de musculação');

  const icon = activeSession.type === 'workout'
    ? <Zap size={14} className="text-primary" />
    : <MapPin size={14} className="text-secondary" />;

  const handleAction = () => {
    navigate('/activity/ongoing');
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Deseja cancelar a atividade atual? Seus pontos não serão salvos.')) {
      activityService.cancelSession();
      activityNotificationService.stop();
      activityLiveActivityService.stop();
      setActiveSession(null);
    }
  };

  return (
    <div className="floating-session-indicator">
      <motion.div
        initial={{ y: -50, opacity: 0, scale: 0.9 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: -50, opacity: 0, scale: 0.9 }}
        className="floating-session-card"
      >
        <div className="floating-session-copy">
          <div className="floating-session-icon" aria-hidden="true">
            {icon}
          </div>
          <div className="floating-session-text">
            <p><i />{label}</p>
            <strong>{modalityLabel}</strong>
            <span><Timer />{formatTime(elapsedTime)}</span>
          </div>
        </div>

        <div className="floating-session-actions">
          <button type="button" className="floating-session-open" onClick={handleAction}>
            <span>ABRIR</span><ArrowRight />
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="floating-session-cancel"
            title="Cancelar atividade"
            aria-label="Cancelar atividade"
          >
            <Square size={16} fill="currentColor" />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
