
import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Square, Timer, Zap, MapPin } from 'lucide-react';
import { activityService } from '../services/activityService';

export function FloatingSessionIndicator() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeSession, setActiveSession] = useState<any>(null);
  const [runningSession, setRunningSession] = useState<boolean>(false);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Check for sessions every 2 seconds
  useEffect(() => {
    const checkSessions = () => {
      // 1. Check Activity Service (Workout/Cardio)
      const session = activityService.getCurrentSession();
      if (session) {
        setActiveSession(session);
        setRunningSession(false);
        const start = new Date(session.startTime).getTime();
        const seconds = Math.floor((Date.now() - start) / 1000);
        if (seconds > 5400) { // Auto expire > 90m
          activityService.cancelSession();
          setActiveSession(null);
          return;
        }
        setElapsedTime(seconds);
        return;
      }

      // 2. Check Running Tracker (KM Fatal)
      const isRunning = localStorage.getItem('kmfatal_active_run') === 'true';
      if (isRunning) {
        const startTime = localStorage.getItem('kmfatal_start_time');
        if (startTime) {
          const seconds = Math.floor((Date.now() - parseInt(startTime)) / 1000);
          if (seconds > 9000) { // Auto expire > 2.5h
            localStorage.removeItem('kmfatal_active_run');
            localStorage.removeItem('kmfatal_start_time');
            localStorage.removeItem('kmfatal_total_distance');
            localStorage.removeItem('kmfatal_run_points');
            setRunningSession(false);
            return;
          }
          setRunningSession(true);
          setActiveSession(null);
          setElapsedTime(seconds);
          return;
        }
      }

      setActiveSession(null);
      setRunningSession(false);
    };

    checkSessions();
    const interval = setInterval(checkSessions, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!activeSession && !runningSession) return null;

  // Don't show if we are already on the challenges or running page depending on the session type
  if (activeSession && location.pathname.startsWith('/challenges')) return null;
  if (runningSession && location.pathname === '/running') return null;

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const label = activeSession 
    ? (activeSession.type === 'workout' ? 'TREINO ATIVO' : 'CARDIO ATIVO')
    : 'CORRIDA EM CURSO';

  const icon = activeSession?.type === 'workout' 
    ? <Zap size={14} className="text-primary" />
    : <MapPin size={14} className="text-secondary" />;

  const handleAction = () => {
    if (activeSession) navigate('/challenges');
    else navigate('/challenges/cardio');
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Deseja cancelar a atividade atual? Seus pontos não serão salvos.')) {
      activityService.cancelSession();
      localStorage.removeItem('kmfatal_active_run');
      localStorage.removeItem('kmfatal_start_time');
      localStorage.removeItem('kmfatal_total_distance');
      localStorage.removeItem('kmfatal_run_points');
      setActiveSession(null);
      setRunningSession(false);
    }
  };

  return (
    <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] w-full max-w-sm px-6 pointer-events-none">
      <motion.div
        initial={{ y: -50, opacity: 0, scale: 0.9 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: -50, opacity: 0, scale: 0.9 }}
        onClick={handleAction}
        className="pointer-events-auto bg-black/90 backdrop-blur-2xl border border-primary/20 rounded-[24px] p-4 shadow-2xl flex items-center justify-between gap-4 cursor-pointer hover:border-primary/40 transition-all group"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center animate-pulse">
            {icon}
          </div>
          <div>
            <p className="text-[10px] font-black text-primary uppercase tracking-widest leading-none mb-1">{label}</p>
            <div className="flex items-center gap-2">
              <Timer size={14} className="text-on-surface/40" />
              <span className="font-headline italic font-black text-xl text-on-surface leading-none">{formatTime(elapsedTime)}</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="bg-primary text-black px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 group-hover:scale-105 transition-transform shadow-lg shadow-primary/20">
            ABRIR
          </div>
          <button 
            onClick={handleCancel}
            className="w-10 h-10 bg-red-500/20 rounded-xl flex items-center justify-center text-red-500 hover:bg-red-500 hover:text-white transition-all pointer-events-auto"
            title="Encerrar Atividade (Panic Stop)"
          >
             <Square size={16} fill="currentColor" />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
