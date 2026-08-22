
import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Pause, Square, MapPin, Zap, Timer, Ruler,
  AlertCircle, CheckCircle2, XCircle, Camera,
  RefreshCw, ChevronRight, Share2, Map as MapIcon,
  Navigation, User
} from 'lucide-react';
import { MapContainer, TileLayer, Polyline, useMap, Circle, Marker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { RunPoint, RunSession, runningService } from '../services/runningService';
import { getFriendlyMessage } from '../services/validationMessages';
import { calculateDistance, formatDuration, calculatePace } from '../lib/runUtils';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useUser } from '../UserContext';
import { requestAllNativePermissions } from '../lib/nativePermissions';

// Fix for default marker icons in Leaflet with React
import L from 'leaflet';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

interface RunTrackerProps {
  onClose: () => void;
  onFinished: (session: RunSession) => void;
  onPresenceCheckRequired?: (data: { presenceCheckId: string; livenessPrompt: string; userMessage?: string }) => void;
}

// Helper to auto-center map on current position
function ChangeView({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
}

export function RunTracker({ onClose, onFinished, onPresenceCheckRequired }: RunTrackerProps) {
  const { user } = useUser();
  const [isTracking, setIsTracking] = useState(() => {
    return localStorage.getItem('kmfatal_active_run') === 'true';
  });
  const [startTime, setStartTime] = useState<number | null>(() => {
    const saved = localStorage.getItem('kmfatal_start_time');
    return saved ? parseInt(saved) : null;
  });
  const [elapsedTime, setElapsedTime] = useState(0);
  const [points, setPoints] = useState<RunPoint[]>(() => {
    const saved = localStorage.getItem('kmfatal_run_points');
    return saved ? JSON.parse(saved) : [];
  });
  const [totalDistance, setTotalDistance] = useState(() => {
    const saved = localStorage.getItem('kmfatal_total_distance');
    return saved ? parseFloat(saved) : 0;
  }); // meters
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [rollingPace, setRollingPace] = useState<string>('--:--');
  // Pausa: semaforo, cadarco, banheiro. Sem isto o atleta precisava encerrar a
  // atividade de verdade, ou aceitar que o pace afundasse.
  const [isPaused, setIsPaused] = useState(() => localStorage.getItem('kmfatal_paused') === 'true');
  const isPausedRef = useRef(isPaused);
  // Tempo total ja passado em pausa. Sai do cronometro e do pace.
  const pausedMsRef = useRef<number>(Number(localStorage.getItem('kmfatal_paused_ms') || 0));
  const pauseStartRef = useRef<number | null>(
    localStorage.getItem('kmfatal_paused') === 'true' ? Number(localStorage.getItem('kmfatal_pause_start') || Date.now()) : null
  );
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [watchId, setWatchId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsSignal, setGpsSignal] = useState<'SEARCHING' | 'WEAK' | 'STRONG'>('SEARCHING');
  const [permissionStatus, setPermissionStatus] = useState<PermissionState | null>(null);
  const wakeLockRef = useRef<any>(null);

  // Post-run state
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [photoProof, setPhotoProof] = useState<string | null>(null);
  const [finalSession, setFinalSession] = useState<RunSession | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);

  // Buffer for smoothing pace (last 10 seconds)
  const paceBufferRef = useRef<{ dist: number, time: number }[]>([]);

  // Apaga o rascunho local da atividade. So deve ser chamado depois que o
  // servidor confirmou o registro, ou quando o atleta descarta a atividade.
  const limparPersistencia = () => {
    localStorage.removeItem('kmfatal_active_run');
    localStorage.removeItem('kmfatal_start_time');
    localStorage.removeItem('kmfatal_total_distance');
    localStorage.removeItem('kmfatal_run_points');
    localStorage.removeItem('kmfatal_paused');
    localStorage.removeItem('kmfatal_paused_ms');
    localStorage.removeItem('kmfatal_pause_start');
  };

  // Persistence effect
  useEffect(() => {
    if (isTracking) {
      localStorage.setItem('kmfatal_active_run', 'true');
      localStorage.setItem('kmfatal_start_time', startTime?.toString() || '');
      localStorage.setItem('kmfatal_total_distance', totalDistance.toString());
      localStorage.setItem('kmfatal_run_points', JSON.stringify(points));
      localStorage.setItem('kmfatal_paused', isPaused ? 'true' : 'false');
      localStorage.setItem('kmfatal_paused_ms', String(pausedMsRef.current));
      if (pauseStartRef.current) localStorage.setItem('kmfatal_pause_start', String(pauseStartRef.current));
      else localStorage.removeItem('kmfatal_pause_start');
    } else if (!isFinalizing) {
      // So limpa quando a atividade foi descartada. Durante a finalizacao o
      // rascunho PRECISA sobreviver: se o Android matar o app enquanto a foto
      // sobe, e ele que devolve a corrida ao atleta.
      limparPersistencia();
    }
  }, [isTracking, startTime, totalDistance, points, isFinalizing, isPaused]);

  // Tempo real de atividade: relogio de parede menos tudo que foi pausado,
  // inclusive a pausa que ainda esta correndo agora.
  function calcularDecorrido(now: number) {
    if (!startTimeRef.current) return 0;
    const pausaCorrente = pauseStartRef.current ? now - pauseStartRef.current : 0;
    return Math.max(0, Math.floor((now - startTimeRef.current - pausedMsRef.current - pausaCorrente) / 1000));
  }

  // Handle Visibility change to ensure background continuity
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isTracking && startTimeRef.current) {
        setElapsedTime(calcularDecorrido(Date.now()));
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isTracking]);

  // Use a ref for startTime to avoid closure issues and handle background jumps
  const startTimeRef = useRef<number | null>(startTime);
  const lastPointRef = useRef<RunPoint | null>(points[points.length - 1] || null);

  // Average Pace logic (Overall)
  const averagePace = calculatePace(totalDistance, elapsedTime);

  // Check permission status
  useEffect(() => {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' as any }).then(status => {
        setPermissionStatus(status.state);
        status.onchange = () => setPermissionStatus(status.state);
      });
    }
  }, []);

  // Request permission explicitly
  const requestPermission = async () => {
    setError(null);
    try {
      await requestAllNativePermissions();
    } catch (e) {
      console.warn('[RunTracker] requestAllNativePermissions error:', e);
    }
    navigator.geolocation.getCurrentPosition(
      () => {
        setPermissionStatus('granted');
      },
      (err) => {
        console.error('Permission error:', err);
        if (err.code === 1) setError('Permissão de GPS negada. Ative nas configurações do seu celular.');
        else setError('Erro ao acessar GPS. Verifique se a localização está ativa.');
      },
      { enableHighAccuracy: true }
    );
  };

  // GPS Tracking Core Logic
  useEffect(() => {
    if (!navigator.geolocation) {
      setError('Geolocalização não suportada no seu navegador.');
      return;
    }

    const options = {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0 // Do not use cached positions
    };

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, speed, accuracy, altitude } = pos.coords;
        const timestamp = pos.timestamp;
        
        setGpsAccuracy(accuracy);
        setGpsSignal(accuracy < 20 ? 'STRONG' : accuracy < 50 ? 'WEAK' : 'SEARCHING');

        // Points filtering & Smoothing
        setPoints((prev) => {
          const newPoint: RunPoint = {
            lat,
            lng,
            timestamp,
            speed: speed || 0,
            accuracy: accuracy || 0,
            altitude: altitude || 0
          };

          if (isTracking && !isPausedRef.current && lastPointRef.current && calcularDecorrido(Date.now()) < 5400) {
            const last = lastPointRef.current;
            const dist = calculateDistance(last.lat, last.lng, lat, lng);
            const timeDiff = (timestamp - last.timestamp) / 1000;
            
            // PROFESSIONAL FILTERS:
            // 1. Accuracy Threshold (Ignore points with accuracy > 20m)
            // 2. Unrealistic Velocity (Max 10m/s = 36km/h for a runner)
            // 3. Jitter (Minimum distance to account for movement)
            const velocity = timeDiff > 0 ? dist / timeDiff : 0;
            const isAccurate = accuracy < 25; 
            const isPlausible = velocity < 12; // 43 km/h cap for human world records plus margin
            const hasMoved = dist > 1.5; 

            if (isAccurate && isPlausible && hasMoved) {
               setTotalDistance(d => d + dist);
               
               // Update rolling pace buffer (last 10 seconds)
               paceBufferRef.current.push({ dist, time: timeDiff });
               const tenSecondsAgo = timestamp - 10000;
               // We don't have timestamp in buffer yet, so we just maintain size
               if (paceBufferRef.current.length > 8) paceBufferRef.current.shift();
               
               // Calculate instant pace from buffer
               const bufferDist = paceBufferRef.current.reduce((acc, p) => acc + p.dist, 0);
               const bufferTime = paceBufferRef.current.reduce((acc, p) => acc + p.time, 0);
               if (bufferDist > 10 && bufferTime > 2) {
                 setRollingPace(calculatePace(bufferDist, bufferTime));
               }
            }
          }

          lastPointRef.current = newPoint;
          setCurrentSpeed(speed || 0);

          if (!isTracking) return [newPoint];
          // Em pausa continuamos lendo o GPS (para saber onde o atleta esta ao
          // retomar), mas o trajeto nao recebe esses pontos: senao a linha do
          // mapa atravessaria o caminho andado durante a pausa.
          if (isPausedRef.current) return prev;
          return [...prev, newPoint];
        });
      },
      (err) => {
        console.error('GPS Source Error:', err);
        if (err.code === 1) {
          setError('Permissão de GPS negada. Ative nas configurações do navegador.');
          setPermissionStatus('denied');
        } else if (err.code === 2) {
          setError('Sinal de GPS indisponível.');
        }
      },
      options
    );

    setWatchId(id);

    return () => {
      if (id !== null) navigator.geolocation.clearWatch(id);
    };
  }, [isTracking]);

  // Handle timer with background resiliency
  useEffect(() => {
    if (isTracking && startTime) {
      startTimeRef.current = startTime;
      timerRef.current = window.setInterval(() => {
        const now = Date.now();
        const diff = calcularDecorrido(now);
        if (diff >= 5400) {
          setElapsedTime(5400);
          setLimitMessage("Limite máximo de tempo atingido! Seu treino foi congelado em 90 minutos para evitar leituras excessivas. A validação final foi iniciada.");
          stopTracking();
        } else {
          setElapsedTime(diff);
        }
      }, 1000); 
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isTracking, startTime]);

  // O GPS esta bom o bastante para comecar. Enquanto isto e falso o botao fica
  // desabilitado mostrando a precisao atual -- em vez de aceitar o toque e
  // responder com um alerta que nao diz quanto falta esperar.
  const gpsPronto = gpsAccuracy !== null && gpsAccuracy <= 50;

  /** Toque no botao iniciar: da 3 segundos para guardar o celular. */
  const pedirInicio = () => {
    if (!gpsPronto || countdown !== null) return;
    setCountdown(3);
  };

  const cancelarInicio = () => setCountdown(null);

  // Contagem regressiva antes de gravar de fato.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      setCountdown(null);
      startTracking();
      return;
    }
    const t = window.setTimeout(() => setCountdown(c => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const startTracking = async () => {
    // Request Wake Lock
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      } catch (err) {
        console.warn('Wake Lock request failed:', err);
      }
    }
    
    setTotalDistance(0);
    setElapsedTime(0);
    setPoints([]);
    setRollingPace('--:--');
    paceBufferRef.current = [];

    // Zera a contabilidade de pausa da atividade anterior.
    pausedMsRef.current = 0;
    pauseStartRef.current = null;
    isPausedRef.current = false;
    setIsPaused(false);
    setConfirmingStop(false);

    const now = Date.now();
    setStartTime(now);
    startTimeRef.current = now;
    setIsTracking(true);
    setError(null);
  };

  const alternarPausa = () => {
    const now = Date.now();
    if (isPausedRef.current) {
      // Retomando: fecha a pausa corrente e soma ao acumulado.
      pausedMsRef.current += now - (pauseStartRef.current ?? now);
      pauseStartRef.current = null;
      isPausedRef.current = false;
      setIsPaused(false);
    } else {
      pauseStartRef.current = now;
      isPausedRef.current = true;
      setIsPaused(true);
      // Zera o pace instantaneo: o buffer e de 8 leituras, e sem isto o
      // primeiro pace apos retomar sairia do trecho anterior a pausa.
      paceBufferRef.current = [];
      setRollingPace('--:--');
    }
  };

  /** Toque no botao vermelho. Encerrar exige um segundo toque. */
  const pedirParada = () => setConfirmingStop(true);

  function stopTracking() {
    // Se estava em pausa, fecha a conta antes de montar a sessao.
    if (pauseStartRef.current) {
      pausedMsRef.current += Date.now() - pauseStartRef.current;
      pauseStartRef.current = null;
      isPausedRef.current = false;
      setIsPaused(false);
    }
    setConfirmingStop(false);
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (timerRef.current !== null) clearInterval(timerRef.current);
    
    // Release Wake Lock
    if (wakeLockRef.current) {
      wakeLockRef.current.release().then(() => {
        wakeLockRef.current = null;
      });
    }
    
    setIsTracking(false);
    prepareFinalSession();
  }

  function prepareFinalSession() {
    let sessionPoints = points;
    if (sessionPoints.length === 0) {
      // Sem trajeto gravado, o melhor que temos e a ultima posicao conhecida.
      // Se nem isso existe, a sessao vai SEM pontos de proposito: inventar
      // lat 0 / lng 0 aponta para o meio do Atlantico e entrava no antifraude
      // como se fosse coordenada real.
      sessionPoints = lastPointRef.current ? [lastPointRef.current] : [];
    }

    const maxSpeed = sessionPoints.length > 0 ? Math.max(...sessionPoints.map(p => p.speed)) : 0;
    const avgSpeed = elapsedTime > 0 ? totalDistance / elapsedTime : 0;
    const isZeroMovement = totalDistance < 100; // less than 100 meters = no movement

    const session: RunSession = {
      userId: user?.uid || 'anonymous',
      startTime: new Date(startTime || Date.now()).toISOString(),
      endTime: new Date().toISOString(),
      points: sessionPoints,
      totalDistance,
      avgPace: averagePace,
      maxSpeed,
      avgSpeed,
      confidenceScore: isZeroMovement ? 0 : 100,
      validationStatus: isZeroMovement ? 'INVALID' : 'VALID',
    };

    setFinalSession(session);
    setIsFinalizing(true);
    // O rascunho em localStorage NAO e apagado aqui. Ele so sai depois que o
    // servidor aceitar a atividade, em submitSession.
  }

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => setPhotoProof(event.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const submitSession = async () => {
    if (!finalSession) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const payload = {
        ...finalSession,
        photoProof,
        km: totalDistance / 1000,
        timeSeconds: elapsedTime,
        pace: averagePace,
        calories: Math.floor((totalDistance / 1000) * 70),
        elevationGain: 0, // Needs altimeter or API
        steps: Math.floor((totalDistance / 1000) * 1400),
        trajectory: points.map(p => ({ lat: p.lat, lng: p.lng, timestamp: p.timestamp })),
        date: finalSession.startTime,
        session: finalSession // Nested for audit
      };

      const result = await runningService.addRun(payload);
      if (result) {
        if ((result as any).presenceCheckRequired) {
          if (onPresenceCheckRequired) {
            onPresenceCheckRequired(result as any);
          } else {
            throw new Error((result as any).userMessage || 'Verificação de presença requerida.');
          }
          return;
        }

        if ((result as any).status === 'not_validated' || (result as any).reasonCode === 'NO_MOVEMENT_DETECTED' || (result as any).success === false) {
          // Sem texto vindo do servidor, cai no catalogo de mensagens em vez de
          // um texto cru embutido aqui -- era assim que a tela escapava do tom
          // definido em validationMessages.
          const refusalMsg = (result as any).userMessage
            || (result as any).message
            || getFriendlyMessage((result as any).reasonCode || 'NO_MOVEMENT_DETECTED');
          setSubmitError(refusalMsg);
          return;
        }

        // Aceita pelo servidor: agora sim o rascunho local pode sair.
        limparPersistencia();
        onFinished({
            ...finalSession,
            id: result.sessionId || finalSession.id,
            validationStatus: result.validation?.status || 'VALID',
            confidenceScore: result.validation?.score || 100,
            pointsEarned: (result as any).pointsEarned ?? (result as any).pointsAwarded,
            isScoringEligible: (result as any).isScoringEligible
        });
      }
    } catch (err: any) {
      console.error('Submit Run Error:', err);
      setSubmitError(err.message || 'Erro ao salvar corrida. Tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const lastPoint = points.length > 0 ? points[points.length - 1] : null;
  const center: [number, number] = lastPoint ? [lastPoint.lat, lastPoint.lng] : [0, 0];

  // Custom runner icon
  const runnerIcon = L.divIcon({
    html: `
      <div class="relative flex items-center justify-center">
        <div class="absolute w-10 h-10 bg-primary/30 rounded-full animate-ping"></div>
        <div class="relative w-8 h-8 bg-primary rounded-full flex items-center justify-center border-2 border-white shadow-lg">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
        </div>
      </div>
    `,
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  if (isFinalizing && finalSession) {
    return (
      <div className="fixed inset-0 z-[200] bg-background flex flex-col">
        <div className="p-6 border-b border-outline-variant/10 flex items-center justify-between">
           <h2 className="font-headline italic font-black text-2xl text-on-surface uppercase tracking-tight">RESUMO DA CORRIDA</h2>
           <button
             onClick={() => {
               // Descartar e uma escolha explicita, e a atividade some. Por isso
               // pergunta antes -- este X fica a um toque do resumo.
               if (!window.confirm('Descartar esta atividade? Ela não será registrada e não pode ser recuperada.')) return;
               limparPersistencia();
               onClose();
             }}
             className="p-2 text-on-surface-variant"
           ><XCircle /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
           {totalDistance < 100 && (
             <div className="bg-rose-500/10 border border-rose-500/30 p-4 rounded-2xl flex items-start gap-3 text-rose-400 font-sans">
               <AlertCircle size={20} className="shrink-0 mt-0.5" />
               <div className="space-y-1">
                 <p className="text-xs font-black uppercase tracking-wide">Sem deslocamento detectado</p>
                 <p className="text-[10px] text-rose-200/80 leading-relaxed">
                   {getFriendlyMessage('NO_MOVEMENT_DETECTED')}
                 </p>
               </div>
             </div>
           )}

           {limitMessage && (
             <div className="bg-primary/10 border border-primary/20 p-4 rounded-xl flex items-center gap-3 text-primary font-label text-[10px] font-bold uppercase leading-snug">
               <AlertCircle size={16} className="shrink-0" />
               <span>{limitMessage}</span>
             </div>
           )}

           {submitError && (
             <div className="bg-error/10 border border-error/20 p-4 rounded-xl flex items-center gap-3 text-error font-label text-[10px] font-bold uppercase">
               <AlertCircle size={16} /> {submitError}
             </div>
           )}

           <div className="grid grid-cols-2 gap-4">
              <StatItem label="Distância" value={`${(totalDistance/1000).toFixed(2)} km`} icon={<Ruler className="text-primary" />} />
              <StatItem label="Tempo" value={formatDuration(elapsedTime)} icon={<Timer className="text-secondary" />} />
              <StatItem label="Ritmo Médio" value={averagePace} icon={<Zap className="text-prize-gold" />} />
              <StatItem label="Vel. Máxima" value={`${(Math.max(...points.map(p => p.speed)) * 3.6).toFixed(1)} km/h`} icon={<Navigation size={18} className="text-blue-500" />} />
           </div>

           <div className="bg-surface-container rounded-3xl p-6 border border-outline-variant/10 space-y-4">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">FOTO DE PROVA (OPCIONAL)</h3>
              <div className="aspect-video bg-black/40 rounded-2xl border-2 border-dashed border-outline-variant/20 flex flex-col items-center justify-center overflow-hidden relative group">
                 {photoProof ? (
                    <img src={photoProof} alt="Proof" className="w-full h-full object-cover" />
                 ) : (
                    <div className="text-center space-y-2">
                       <Camera className="mx-auto opacity-30" size={32} />
                       <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">Selfie ou foto do ambiente</p>
                    </div>
                 )}
                 <button 
                   onClick={() => fileInputRef.current?.click()}
                   className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-on-surface text-surface px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl"
                 >
                   {photoProof ? 'TROCAR FOTO' : 'TIRAR FOTO'}
                 </button>
                 <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoUpload} />
              </div>
           </div>

           <div className="p-4 bg-primary/5 rounded-2xl border border-primary/20">
              <div className="flex gap-3">
                 <AlertCircle className="text-primary" size={20} />
                 <p className="text-[10px] font-medium text-on-surface-variant leading-relaxed">
                   Sua corrida será analisada pelo nosso sistema antifraude. Apenas atividades validadas contam para o ranking oficial.
                 </p>
              </div>
           </div>
        </div>

        <div className="p-6 bg-surface-container border-t border-outline-variant/10">
           <button 
             onClick={submitSession}
             disabled={isSubmitting}
             className="w-full bg-primary text-black py-5 rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-primary/20 flex items-center justify-center gap-3 disabled:opacity-50"
           >
             {isSubmitting ? <RefreshCw className="animate-spin" /> : <>FINALIZAR E VALIDAR <ChevronRight /></>}
           </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] bg-background flex flex-col overflow-hidden">
      {/* Tracker Background */}
      <div className="absolute inset-0 z-0 opacity-5 pointer-events-none">
        <img 
          src="https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?auto=format&fit=crop&q=80&w=1080" 
          className="w-full h-full object-cover grayscale" 
          alt="" 
        />
      </div>

      {/* Header Stats */}
      <div className="p-6 bg-surface-container-low/80 backdrop-blur-md border-b border-outline-variant/10 relative z-10">
         <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
               <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center animate-pulse">
                  <Zap className="text-primary fill-current" size={20} />
               </div>
               <div>
                  <h2 className="text-lg font-black text-on-surface italic uppercase tracking-tighter">KM FATAL TRACKER</h2>
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest opacity-60">
                    {isTracking ? 'Gravando atividade...' : 'Aguardando início...'}
                  </p>
               </div>
            </div>
            <button onClick={onClose} className="p-2 text-on-surface-variant hover:text-on-surface transition-colors">
               <XCircle size={28} />
            </button>
         </div>

         <div className="grid grid-cols-3 gap-2">
            <RealTimeStat label="KM" value={(totalDistance/1000).toFixed(2)} />
            <RealTimeStat label="TEMPO" value={formatDuration(elapsedTime)} />
            <RealTimeStat label="RITMO" value={isTracking ? rollingPace : averagePace} />
         </div>
      </div>

      {/* Map Content */}
      <div className="flex-1 relative bg-surface-container-highest">
         {lastPoint && (
           <MapContainer 
             center={center} 
             zoom={16} 
             className="w-full h-full z-0"
             zoomControl={false}
           >
             <TileLayer
               url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
               attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
             />
             <Polyline positions={points.map(p => [p.lat, p.lng])} color="#FFD700" weight={5} opacity={0.8} />
             <Circle center={center} radius={lastPoint.accuracy || 10} pathOptions={{ color: '#FFD700', fillColor: '#FFD700', fillOpacity: 0.1 }} />
             <Marker position={center} icon={runnerIcon} />
             <ChangeView center={center} />
           </MapContainer>
         )}

         {!lastPoint && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm z-10 text-center p-8 space-y-4">
               <div className="absolute inset-0 z-0 opacity-20 pointer-events-none">
                  <img src="https://images.unsplash.com/photo-1594882645126-14020914d58d?auto=format&fit=crop&q=80&w=1080" className="w-full h-full object-cover" alt="" />
               </div>

               <div className="relative z-10 space-y-6 flex flex-col items-center">
                  <div className="w-20 h-20 bg-primary/20 border border-primary/30 rounded-3xl flex items-center justify-center shadow-2xl animate-pulse">
                     <MapPin className="text-primary" size={36} />
                  </div>
                  <div className="space-y-1">
                     <p className="font-headline italic font-black text-xl text-white uppercase tracking-tight">SINAL DE LOCALIZAÇÃO</p>
                     <p className="text-[10px] font-black text-white/60 uppercase tracking-widest leading-relaxed">
                       {permissionStatus === 'denied' ? 'Acesso negado' : gpsAccuracy ? (gpsSignal === 'STRONG' ? 'Sinal Ativo' : 'Sinal Instável') : 'Buscando sua localização...'} <br/>
                       {gpsAccuracy && gpsSignal === 'WEAK' && "Vá para um local mais aberto para melhorar o sinal."}
                       {!gpsAccuracy && !error && permissionStatus !== 'granted' && (
                         <span className="text-primary block mt-2 animate-bounce">Aguardando permissão do navegador...</span>
                       )}
                     </p>
                     
                     {gpsAccuracy && (
                       <div className="mt-4 flex gap-1 justify-center">
                          {[1,2,3,4,5].map(i => (
                            <div key={i} className={cn(
                              "w-1 h-3 rounded-full",
                              i <= (gpsSignal === 'STRONG' ? 5 : gpsSignal === 'WEAK' ? 3 : 1) ? "bg-primary" : "bg-white/10"
                            )} />
                          ))}
                       </div>
                     )}
                  </div>

                  {permissionStatus !== 'granted' && (
                    <button 
                      onClick={requestPermission}
                      className="px-8 py-4 bg-primary text-black rounded-2xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-all shadow-xl shadow-primary/20"
                    >
                      ATIVAR LOCALIZAÇÃO
                    </button>
                  )}

                  <button 
                    onClick={() => window.location.reload()}
                    className="flex items-center gap-2 px-6 py-3 bg-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/20 transition-all border border-white/5"
                  >
                    <RefreshCw size={14} /> REFRESCAR APP
                  </button>
               </div>
            </div>
         )}

         {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-error-container/80 backdrop-blur-sm z-20 text-center p-8 space-y-4">
               <AlertCircle className="text-error" size={48} />
               <p className="text-sm font-black text-error uppercase tracking-widest">{error}</p>
               <button 
                 onClick={() => window.location.reload()}
                 className="bg-error text-error-container px-6 py-3 rounded-2xl font-black text-xs uppercase"
               >
                 Recarregar App
               </button>
            </div>
         )}
      </div>

       {/* Footer Controls */}
       <div className="p-4 pb-24 md:pb-8 bg-surface-container-low border-t border-outline-variant/10 flex flex-col items-center gap-4 relative z-[210]">
          {/* Estado do GPS antes de comecar: sempre visivel, com a precisao em
              metros, para o atleta saber o que esta esperando. */}
          {!isTracking && countdown === null && (
             <p className={cn(
               "text-[9px] font-black uppercase tracking-[0.2em] flex items-center gap-2",
               gpsPronto ? "text-primary" : "text-alert-orange"
             )}>
               <AlertCircle size={12} />
               {gpsAccuracy === null
                 ? 'Procurando sinal de GPS...'
                 : gpsPronto
                   ? `GPS pronto (${gpsAccuracy.toFixed(0)}m)`
                   : `Aguardando GPS estabilizar (${gpsAccuracy.toFixed(0)}m)`}
             </p>
          )}

          {isPaused && (
             <p className="text-[9px] font-black text-alert-orange uppercase tracking-[0.2em] flex items-center gap-2">
               <AlertCircle size={12} /> Em pausa — tempo e distância congelados
             </p>
          )}

          {countdown !== null ? (
             /* Contagem antes de gravar: da tempo de guardar o celular sem que
                esses segundos entrem no pace. */
             <div className="flex flex-col items-center gap-3">
               <div className="w-20 h-20 rounded-full bg-primary flex items-center justify-center text-black shadow-[0_0_30px_rgba(var(--primary-rgb),0.4)]">
                 <span className="font-headline italic font-black text-4xl leading-none">{countdown}</span>
               </div>
               <button
                 onClick={(e) => { e.stopPropagation(); cancelarInicio(); }}
                 className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant px-4 py-2"
               >
                 Cancelar
               </button>
             </div>
          ) : !isTracking ? (
             <div className="flex flex-col items-center gap-2">
               <motion.button
                 whileTap={gpsPronto ? { scale: 0.95 } : undefined}
                 onClick={(e) => { e.stopPropagation(); pedirInicio(); }}
                 disabled={!gpsPronto}
                 aria-label="Iniciar atividade"
                 className={cn(
                   "w-20 h-20 rounded-full flex items-center justify-center text-black shadow-xl transition-all",
                   gpsPronto
                     ? "bg-primary shadow-[0_0_30px_rgba(var(--primary-rgb),0.3)]"
                     : "bg-white/10 opacity-50 cursor-not-allowed"
                 )}
               >
                  <Play size={32} className="fill-current" />
               </motion.button>
               <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                 {gpsPronto ? 'Iniciar' : 'Buscando sinal'}
               </span>
             </div>
         ) : confirmingStop ? (
            /* Encerrar exige confirmacao: um toque acidental no botao vermelho
               nao pode acabar com a atividade. */
            <div className="flex flex-col items-center gap-3 w-full max-w-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-on-surface text-center">
                Encerrar a atividade?
              </p>
              <div className="flex items-center gap-3 w-full">
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmingStop(false); }}
                  className="flex-1 py-4 rounded-2xl bg-surface-container border border-outline-variant/20 text-on-surface font-black text-xs uppercase tracking-widest"
                >
                  Continuar
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); stopTracking(); }}
                  className="flex-1 py-4 rounded-2xl bg-red-600 text-white font-black text-xs uppercase tracking-widest"
                >
                  Encerrar
                </button>
              </div>
            </div>
         ) : (
            <div className="flex items-center gap-6">
              <div className="flex flex-col items-center gap-2">
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={(e) => { e.stopPropagation(); alternarPausa(); }}
                  aria-label={isPaused ? 'Retomar atividade' : 'Pausar atividade'}
                  className={cn(
                    "w-16 h-16 rounded-full flex items-center justify-center shadow-xl transition-all",
                    isPaused ? "bg-primary text-black" : "bg-surface-container border border-outline-variant/20 text-on-surface"
                  )}
                >
                  {isPaused ? <Play size={24} className="fill-current" /> : <Pause size={24} className="fill-current" />}
                </motion.button>
                <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                  {isPaused ? 'Retomar' : 'Pausar'}
                </span>
              </div>

              <div className="flex flex-col items-center gap-2">
                <motion.button
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={(e) => { e.stopPropagation(); pedirParada(); }}
                  aria-label="Encerrar atividade"
                  className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center text-white shadow-2xl shadow-red-600/30"
                >
                   <Square size={28} className="fill-current" />
                </motion.button>
                <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Encerrar</span>
              </div>
            </div>
         )}
      </div>
    </div>
  );
}

