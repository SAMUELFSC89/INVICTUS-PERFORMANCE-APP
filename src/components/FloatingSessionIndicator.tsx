import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AlertTriangle, ArrowRight, MapPin, RefreshCw, Square, Timer, Zap } from 'lucide-react';
import { activityService } from '../services/activityService';
import { activityNotificationService } from '../services/activityNotificationService';
import { activityLiveActivityService } from '../services/activityLiveActivityService';

export function FloatingSessionIndicator() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeSession, setActiveSession] = useState<any>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const applySession = (session: any) => {
    if (!session) {
      setActiveSession(null);
      return;
    }
    setRestoreError(null);
    setActiveSession(session);
    const start = new Date(session.startTime).getTime();
    const pauseStarted = session.pauseStartedAt ? new Date(session.pauseStartedAt).getTime() : 0;
    const pausedMs = Number(session.pausedMs) || 0;
    const currentPauseMs = session.isPaused && pauseStarted ? Math.max(0, Date.now() - pauseStarted) : 0;
    setElapsedTime(Math.max(0, Math.floor((Date.now() - start - pausedMs - currentPauseMs) / 1000)));
  };

  const restoreSession = async () => {
    if (restoring) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      const session = await activityService.restoreActiveSession();
      applySession(session);
    } catch (error) {
      console.warn('[FloatingSessionIndicator] Não foi possível restaurar a atividade:', error);
      setRestoreError('Não foi possível verificar sua atividade em andamento. Confira a conexão e tente novamente.');
    } finally {
      setRestoring(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const applyIfMounted = (session: any) => {
      if (!cancelled) applySession(session);
    };

    const checkSessions = () => {
      const session = activityService.getCurrentSession();
      if (session) {
        applyIfMounted(session);
        return;
      }
      if (!restoreError) applyIfMounted(null);
    };

    checkSessions();
    if (!activityService.getCurrentSession()) {
      setRestoring(true);
      void activityService.restoreActiveSession().then((session) => {
        if (!cancelled) applySession(session);
      }).catch((error) => {
        if (!cancelled) {
          console.warn('[FloatingSessionIndicator] Não foi possível restaurar a atividade:', error);
          setRestoreError('Não foi possível verificar sua atividade em andamento. Confira a conexão e tente novamente.');
        }
      }).finally(() => {
        if (!cancelled) setRestoring(false);
      });
    }
    const interval = setInterval(checkSessions, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Nessas rotas a própria tela de atividade já está visível.
  if (location.pathname.startsWith('/challenges') || location.pathname === '/activity/ongoing' || location.pathname === '/running') return null;

  if (!activeSession && restoreError) {
    return createPortal(
      <div className="floating-session-indicator" style={{ zIndex: 9000 }} role="alert">
        <div className="floating-session-card" style={{ alignItems: 'center', gap: 12 }}>
          <div className="floating-session-copy">
            <div className="floating-session-icon" aria-hidden="true"><AlertTriangle size={16} /></div>
            <div className="floating-session-text">
              <p>ATIVIDADE EM ANDAMENTO</p>
              <strong>Não foi possível confirmar o estado do treino</strong>
              <span>{restoreError}</span>
            </div>
          </div>
          <div className="floating-session-actions">
            <button type="button" className="floating-session-open" disabled={restoring} onClick={() => void restoreSession()}>
              <span>{restoring ? 'VERIFICANDO...' : 'TENTAR NOVAMENTE'}</span><RefreshCw />
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  if (!activeSession) return null;

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const label = activeSession.type === 'workout' ? 'TREINO EM ANDAMENTO' : 'CARDIO EM ANDAMENTO';
  const modalityLabel = activeSession.type === 'cardio'
    ? (activeSession.cardioTypeLabel || 'Atividade cardio')
    : (activeSession.muscleGroup ? `Treino de ${activeSession.muscleGroup}` : 'Treino de musculação');

  const icon = activeSession.type === 'workout'
    ? <Zap size={14} className="text-primary" />
    : <MapPin size={14} className="text-secondary" />;

  const handleAction = () => navigate('/activity/ongoing');

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Deseja cancelar a atividade atual? Seus pontos não serão salvos.')) {
      activityService.cancelSession();
      activityNotificationService.stop();
      activityLiveActivityService.stop();
      setActiveSession(null);
    }
  };

  const indicator = (
    <div
      className="floating-session-indicator"
      style={{ zIndex: 9000 }}
      aria-live="polite"
    >
      <motion.div
        initial={{ y: -50, opacity: 0, scale: 0.9 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: -50, opacity: 0, scale: 0.9 }}
        className="floating-session-card"
      >
        <div className="floating-session-copy">
          <div className="floating-session-icon" aria-hidden="true">{icon}</div>
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

  // As telas novas são majoritariamente portais em document.body. Se o card
  // ficar dentro de Layout, o stacking context do shell pode colocá-lo atrás
  // da tela atual mesmo com z-index alto. Portalamos o indicador para a mesma
  // raiz visual e mantemos a camada abaixo apenas dos modais bloqueantes.
  return createPortal(indicator, document.body);
}