function RealTimeStat({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <div className="bg-surface-container rounded-2xl p-4 border border-outline-variant/10 text-center">
       <p className="text-[8px] font-black text-on-surface-variant uppercase tracking-widest mb-1">{label}</p>
       <p className="font-headline italic font-black text-2xl text-on-surface leading-none">{value}</p>
       {subtitle && <p className="text-[8px] font-bold text-on-surface-variant uppercase tracking-tighter mt-1">{subtitle}</p>}
    </div>
  );
}

function StatItem({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-surface-container-high rounded-2xl p-4 border border-outline-variant/5 flex flex-col items-center text-center gap-2">
       <div className="w-10 h-10 bg-on-surface/5 rounded-xl flex items-center justify-center">
          {icon}
       </div>
       <div>
          <p className="text-[8px] font-black text-on-surface-variant uppercase tracking-[0.2em] mb-1">{label}</p>
          <p className="text-lg font-black text-on-surface uppercase italic tracking-tight">{value}</p>
       </div>
    </div>
  );
}

export function ValidationFeedback({ session, onShare, onClose }: { session: RunSession; onShare?: () => void; onClose: () => void }) {
  const isInvalid = session.validationStatus === 'INVALID';
  const isSuspicious = session.validationStatus === 'SUSPICIOUS';
  const pontos = session.pointsEarned ?? 0;
  const quilometros = (session.totalDistance / 1000).toFixed(2);

  return (
    <div className="fixed inset-0 z-[300] bg-black/95 backdrop-blur-xl flex items-center justify-center p-6">
       <motion.div 
         initial={{ scale: 0.9, opacity: 0 }}
         animate={{ scale: 1, opacity: 1 }}
         className={cn(
           "w-full max-w-sm bg-surface-container rounded-[40px] p-8 text-center border-t-8 shadow-2xl relative",
           isInvalid ? "border-red-600" : isSuspicious ? "border-prize-gold" : "border-green-500"
         )}
       >
          <button onClick={onClose} className="absolute top-6 right-6 p-2 text-on-surface-variant"><XCircle /></button>

          <div className="mb-6 flex justify-center">
             {isInvalid ? (
                <div className="w-20 h-20 bg-red-600/20 rounded-full flex items-center justify-center">
                   <XCircle size={48} className="text-red-600" />
                </div>
             ) : isSuspicious ? (
                <div className="w-20 h-20 bg-prize-gold/20 rounded-full flex items-center justify-center">
                   <AlertCircle size={48} className="text-prize-gold" />
                </div>
             ) : (
                <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center">
                   <CheckCircle2 size={48} className="text-green-500" />
                </div>
             )}
          </div>

          <h2 className="text-3xl font-black italic uppercase italic tracking-tighter mb-2">
             {isInvalid ? 'CORRIDA NÃO VALIDADA' : isSuspicious ? 'CONFERIR ATIVIDADE' : 'BOA! CORRIDA VALIDADA'}
          </h2>
          <p className="text-on-surface-variant text-[10px] font-black uppercase tracking-[0.2em] opacity-80 mb-4">
             {isInvalid
               ? 'Esta atividade não gerou pontos'
               : isSuspicious
               ? 'Score de confiança moderado'
               : `${quilometros} km em ${session.avgPace} de ritmo`}
          </p>

          {/* O ganho concreto, em destaque. Antes o app dizia apenas
              "confirmada com sucesso" e engolia os pontos que o backend
              ja devolvia em pointsEarned. */}
          {!isInvalid && pontos > 0 && (
             <motion.div
               initial={{ scale: 0.8, opacity: 0 }}
               animate={{ scale: 1, opacity: 1 }}
               transition={{ delay: 0.15, type: 'spring', stiffness: 220 }}
               className="mb-6 py-4 rounded-3xl bg-primary/10 border border-primary/30"
             >
                <p className="font-headline italic font-black text-4xl text-primary leading-none">+{pontos}</p>
                <p className="text-[9px] font-black uppercase tracking-[0.25em] text-primary/80 mt-1.5">
                  pontos conquistados
                </p>
             </motion.div>
          )}

          {!isInvalid && session.isScoringEligible === false && (
             <p className="text-[10px] font-bold text-alert-orange mb-6 leading-relaxed px-2">
               Corrida registrada no seu histórico. Ela não entra na pontuação desta semana porque você já atingiu o limite de treinos elegíveis.
             </p>
          )}

          <div className="bg-black/20 rounded-3xl p-6 mb-8 text-left space-y-4">
             <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-on-surface-variant">Confiança</span>
                <span className={cn(
                    "font-black",
                    session.confidenceScore > 90 ? "text-green-500" : session.confidenceScore > 70 ? "text-prize-gold" : "text-red-600"
                )}>{session.confidenceScore}%</span>
             </div>
             <div className="h-2 bg-on-surface/5 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${session.confidenceScore}%` }}
                  className={cn(
                    "h-full rounded-full",
                    session.confidenceScore > 90 ? "bg-green-500" : session.confidenceScore > 70 ? "bg-prize-gold" : "bg-red-600"
                  )}
                />
             </div>
             <p className="text-[10px] font-medium leading-relaxed italic opacity-60">
                {isInvalid
                  ? 'Esta atividade não entra no ranking. A validação de velocidade ou de GPS não passou.'
                  : isSuspicious
                  ? 'Esta atividade vai passar por análise antes de entrar no ranking.'
                  : 'Sua marca foi registrada e seu ranking será atualizado em instantes!'}
             </p>
          </div>

          <div className="flex flex-col gap-3">
             <button 
               onClick={onClose}
               className="w-full bg-on-surface text-surface py-5 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl"
             >
                FECHAR RESUMO
             </button>
             {!isInvalid && onShare && (
               <button 
                 onClick={onShare}
                 className="w-full bg-primary text-black py-5 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl flex items-center justify-center gap-2"
               >
                  <Share2 size={16} /> COMPARTILHAR RESULTADO
               </button>
             )}
          </div>
       </motion.div>
    </div>
  );
}

