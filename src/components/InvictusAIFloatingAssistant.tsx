import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import {
  Sparkles,
  X,
  Send,
  ShieldCheck,
  Cpu,
  RefreshCw,
  Volume2,
  VolumeX,
  Compass,
  Zap,
  TrendingUp,
  Award,
  Trophy,
  Activity,
  Maximize2,
  Minimize2,
  Settings,
  Radio,
  Flame,
  Clock,
  Heart,
  Target,
  Check,
  Play,
  Square,
  Info,
  ShieldAlert,
  HelpCircle,
  Lock,
  FileText,
  Brain,
  Trash2,
  AlertTriangle
} from 'lucide-react';
import { useUser } from '../UserContext';
import { processUserPerformance } from '../core/performance/performanceEngine';
import { workoutService } from '../services/workoutService';
import { activityService } from '../services/activityService';
import { invictusAudioEffects } from '../lib/invictusAudioEffects';
import { auth } from '../firebase';
import { normalizeActivityValidationStatus, readActivityTimestamp } from '../lib/workoutData';

interface Message {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  confidence?: string;
  sources?: string[];
  timestamp: string;
  audioBase64?: string | null;
  audioMimeType?: string;
}

export interface AIVoiceConfig {
  speechEnabled: boolean;
  speechRate: number;
  pitch: number;
  soundEffectsEnabled: boolean;
  voiceName: string;
  language: string;
}

const DEFAULT_VOICE_CONFIG: AIVoiceConfig = {
  speechEnabled: false,
  speechRate: 1.0,
  pitch: 1.0,
  soundEffectsEnabled: true,
  voiceName: '',
  language: 'pt-BR'
};

// Helper to rank Portuguese voices based on Neural / Natural / Premium voice quality
export function getRankedPortugueseVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  if (!voices || voices.length === 0) return [];
  
  const ptVoices = voices.filter(v => 
    v.lang.toLowerCase().startsWith('pt') || 
    v.lang.toLowerCase().includes('pt-br') || 
    v.lang.toLowerCase().includes('pt_br')
  );

  const pool = ptVoices.length > 0 ? ptVoices : voices;

  const getVoiceScore = (voice: SpeechSynthesisVoice): number => {
    const name = voice.name.toLowerCase();
    let score = 0;

    if (name.includes('natural') || name.includes('neural')) score += 100;
    if (name.includes('online')) score += 50;
    if (name.includes('enhanced') || name.includes('premium')) score += 40;
    if (name.includes('google')) score += 30;
    if (name.includes('microsoft')) score += 30;
    if (name.includes('apple')) score += 25;
    
    if (name.includes('francisca') || name.includes('antonio') || name.includes('luciana') || name.includes('camila') || name.includes('heloisa') || name.includes('vitoria') || name.includes('daniel') || name.includes('felipe')) {
      score += 20;
    }

    if (voice.lang.toLowerCase().includes('br')) score += 15;
    if (voice.default) score += 10;

    return score;
  };

  return [...pool].sort((a, b) => getVoiceScore(b) - getVoiceScore(a));
}

// Clean text for natural speech synthesis in Portuguese
export function cleanTextForSpeech(rawText: string): string {
  if (!rawText) return '';
  let text = rawText;

  // Replace LaTeX equations or common formulas
  text = text.replace(/\$\$\s*IGA\s*=\s*\\text\{Frequência\}\s*\\times\s*\\text\{Tempo Efetivo\}\s*\\times\s*\\text\{Intensidade\s*\(METs\/FC\)\}\s*\$\$/gi, 
    'O I G A é calculado multiplicando a frequência, o tempo efetivo e a intensidade.');
  text = text.replace(/\$\$(.*?)\$\$/gs, (_, formula) => {
    return formula.replace(/\\text\{([^}]+)\}/g, '$1')
                  .replace(/\\times/g, ' vezes ')
                  .replace(/=/g, ' igual a ');
  });

  // Remove code blocks, inline code, headings, markdown formatting
  text = text.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/#{1,6}\s?/g, '');
  text = text.replace(/[*_~`#$]/g, '');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Clean list symbols and bullet points
  text = text.replace(/^[•\-\*\>]\s+/gm, '');
  text = text.replace(/^\d+[\.\)]\s+/gm, '');

  // Parentheses cleaning for natural speech cadence
  text = text.replace(/\(([^)]+)\)/g, ', $1, ');

  // Units and technical terms pronunciation expansions
  text = text.replace(/\bbpm\b/gi, 'batimentos por minuto');
  text = text.replace(/\bkcal\/dia\b/gi, 'quilocalorias por dia');
  text = text.replace(/\bkcal\b/gi, 'quilocalorias');
  text = text.replace(/\bkm\/h\b/gi, 'quilômetros por hora');
  text = text.replace(/\bkm\b/gi, 'quilômetros');
  text = text.replace(/\bkg\b/gi, 'quilos');
  text = text.replace(/\bcm\b/gi, 'centímetros');
  text = text.replace(/\bmin\b/gi, 'minutos');
  text = text.replace(/\bseg\b/gi, 'segundos');
  text = text.replace(/\bpts?\b/gi, 'pontos');
  text = text.replace(/\bIGA\b/g, 'I G A');
  text = text.replace(/\bVO2\b/gi, 'V Ó 2');
  text = text.replace(/\bIA\b/g, 'I A');
  text = text.replace(/\bTDEE\b/g, 'gasto calórico diário total');
  text = text.replace(/\bBMR\b/g, 'metabolismo basal');
  text = text.replace(/\bIMC\b/g, 'I M C');

  // Remove emojis
  text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');

  // Normalize punctuation and line breaks
  text = text.replace(/[:;]\s*/g, ', ');
  text = text.replace(/\n+/g, '. ');
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

// Split text into natural sentence chunks for reliable browser SpeechSynthesis
export function splitTextIntoSentences(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/[^.!?;]+[.!?;]+/g) || [text];
  const chunks: string[] = [];

  for (let s of matches) {
    s = s.trim();
    if (!s) continue;
    if (s.length > 160) {
      const subParts = s.split(/(?<=[,:]\s+)/);
      let current = '';
      for (const part of subParts) {
        if ((current + part).length > 160) {
          if (current.trim()) chunks.push(current.trim());
          current = part;
        } else {
          current += part;
        }
      }
      if (current.trim()) chunks.push(current.trim());
    } else {
      chunks.push(s);
    }
  }
  return chunks;
}

// Map route path to human-readable screen title and contextual suggestions
function getScreenContext(pathname: string) {
  if (pathname.startsWith('/rankings')) {
    return {
      name: 'Ranking & Ligas',
      badge: 'Ranking',
      insight: 'Você está a poucas posições de subir na liga esta semana!',
      prompts: [
        'Como posso subir posições no ranking?',
        'Quem está na minha frente e quantos pontos faltam?',
        'Quanto falta para entrar no Top 10?',
        'Por que o IGA ajusta minha pontuação no ranking?'
      ]
    };
  }
  if (pathname.startsWith('/performance')) {
    return {
      name: 'Centro de Performance',
      badge: 'Performance',
      insight: 'Sua biometria indica alta prontidão metabólica hoje.',
      prompts: [
        'Explique meu condicionamento físico atual.',
        'Meu IGA e VO2 Max melhoraram este mês?',
        'Qual a minha prontidão para treinar hoje?',
        'Minha Frequência Cardíaca média está ideal?'
      ]
    };
  }
  if (pathname.startsWith('/challenges')) {
    return {
      name: 'Desafios & Temporada',
      badge: 'Desafios',
      insight: 'Complete os desafios semanais para turbinar seu XP e IGA!',
      prompts: [
        'Quais desafios dão mais pontos esta semana?',
        'Dicas para completar o desafio ativo mais rápido.',
        'Como funciona a validação presencial nos desafios?',
        'Qual a premiação da temporada atual?'
      ]
    };
  }
  if (pathname.startsWith('/profile')) {
    return {
      name: 'Perfil & Evolução',
      badge: 'Perfil',
      insight: 'Analisando todo o seu histórico desde o 1º treino.',
      prompts: [
        'Resuma minha evolução desde meu primeiro treino.',
        'Qual foi meu maior recorde no Invictus?',
        'Como está minha constância semanal de treinos?',
        'Quais conquistas estou mais perto de desbloquear?'
      ]
    };
  }
  if (pathname.startsWith('/gym')) {
    return {
      name: 'Academia & Presença',
      badge: 'Academia',
      insight: 'Lembre-se de fazer o check-in presencial no app ao chegar.',
      prompts: [
        'Como funciona a validação de presença por GPS?',
        'Qual é o ranking e nota da minha academia?',
        'Dicas de treino presencial para acelerar o IGA.'
      ]
    };
  }
  if (pathname.startsWith('/devices')) {
    return {
      name: 'Dispositivos & Sensores',
      badge: 'Wearables',
      insight: 'Conecte seu Strava ou Apple Health para auditoria biométrica.',
      prompts: [
        'Como sincronizar o Strava e relógio com o Invictus?',
        'Por que meus batimentos não apareceram no último treino?',
        'Qual o relógio mais recomendado para precisão do IGA?'
      ]
    };
  }
  if (pathname.startsWith('/wallet')) {
    return {
      name: 'Carteira & Resgate',
      badge: 'Carteira',
      insight: 'Seus pontos do IGA e XP podem valer benefícios no ecossistema.',
      prompts: [
        'Como converter meu IGA e treino em recompensas?',
        'Como funciona o saldo e regras de saque?',
        'Quais as metas para o próximo nível financeiro?'
      ]
    };
  }

  // Default Home / Dashboard
  return {
    name: 'Visão Geral',
    badge: 'Início',
    insight: 'Estou monitorando seus dados e prontidão biométrica em tempo real.',
    prompts: [
      'Resuma meus treinos e progresso da semana.',
      'Qual minha recomendação de treino e prontidão hoje?',
      'Como funciona o cálculo do IGA no Invictus?',
      'Dicas de saúde e fisiologia para evoluir mais rápido.'
    ]
  };
}

// Siri / ChatGPT style visual feedback wave & orb for AI processing and playback.
function SiriChatGPTVoiceVisualizer({
  mode,
  onStop,
  aiName
}: {
  mode: 'thinking' | 'speaking';
  onStop?: () => void;
  aiName?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: -10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -10 }}
      className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950 border border-emerald-500/50 p-3 sm:p-4 my-2 shadow-[0_0_30px_rgba(16,185,129,0.25)] flex items-center justify-between gap-3 shrink-0"
    >
      {/* Background ambient glowing fluid aura */}
      <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 via-teal-500/15 to-emerald-500/10 animate-pulse pointer-events-none" />

      <div className="flex items-center gap-3.5 relative z-10 min-w-0">
        {/* Animated Siri/ChatGPT Fluid Sphere */}
        <div className="relative w-12 h-12 rounded-full flex items-center justify-center shrink-0">
          {/* Outer glowing pulsing ring */}
          <motion.div
            animate={mode === 'speaking' ? { scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] } : { rotate: 360 }}
            transition={{
              repeat: Infinity,
              duration: mode === 'thinking' ? 2 : 1.4,
              ease: 'easeInOut'
            }}
            className={`absolute inset-0 rounded-full blur-md ${mode === 'speaking' ? 'bg-emerald-400/80' : 'bg-gradient-to-tr from-emerald-500 via-teal-400 to-cyan-500'}`}
          />

          {/* Core Orb */}
          <div
            className={`relative w-10 h-10 rounded-full flex items-center justify-center shadow-lg border ${mode === 'speaking' ? 'bg-gradient-to-br from-emerald-400 via-teal-500 to-emerald-600 border-emerald-300/80 text-black' : 'bg-gradient-to-br from-cyan-400 via-emerald-500 to-teal-600 border-emerald-300/70 text-black'}`}
          >
            {mode === 'speaking' ? (
              <Volume2 size={20} className="animate-pulse" />
            ) : (
              <Sparkles size={20} className="animate-spin" />
            )}
          </div>
        </div>

        {/* Text & Dynamic Audio Spectrum Waveform Bars */}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-black uppercase tracking-wider ${mode === 'speaking' ? 'text-emerald-400' : 'text-cyan-400'}`}
            >
              {mode === 'speaking'
                ? `${aiName || 'Invictus IA'} Falando...`
                : 'Analisando fisiologia e dados...'}
            </span>
          </div>

          {/* Dynamic Audio Bars Animation */}
          <div className="flex items-center gap-1 mt-1.5 h-4">
            {[0.4, 0.8, 1.2, 0.6, 1.0, 0.5, 0.9, 0.3].map((delay, idx) => (
              <motion.span
                key={idx}
                animate={{
                  height: mode === 'thinking' ? ['4px', '10px', '4px'] : ['4px', '18px', '6px', '14px', '4px']
                }}
                transition={{
                  repeat: Infinity,
                  duration: 0.7,
                  delay: delay * 0.15,
                  ease: 'easeInOut'
                }}
                className={`w-1 rounded-full ${mode === 'speaking' ? 'bg-emerald-400' : 'bg-cyan-400'}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Action / Stop button if speaking or listening */}
      {onStop && (
        <button
          onClick={onStop}
          className="relative z-10 px-3 py-1.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white text-[11px] font-bold flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
        >
          <Square size={12} className="fill-current" />
          <span>Parar</span>
        </button>
      )}
    </motion.div>
  );
}

export function InvictusAIFloatingAssistant() {
  const location = useLocation();
  const { user } = useUser();
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [inputQuery, setInputQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [hasNewInsight, setHasNewInsight] = useState(true);
  const [perfState, setPerfState] = useState<any>(null);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);

  // Onboarding & Safety Transparency States
  const [isOnboarded, setIsOnboarded] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('invictus_ai_onboarded') === 'true';
    }
    return false;
  });
  const [showFirstAccessModal, setShowFirstAccessModal] = useState<boolean>(false);
  const [showAboutModal, setShowAboutModal] = useState<boolean>(false);

  // Individual User Memories System State
  const [showMemoriesModal, setShowMemoriesModal] = useState<boolean>(false);
  const [userMemories, setUserMemories] = useState<any[]>([]);
  const [loadingMemories, setLoadingMemories] = useState<boolean>(false);

  const loadUserMemories = async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return;
    setLoadingMemories(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/performance-ai?action=get-memories', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Não foi possível carregar as memórias da conta.');
      const data = await res.json();
      setUserMemories(data.memories || []);
    } catch (e) {
      console.warn('[Memories] Load error:', e);
    } finally {
      setLoadingMemories(false);
    }
  };

  const handleDeleteMemory = async (memoryId: string) => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser || !memoryId) return;
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/performance-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          action: 'delete-memory',
          memoryId
        })
      });
      if (!res.ok) throw new Error('Não foi possível excluir esta memória.');
      setUserMemories(prev => prev.filter(m => m.id !== memoryId));
    } catch (e) {
      console.warn('[Memories] Delete error:', e);
    }
  };

  // Trigger First Access Welcome Modal when Assistant opens if not onboarded
  useEffect(() => {
    if (isOpen && !isOnboarded) {
      setShowFirstAccessModal(true);
    }
  }, [isOpen, isOnboarded]);

  const handleConfirmOnboarding = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('invictus_ai_onboarded', 'true');
    }
    setIsOnboarded(true);
    setShowFirstAccessModal(false);
  };

  // Voice Settings State
  const [voiceConfig, setVoiceConfig] = useState<AIVoiceConfig>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('invictus_ai_voice_config');
        if (saved) {
          const storedConfig = JSON.parse(saved) as Partial<AIVoiceConfig>;
          const normalizedConfig: AIVoiceConfig = {
            ...DEFAULT_VOICE_CONFIG,
            speechEnabled: typeof storedConfig.speechEnabled === 'boolean'
              ? storedConfig.speechEnabled
              : DEFAULT_VOICE_CONFIG.speechEnabled,
            speechRate: typeof storedConfig.speechRate === 'number'
              ? storedConfig.speechRate
              : DEFAULT_VOICE_CONFIG.speechRate,
            pitch: typeof storedConfig.pitch === 'number'
              ? storedConfig.pitch
              : DEFAULT_VOICE_CONFIG.pitch,
            soundEffectsEnabled: typeof storedConfig.soundEffectsEnabled === 'boolean'
              ? storedConfig.soundEffectsEnabled
              : DEFAULT_VOICE_CONFIG.soundEffectsEnabled,
            voiceName: typeof storedConfig.voiceName === 'string'
              ? storedConfig.voiceName
              : DEFAULT_VOICE_CONFIG.voiceName,
            language: typeof storedConfig.language === 'string'
              ? storedConfig.language
              : DEFAULT_VOICE_CONFIG.language
          };

          // Regrava somente as preferências ainda suportadas.
          localStorage.setItem('invictus_ai_voice_config', JSON.stringify(normalizedConfig));
          return normalizedConfig;
        }
      } catch (e) {
        console.warn('[VoiceConfig] Load error:', e);
      }
    }
    return DEFAULT_VOICE_CONFIG;
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const speechChunksRef = useRef<string[]>([]);
  const speechChunkIndexRef = useRef<number>(0);
  const speechHeartbeatRef = useRef<any>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);

  const screenCtx = getScreenContext(location.pathname);

  // Save voice configuration changes
  const updateVoiceConfig = (updater: Partial<AIVoiceConfig>) => {
    setVoiceConfig(prev => {
      const updated = { ...prev, ...updater };
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('invictus_ai_voice_config', JSON.stringify(updated));
        } catch (e) {
          console.warn('[VoiceConfig] Save error:', e);
        }
      }
      return updated;
    });
  };

  // Load browser voices for SpeechSynthesis
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const loadVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        const ptVoices = voices.filter(v => v.lang.startsWith('pt'));
        setAvailableVoices(ptVoices.length > 0 ? ptVoices : voices);
      };
      loadVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }
    }
  }, []);

  // Fetch real user performance metrics for AI context
  useEffect(() => {
    let isMounted = true;
    async function loadPerf() {
      if (!user) return;
      try {
        const workouts = await workoutService.getUserWorkouts(50);
        const mappedWorkouts = workouts.flatMap((w: any) => {
          const timestamp = readActivityTimestamp(w.timestamp ?? w.date ?? w.createdAt);
          const validationStatus = normalizeActivityValidationStatus(w.validationStatus ?? w.status ?? w.validation?.status);
          if (timestamp === null || validationStatus !== 'validated') return [];
          const hr = Number(w.avgHeartRate) || Number(w.avgHr) || (w.hasSensorData ? Number(w.avgHeartRate) : undefined);
          const maxHr = Number(w.maxHeartRate) || Number(w.maxHr) || undefined;
          const duration = Number(w.duration ?? w.durationMinutes);
          const calories = Number(w.caloriesBurned ?? w.calories);
          const distance = Number(w.distance ?? w.distanceKm);
          return [{
            id: w.id,
            userId: w.userId,
            timestamp,
            type: w.type || 'workout',
            durationMinutes: Number.isFinite(duration) && duration >= 0 ? duration : 0,
            caloriesBurned: Number.isFinite(calories) && calories >= 0 ? calories : 0,
            avgHeartRate: hr && hr > 0 ? hr : undefined,
            maxHeartRate: maxHr && maxHr > 0 ? maxHr : undefined,
            distanceKm: Number.isFinite(distance) && distance >= 0 ? distance : 0,
            isValidated: true,
            validationMethod: hr ? 'Sensors' : 'Unknown',
            hasSensorData: !!(hr && hr > 0)
          }];
        });
        const state = processUserPerformance(
          mappedWorkouts as any,
          { ...user, uid: user.uid, name: user.name || user.displayName, streak: user.streak, score: user.score },
          '7days'
        );
        if (isMounted) setPerfState(state);
      } catch (err) {
        console.warn('[Invictus AI] Não foi possível carregar o contexto de desempenho:', err);
      }
    }
    loadPerf();
    return () => { isMounted = false; };
  }, [user]);

  const [messages, setMessages] = useState<Message[]>([]);

  // Reset or set initial welcome when context opens
  useEffect(() => {
    if (user && messages.length === 0) {
      setMessages([
        {
          id: 'init_msg',
          sender: 'ai',
          text: `Olá, ${user.name || 'Atleta'}! Sou a **${user?.aiName || 'IA Invictus'}**, seu especialista em fisiologia, treinamento e inteligência do seu desempenho.

Estou acompanhando você na tela de **${screenCtx.name}**. Como posso ajudar na sua evolução agora?`,
          confidence: 'PENDENTE',
          sources: ['Contexto da conta', 'Servidor Invictus'],
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    }
  }, [user, messages.length, screenCtx.name]);

  // Scroll chat to bottom on new message
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, loading]);

  // Gather current active workout session data if available
  const getActiveWorkoutContext = () => {
    try {
      const currentSession = activityService.getCurrentSession();
      if (!currentSession) return null;

      const startTimeMs = new Date(currentSession.startTime).getTime();
      const elapsedMs = Math.max(0, Date.now() - startTimeMs);
      const mins = Math.floor(elapsedMs / 60000);
      const secs = Math.floor((elapsedMs % 60000) / 1000);

      return {
        isSessionActive: true,
        type: currentSession.type,
        cardioTypeLabel: currentSession.cardioTypeLabel || (currentSession.type === 'workout' ? 'Treino de Força' : 'Atividade Cardio'),
        durationMinutes: mins,
        elapsedFormatted: `${mins} min e ${secs} seg`,
        // A sessão local não é uma fonte de telemetria cardíaca contínua.
        // Não estimamos calorias nem fabricamos FC/zona para a conversa.
        hasHeartRateSensor: false,
        currentHeartRate: null,
        currentZone: null,
        checkInId: currentSession.checkInId
      };
    } catch (e) {
      return null;
    }
  };

  // Stop active text-to-speech output cleanly
  const stopSpeaking = () => {
    if (activeAudioRef.current) {
      try {
        activeAudioRef.current.pause();
        activeAudioRef.current.currentTime = 0;
      } catch (e) {}
      activeAudioRef.current = null;
    }
    if (speechHeartbeatRef.current) {
      clearInterval(speechHeartbeatRef.current);
      speechHeartbeatRef.current = null;
    }
    speechChunksRef.current = [];
    speechChunkIndexRef.current = 0;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    setIsSpeaking(false);
  };

  // Play high-fidelity TTS audio (Gemini 2.5 Flash TTS - Sulafat) returned by backend
  const playBase64Audio = (base64Data: string, mimeType: string = 'audio/mp3') => {
    stopSpeaking();
    if (!voiceConfig.speechEnabled || !base64Data) return;

    try {
      const audioUrl = `data:${mimeType};base64,${base64Data}`;
      const audio = new Audio(audioUrl);
      activeAudioRef.current = audio;

      audio.onplay = () => {
        setIsSpeaking(true);
      };

      audio.onended = () => {
        setIsSpeaking(false);
        activeAudioRef.current = null;
        invictusAudioEffects.playResponseChime(voiceConfig.soundEffectsEnabled);
      };

      audio.onerror = (e) => {
        console.warn('[Gemini TTS Audio Error]:', e);
        setIsSpeaking(false);
        activeAudioRef.current = null;
      };

      audio.play().catch(err => {
        console.warn('[Gemini TTS Audio Play Error]:', err);
        setIsSpeaking(false);
      });
    } catch (err) {
      console.warn('[Gemini TTS Audio Exception]:', err);
      setIsSpeaking(false);
    }
  };

  const speakResponseText = (text: string, force: boolean = false) => {
    return; // Voz TTS desativada a pedido do usuario - somente chat de texto
    if ((!voiceConfig.speechEnabled && !force) || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    
    if (force && !voiceConfig.speechEnabled) {
      updateVoiceConfig({ speechEnabled: true });
    }

    try {
      stopSpeaking();

      const cleanedText = cleanTextForSpeech(text);
      if (!cleanedText) return;

      const chunks = splitTextIntoSentences(cleanedText);
      if (chunks.length === 0) return;

      speechChunksRef.current = chunks;
      speechChunkIndexRef.current = 0;

      const playNextChunk = () => {
        if (speechChunkIndexRef.current >= speechChunksRef.current.length) {
          stopSpeaking();
          invictusAudioEffects.playResponseChime(voiceConfig.soundEffectsEnabled);
          return;
        }

        const chunkText = speechChunksRef.current[speechChunkIndexRef.current];
        if (!chunkText || !chunkText.trim()) {
          speechChunkIndexRef.current++;
          playNextChunk();
          return;
        }

        const utterance = new SpeechSynthesisUtterance(chunkText);
        utterance.rate = voiceConfig.speechRate || 1.0;
        utterance.pitch = voiceConfig.pitch || 1.0;

        let voicesList = availableVoices;
        if ((!voicesList || voicesList.length === 0) && window.speechSynthesis) {
          const fresh = window.speechSynthesis.getVoices();
          if (fresh && fresh.length > 0) {
            voicesList = fresh;
            const pt = fresh.filter(v => v.lang.toLowerCase().startsWith('pt'));
            setAvailableVoices(pt.length > 0 ? pt : fresh);
          }
        }

        const rankedVoices = getRankedPortugueseVoices(voicesList);
        let selectedVoice: SpeechSynthesisVoice | undefined;

        if (voiceConfig.voiceName && voicesList.length > 0) {
          selectedVoice = voicesList.find(v => v.name === voiceConfig.voiceName);
        }

        if (!selectedVoice && rankedVoices.length > 0) {
          selectedVoice = rankedVoices[0];
        }

        if (selectedVoice) {
          utterance.voice = selectedVoice;
          utterance.lang = selectedVoice.lang;
        } else {
          utterance.lang = voiceConfig.language || 'pt-BR';
        }

        utterance.onstart = () => {
          setIsSpeaking(true);
        };

        utterance.onend = () => {
          speechChunkIndexRef.current++;
          playNextChunk();
        };

        utterance.onerror = (e) => {
          console.warn('[TTS Chunk Error]:', e);
          speechChunkIndexRef.current++;
          playNextChunk();
        };

        try {
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
          window.speechSynthesis.speak(utterance);
        } catch (err) {
          console.warn('[TTS Speak Error]:', err);
          setIsSpeaking(false);
        }
      };

      // Heartbeat keep-alive to prevent Chrome from freezing long speech output
      speechHeartbeatRef.current = setInterval(() => {
        if (window.speechSynthesis && window.speechSynthesis.speaking) {
          try {
            if (window.speechSynthesis.paused) {
              window.speechSynthesis.resume();
            } else {
              window.speechSynthesis.pause();
              window.speechSynthesis.resume();
            }
          } catch (e) {}
        }
      }, 8000);

      setTimeout(() => {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.paused) {
          try { window.speechSynthesis.resume(); } catch (e) {}
        }
        playNextChunk();
      }, 80);
    } catch (e) {
      console.warn('[Text-to-Speech Error]:', e);
      setIsSpeaking(false);
    }
  };

  const handleSend = async (queryText?: string) => {
    const textToSend = queryText || inputQuery;
    if (!textToSend.trim()) return;

    // Stop speaking current AI audio if user asks new question
    stopSpeaking();

    const userMsg: Message = {
      id: `usr_${Date.now()}`,
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    if (!queryText) setInputQuery('');

    // EMERGENCY KEYWORDS CHECK
    const qLower = textToSend.toLowerCase();
    const EMERGENCY_KEYWORDS = [
      'dor no peito', 'dor intensa no peito', 'falta de ar', 'falta importante de ar',
      'desmaio', 'desmaiei', 'convulsão', 'convulsao', 'fraqueza súbita', 'fraqueza subita',
      'dificuldade para falar', 'sangramento intenso', 'perda de consciência', 'perda de consciencia',
      'parada cardiaca', 'avc', 'infarto'
    ];

    if (EMERGENCY_KEYWORDS.some(k => qLower.includes(k))) {
      const emergencyMsg = `🚨 **ATENÇÃO: PROTOCOLO DE EMERGÊNCIA MÉDICA** 🚨

Identificamos relatos que correspondem a possíveis sintomas de emergência de saúde grave.

**A análise da IA foi interrompida.**

Por favor, procure atendimento de emergência imediatamente:
• **Ligue para o SAMU: 192**
• **Dirija-se ao Pronto Socorro ou UPA mais próximo**

*A Invictus IA possui caráter meramente educativo e não realiza diagnósticos nem substitui atendimento médico emergencial.*`;

      const aiMsg: Message = {
        id: `ai_${Date.now()}`,
        sender: 'ai',
        text: emergencyMsg,
        confidence: 'MÁXIMA',
        sources: ['Protocolo de Emergência Médica Invictus'],
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, aiMsg]);
      setLoading(false);
      speakResponseText('Atenção. Identificamos relato de possíveis sintomas de emergência. Por favor, procure atendimento médico de emergência imediatamente. Ligue para o SAMU 192.');
      return;
    }

    setLoading(true);

    const activeWorkoutSession = getActiveWorkoutContext();

    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error('Sessão não autenticada.');
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/performance-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          queryText: textToSend,
          history: messages.slice(-6),
          screenName: screenCtx.name,
          currentPath: location.pathname,
          perfState,
          activeWorkoutSession
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.answer) {
          const audioB64 = data.audioBase64 || data.audio?.data || null;
          const audioMime = data.audioMimeType || data.audio?.mimeType || 'audio/mp3';

          const aiMsg: Message = {
            id: `ai_${Date.now()}`,
            sender: 'ai',
            text: data.answer,
            audioBase64: audioB64,
            audioMimeType: audioMime,
            confidence: data.confidence || 'ALTA',
            sources: data.sources || ['Módulo Invictus AI', 'Sensores Biométricos', screenCtx.name],
            timestamp: data.timestamp || new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          };
          setMessages(prev => [...prev, aiMsg]);
          setLoading(false);

          if (audioB64) {
            playBase64Audio(audioB64, audioMime);
          } else {
            speakResponseText(data.answer);
          }
          return;
        }
      }
    } catch (err) {
      console.warn('[Invictus AI] API indisponível:', err);
    }

    // Sem resposta autenticada do servidor, a IA não emite recomendações nem
    // métricas locais que poderiam ser desatualizadas ou fabricadas.
    setMessages(prev => [...prev, {
      id: `ai_${Date.now()}`,
      sender: 'ai',
      text: 'Não foi possível consultar a IA agora. Nenhuma métrica ou recomendação foi estimada localmente. Tente novamente quando a conexão estiver disponível.',
      confidence: 'INDISPONÍVEL',
      sources: ['Servidor Invictus IA indisponível'],
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    }]);
    setLoading(false);
  };

  const handleOpenPanel = () => {
    setIsOpen(true);
    setHasNewInsight(false);
  };

  const activeWorkoutSession = getActiveWorkoutContext();

  return (
    <>
      {/* GLOBAL FLOATING ACTION BUTTON (FAB) - DRAGGABLE IA ORB */}
      {!isOpen && (
        <>
          {/* Top Floating Siri/ChatGPT Voice Visualizer Banner when active outside panel */}
          <AnimatePresence>
            {isSpeaking && (
              <motion.div
                initial={{ y: -50, opacity: 0, scale: 0.9 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: -50, opacity: 0, scale: 0.9 }}
                className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-[92%] max-w-md bg-zinc-950/95 border border-emerald-500/60 rounded-full px-4 py-2.5 shadow-[0_0_35px_rgba(16,185,129,0.45)] backdrop-blur-xl flex items-center justify-between gap-3 text-white"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Siri/ChatGPT Orb */}
                  <div className="relative w-8 h-8 rounded-full flex items-center justify-center shrink-0">
                    <motion.div
                      animate={{ scale: [1, 1.35, 1], opacity: [0.5, 0.9, 0.5] }}
                      transition={{ repeat: Infinity, duration: 1.2 }}
                      className="absolute inset-0 rounded-full blur-sm bg-emerald-400"
                    />
                    <div className="relative w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold bg-emerald-400 text-black">
                      <Volume2 size={14} className="animate-pulse" />
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-black uppercase tracking-wide truncate text-emerald-300">
                      {user?.aiName || 'Invictus IA'} Falando...
                    </div>
                    {/* Frequency bars */}
                    <div className="flex items-center gap-1 mt-0.5 h-3">
                      {[0.2, 0.5, 0.8, 0.4, 0.7, 0.3, 0.9].map((d, idx) => (
                        <motion.span
                          key={idx}
                          animate={{ height: ['3px', '12px', '3px'] }}
                          transition={{ repeat: Infinity, duration: 0.5, delay: d * 0.15 }}
                          className="w-0.5 rounded-full bg-emerald-400"
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  onClick={stopSpeaking}
                  className="p-1.5 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-300 hover:text-white shrink-0 cursor-pointer"
                  title="Parar voz"
                >
                  <X size={14} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Draggable Smaller IA Orb */}
          <motion.div
            drag
            dragMomentum={false}
            dragElastic={0.05}
            onDragStart={() => {
              isDraggingRef.current = true;
            }}
            onDragEnd={() => {
              setTimeout(() => {
                isDraggingRef.current = false;
              }, 200);
            }}
            whileDrag={{ scale: 1.1 }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: isOpen ? 0.8 : 1, opacity: isOpen ? 0 : 1 }}
            className={`fixed bottom-20 md:bottom-24 right-4 md:right-8 z-50 flex flex-col items-center cursor-grab active:cursor-grabbing touch-none select-none transition-opacity duration-200 ${
              isOpen ? 'pointer-events-none opacity-0' : 'opacity-100'
            }`}
          >
            {/* Compact Smaller Glowing Green Orb */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isDraggingRef.current) return;
                handleOpenPanel();
              }}
              className="group relative flex flex-col items-center gap-1 focus:outline-none cursor-pointer"
              title={`Invictus IA - ${screenCtx.name} (Arraste para mover)`}
            >
              <div className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600 p-0.5 shadow-[0_0_16px_rgba(16,185,129,0.5)] transition-transform group-hover:scale-110 active:scale-95 flex items-center justify-center">
                <div className="w-full h-full rounded-full bg-zinc-950/90 backdrop-blur-md flex items-center justify-center border border-emerald-400/60">
                  <Sparkles size={16} className="text-emerald-400 group-hover:rotate-12 transition-transform" />
                </div>

                {/* Notification badge / Ping animation */}
                {hasNewInsight && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 border border-zinc-950" />
                  </span>
                )}
              </div>

              {/* Smaller Label under orb */}
              <span className="text-[9px] font-black uppercase tracking-tight text-emerald-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] bg-zinc-950/90 px-2 py-0.5 rounded-full border border-emerald-500/40 whitespace-nowrap shadow-sm">
                {user?.aiName || 'IA Invictus'}
              </span>
            </button>
          </motion.div>
        </>
      )}

      {/* IA BOTTOM SHEET / PANEL */}
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center p-0 sm:p-4 bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className={`relative w-full ${
                isExpanded ? 'max-w-4xl h-[94dvh] sm:h-[90vh]' : 'max-w-xl h-[85dvh] sm:h-[80vh]'
              } bg-zinc-950 border border-emerald-500/40 rounded-t-[28px] sm:rounded-[32px] p-4 sm:p-6 pb-6 sm:pb-6 shadow-2xl text-white flex flex-col justify-between overflow-hidden transition-all duration-300`}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3 shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 text-black flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
                    <Sparkles size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="font-headline italic font-black text-base sm:text-xl text-white uppercase tracking-tight">
                        {(user?.aiName || 'INVICTUS IA').toUpperCase()}
                      </h3>
                      <span className="text-[9px] font-bold bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Radio size={10} className="animate-pulse text-emerald-400" />
                        {screenCtx.badge}
                      </span>
                    </div>
                    <p className="text-[10px] sm:text-[11px] text-zinc-400 truncate">
                      Contexto: <strong className="text-zinc-200 font-semibold">{screenCtx.name}</strong>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Speech Audio Indicator / Interrupt Button */}
                  {isSpeaking && (
                    <button
                      onClick={stopSpeaking}
                      className="text-[10px] bg-rose-500/20 border border-rose-500/50 text-rose-300 px-2 py-1 rounded-full flex items-center gap-1 animate-pulse hover:bg-rose-500/30"
                      title="Parar de falar"
                    >
                      <Square size={10} className="fill-rose-400" />
                      <span>Parar Voz</span>
                    </button>
                  )}

                  {/* Speech Output Toggle */}
                  <button
                    onClick={() => updateVoiceConfig({ speechEnabled: !voiceConfig.speechEnabled })}
                    className={`w-8 h-8 rounded-xl flex items-center justify-center border transition-colors ${
                      voiceConfig.speechEnabled
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-500'
                    }`}
                    title={voiceConfig.speechEnabled ? 'Voz ativada' : 'Voz desativada'}
                  >
                    {voiceConfig.speechEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                  </button>

                  {/* Sobre a Invictus IA Info Toggle */}
                  <button
                    onClick={() => setShowAboutModal(!showAboutModal)}
                    className={`w-8 h-8 rounded-xl flex items-center justify-center border transition-colors ${
                      showAboutModal
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                    title={`Sobre a ${user?.aiName || 'Invictus IA'} (Segurança e Termos)`}
                  >
                    <Info size={16} />
                  </button>

                  {/* Memory System Modal Toggle */}
                  <button
                    onClick={() => {
                      const nextState = !showMemoriesModal;
                      setShowMemoriesModal(nextState);
                      if (nextState) loadUserMemories();
                    }}
                    className={`w-8 h-8 rounded-xl flex items-center justify-center border transition-colors ${
                      showMemoriesModal
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                    title={`Memórias da ${user?.aiName || 'Invictus IA'}`}
                  >
                    <Brain size={16} />
                  </button>

                  {/* Settings Modal Toggle */}
                  <button
                    onClick={() => setShowSettings(!showSettings)}
                    className={`w-8 h-8 rounded-xl flex items-center justify-center border transition-colors ${
                      showSettings
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                    title="Configurações de Voz e IA"
                  >
                    <Settings size={16} />
                  </button>

                  {/* Expand Toggle */}
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="hidden sm:flex w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white items-center justify-center transition-colors"
                    title={isExpanded ? 'Restaurar tamanho' : 'Expandir'}
                  >
                    {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  </button>

                  {/* Close Panel Button */}
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      stopSpeaking();
                    }}
                    className="w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* VOICE SETTINGS OVERLAY */}
              <AnimatePresence>
                {showSettings && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="bg-zinc-900/95 border border-emerald-500/30 rounded-2xl p-3 sm:p-4 my-2 text-xs space-y-3 shrink-0 overflow-hidden"
                  >
                    <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                      <span className="font-bold text-white flex items-center gap-1.5">
                        <Settings size={14} className="text-emerald-400" />
                        Configurações de áudio e IA
                      </span>
                      <button
                        onClick={() => setShowSettings(false)}
                        className="text-zinc-400 hover:text-white"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* TTS Toggle */}
                      <div className="flex items-center justify-between bg-zinc-950 p-2.5 rounded-xl border border-zinc-800">
                        <div>
                          <div className="font-semibold text-zinc-200 text-[11px]">Resposta em Voz</div>
                          <div className="text-[9px] text-zinc-400">Reproduz resposta em áudio</div>
                        </div>
                        <button
                          onClick={() => updateVoiceConfig({ speechEnabled: !voiceConfig.speechEnabled })}
                          className={`w-9 h-5 rounded-full transition-colors relative ${
                            voiceConfig.speechEnabled ? 'bg-emerald-500' : 'bg-zinc-800'
                          }`}
                        >
                          <span
                            className={`block w-4 h-4 bg-white rounded-full transition-transform transform ${
                              voiceConfig.speechEnabled ? 'translate-x-4' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </div>

                      {/* Speech Rate Selection */}
                      <div className="bg-zinc-950 p-2.5 rounded-xl border border-zinc-800 space-y-1.5">
                        <div className="font-semibold text-zinc-200 text-[11px]">Velocidade da Fala</div>
                        <div className="flex items-center gap-1.5">
                          {[0.8, 0.95, 1.0, 1.15].map(rate => (
                            <button
                              key={rate}
                              onClick={() => updateVoiceConfig({ speechRate: rate })}
                              className={`flex-1 py-1 rounded-lg font-mono text-[10px] transition-colors border ${
                                voiceConfig.speechRate === rate
                                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold'
                                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                              }`}
                            >
                              {rate === 0.95 ? '0.95x (Fluida)' : `${rate}x`}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Pitch Selection */}
                      <div className="bg-zinc-950 p-2.5 rounded-xl border border-zinc-800 space-y-1.5">
                        <div className="font-semibold text-zinc-200 text-[11px]">Tom de Voz (Pitch)</div>
                        <div className="flex items-center gap-1.5">
                          {[
                            { value: 0.95, label: 'Grave' },
                            { value: 1.0, label: 'Natural' },
                            { value: 1.05, label: 'Suave' }
                          ].map(item => (
                            <button
                              key={item.value}
                              onClick={() => updateVoiceConfig({ pitch: item.value })}
                              className={`flex-1 py-1 rounded-lg text-[10px] transition-colors border ${
                                (voiceConfig.pitch || 1.0) === item.value
                                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold'
                                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                              }`}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Audio Sound Chimes Toggle */}
                      <div className="flex items-center justify-between bg-zinc-950 p-2.5 rounded-xl border border-zinc-800">
                        <div>
                          <div className="font-semibold text-zinc-200 text-[11px]">Sons de Feedback</div>
                          <div className="text-[9px] text-zinc-400">Chimes ao reconhecer voz</div>
                        </div>
                        <button
                          onClick={() => updateVoiceConfig({ soundEffectsEnabled: !voiceConfig.soundEffectsEnabled })}
                          className={`w-9 h-5 rounded-full transition-colors relative ${
                            voiceConfig.soundEffectsEnabled ? 'bg-emerald-500' : 'bg-zinc-800'
                          }`}
                        >
                          <span
                            className={`block w-4 h-4 bg-white rounded-full transition-transform transform ${
                              voiceConfig.soundEffectsEnabled ? 'translate-x-4' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    {/* System Voice Selection */}
                    {availableVoices.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-zinc-800">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] text-zinc-400 font-medium">Voz Neural / Humana Selecionada:</label>
                          <span className="text-[9px] text-emerald-400 font-semibold bg-emerald-950/80 border border-emerald-500/30 px-1.5 py-0.5 rounded-md">
                            Alta Definição
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={voiceConfig.voiceName}
                            onChange={e => updateVoiceConfig({ voiceName: e.target.value })}
                            className="flex-1 bg-zinc-950 border border-zinc-800 text-zinc-200 rounded-lg text-[10px] p-2 focus:outline-none focus:border-emerald-500"
                          >
                            <option value="">✨ Auto (Melhor Voz Neural do Sistema)</option>
                            {getRankedPortugueseVoices(availableVoices).map(v => {
                              const isNeural = /natural|neural|online|enhanced|google|microsoft|apple/i.test(v.name);
                              return (
                                <option key={v.name} value={v.name}>
                                  {isNeural ? '✨ ' : ''}{v.name} ({v.lang})
                                </option>
                              );
                            })}
                          </select>
                          <button
                            onClick={() => speakResponseText('Olá! Sou a Invictus IA. Minha voz foi otimizada para soar fluida, natural e humana no acompanhamento da sua performance.', true)}
                            className="px-2.5 py-2 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 rounded-lg text-[10px] font-semibold flex items-center gap-1 hover:bg-emerald-500/30 shrink-0"
                            title="Ouvir teste de voz"
                          >
                            <Play size={10} /> Testar Voz
                          </button>
                        </div>
                        <p className="text-[9px] text-zinc-500 italic leading-tight">
                          Dica: Para a melhor experiência humana, utilize navegadores como Google Chrome, Microsoft Edge ou Safari que disponibilizam vozes neurais de alta precisão.
                        </p>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* MEMORY SYSTEM OVERLAY */}
              <AnimatePresence>
                {showMemoriesModal && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="bg-zinc-900/95 border border-emerald-500/30 rounded-2xl p-3 sm:p-4 my-2 text-xs space-y-3 shrink-0 overflow-hidden"
                  >
                    <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                      <span className="font-bold text-white flex items-center gap-1.5">
                        <Brain size={14} className="text-emerald-400" />
                        Memórias e Aprendizados do Seu Coach IA
                      </span>
                      <button
                        onClick={() => setShowMemoriesModal(false)}
                        className="text-zinc-400 hover:text-white"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <p className="text-[10px] text-zinc-400 leading-snug">
                      A Invictus IA aprende com seus objetivos, preferências e evolução para oferecer um acompanhamento 100% individualizado. As memórias são exclusivas do seu ID e você tem controle total.
                    </p>

                    {loadingMemories ? (
                      <div className="py-4 text-center text-[11px] text-zinc-400 flex items-center justify-center gap-2">
                        <RefreshCw size={12} className="animate-spin text-emerald-400" /> Carregando memórias personalizadas...
                      </div>
                    ) : userMemories.length === 0 ? (
                      <div className="py-4 text-center text-[11px] text-zinc-500 italic bg-zinc-950 p-3 rounded-xl border border-zinc-800/80">
                        Nenhuma memória gravada ainda. Converse com a IA para que ela aprenda suas preferências e metas automaticamente.
                      </div>
                    ) : (
                      <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                        {userMemories.map(m => (
                          <div
                            key={m.id}
                            className="bg-zinc-950 p-2.5 rounded-xl border border-zinc-800 flex items-start justify-between gap-2 group hover:border-zinc-700 transition-colors"
                          >
                            <div className="space-y-0.5 min-w-0">
                              <div className="flex items-center gap-1.5 text-[10px]">
                                <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-500/20 uppercase font-semibold text-[8px]">
                                  {m.category || 'Geral'}
                                </span>
                                <span className="text-zinc-500 text-[9px]">
                                  {m.confidence ? `Confiança ${(m.confidence * 100).toFixed(0)}%` : ''}
                                </span>
                              </div>
                              <p className="text-zinc-200 font-medium text-[11px] leading-tight break-words">
                                {m.content}
                              </p>
                            </div>
                            <button
                              onClick={() => handleDeleteMemory(m.id)}
                              className="text-zinc-500 hover:text-rose-400 p-1 rounded hover:bg-rose-950/30 transition-colors shrink-0"
                              title="Esquecer esta memória"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Dynamic Voice/Audio Siri/ChatGPT Visualizer Banner */}
              <AnimatePresence>
                {loading && (
                  <SiriChatGPTVoiceVisualizer mode="thinking" aiName={user?.aiName} />
                )}
                {!loading && isSpeaking && (
                  <SiriChatGPTVoiceVisualizer mode="speaking" onStop={stopSpeaking} aiName={user?.aiName} />
                )}
              </AnimatePresence>

              {/* Active Workout Real-Time Badge */}
              {activeWorkoutSession && (
                <div className="mt-2 bg-gradient-to-r from-emerald-950/80 to-zinc-900 border border-emerald-500/50 rounded-2xl p-2.5 px-3 flex items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-2 text-emerald-300 min-w-0">
                    <Activity size={16} className="text-emerald-400 animate-pulse shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-white">
                        <span>TREINO EM ANDAMENTO: {activeWorkoutSession.cardioTypeLabel}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-zinc-300">
                        <span className="flex items-center gap-1"><Clock size={10} /> {activeWorkoutSession.elapsedFormatted}</span>
                        <span className="flex items-center gap-1 text-zinc-500"><Info size={10} /> Telemetria disponível após sincronização</span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleSend('Como está meu desempenho e tempo de treino nesta sessão ativa?')}
                    className="px-2.5 py-1 bg-emerald-500 text-black text-[10px] font-black uppercase rounded-xl hover:bg-emerald-400 transition-colors shrink-0"
                  >
                    Analisar
                  </button>
                </div>
              )}

              {/* Context Proactive Insight Banner */}
              {!activeWorkoutSession && screenCtx.insight && (
                <div className="mt-2 bg-emerald-950/40 border border-emerald-500/30 rounded-2xl p-2.5 px-3 flex items-center justify-between gap-2.5 text-xs shrink-0">
                  <div className="flex items-center gap-2 text-emerald-300 min-w-0">
                    <Zap size={14} className="shrink-0 text-emerald-400" />
                    <span className="font-medium text-[10px] sm:text-[11px] leading-snug truncate">{screenCtx.insight}</span>
                  </div>
                  <button
                    onClick={() => handleSend(screenCtx.prompts[0])}
                    className="text-[10px] bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 px-2 py-1 rounded-lg border border-emerald-500/30 whitespace-nowrap font-bold shrink-0"
                  >
                    Analisar
                  </button>
                </div>
              )}

              {/* Chat Message Stream */}
              <div className="flex-1 min-h-0 overflow-y-auto space-y-3.5 my-2.5 pr-1">
                {messages.map(m => (
                  <div
                    key={m.id}
                    className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[88%] p-3.5 rounded-2xl text-xs leading-relaxed ${
                        m.sender === 'user'
                          ? 'bg-emerald-500 text-black font-medium rounded-tr-none shadow-md'
                          : 'bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-tl-none space-y-2'
                      }`}
                    >
                      {m.sender === 'user' ? (
                        <p className="whitespace-pre-line">{m.text}</p>
                      ) : (
                        <div className="markdown-body space-y-2 text-xs leading-relaxed text-zinc-200 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_h1]:text-sm [&_h1]:font-bold [&_h2]:text-xs [&_h2]:font-bold [&_h3]:text-xs [&_h3]:font-bold [&_h3]:text-emerald-400 [&_strong]:font-semibold [&_strong]:text-emerald-300 [&_code]:bg-zinc-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded">
                          <Markdown>{m.text}</Markdown>
                        </div>
                      )}

                      {m.sender === 'ai' && (
                        <div className="pt-2 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-[10px] text-zinc-400">
                          <div className="flex items-center gap-2">
                            <span className="flex items-center gap-1 font-semibold text-emerald-400">
                              <ShieldCheck size={12} />
                              Confiabilidade: {m.confidence || 'ALTA'}
                            </span>
                            <button
                              onClick={() => {
                                if (isSpeaking) {
                                  stopSpeaking();
                                } else if (m.audioBase64) {
                                  playBase64Audio(m.audioBase64, m.audioMimeType);
                                } else {
                                  speakResponseText(m.text, true);
                                }
                              }}
                              className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 font-bold bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-500/40 px-2 py-0.5 rounded-lg transition-all cursor-pointer shadow-sm"
                              title="Ouvir resposta com a voz da Invictus IA (Gemini 2.5 Flash TTS - Sulafat)"
                            >
                              {isSpeaking ? (
                                <>
                                  <Square size={10} className="fill-emerald-400 animate-pulse shrink-0" />
                                  <span>Parar</span>
                                </>
                              ) : (
                                <>
                                  <Volume2 size={12} className="text-emerald-400 shrink-0" />
                                  <span>Ouvir</span>
                                </>
                              )}
                            </button>
                          </div>
                          {m.sources && <span className="text-zinc-500">{m.sources.join(' • ')}</span>}
                        </div>
                      )}
                    </div>
                    <span className="text-[9px] text-zinc-500 mt-1 px-1">{m.timestamp}</span>
                  </div>
                ))}

                {loading && (
                  <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-950/30 border border-emerald-500/20 p-3 rounded-2xl w-fit">
                    <RefreshCw size={14} className="animate-spin text-emerald-400" />
                    <span>Processando fisiologia e métricas biométricas...</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Permanent Discreet Safety Disclaimer */}
              <div className="shrink-0 my-1 bg-zinc-900/90 border border-zinc-800/80 rounded-xl p-2 px-3 flex items-center gap-2 text-[10px] text-zinc-400">
                <ShieldAlert size={14} className="text-emerald-400/80 shrink-0" />
                <span className="leading-tight">
                  A {user?.aiName || 'Invictus IA'} pode cometer erros. As respostas possuem finalidade educativa e informativa e não substituem orientação profissional.
                </span>
              </div>

              {/* Contextual Quick Suggestion Chips */}
              <div className="shrink-0 space-y-1.5 pt-2 border-t border-zinc-900">
                <div className="flex items-center justify-between text-[10px] text-zinc-400 font-semibold px-1">
                  <span className="flex items-center gap-1 text-zinc-300 truncate">
                    <Compass size={12} className="text-emerald-400 shrink-0" />
                    Perguntas recomendadas para esta tela:
                  </span>
                </div>
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
                  {screenCtx.prompts.map((p, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSend(p)}
                      className="whitespace-nowrap bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 px-3 py-1.5 rounded-xl cursor-pointer transition-colors shrink-0"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Área de mensagem por texto */}
              <div className="shrink-0 pt-2 flex items-center gap-2">
                <input
                  type="text"
                  placeholder={`Pergunte sobre ${screenCtx.name}...`}
                  value={inputQuery}
                  onChange={e => setInputQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSend()}
                  className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded-2xl px-3.5 py-3 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 transition-colors"
                />

                <button
                  onClick={() => handleSend()}
                  disabled={loading || !inputQuery.trim()}
                  className="w-11 h-11 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black flex items-center justify-center cursor-pointer transition-colors disabled:opacity-50 shrink-0"
                >
                  <Send size={18} />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* FIRST ACCESS WELCOME MODAL */}
      <AnimatePresence>
        {showFirstAccessModal && (
          <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="w-full max-w-lg bg-zinc-950 border border-emerald-500/40 rounded-3xl p-6 sm:p-7 shadow-2xl text-white flex flex-col max-h-[90vh] overflow-y-auto space-y-5"
            >
              {/* Header Icon & Title */}
              <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 text-black flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
                  <Sparkles size={24} />
                </div>
                <div>
                  <h2 className="font-headline italic font-black text-xl sm:text-2xl text-white tracking-tight uppercase">
                    Bem-vindo à {user?.aiName || 'Invictus IA'}
                  </h2>
                  <p className="text-xs text-emerald-400 font-medium">
                    Inteligência Artificial & Fisiologia do Exercício
                  </p>
                </div>
              </div>

              {/* Introduction */}
              <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                A <strong>{user?.aiName || 'Invictus IA'}</strong> utiliza inteligência artificial para analisar seus dados e responder perguntas sobre saúde, atividade física, desempenho e funcionamento do aplicativo.
              </p>

              {/* Capabilities list */}
              <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 space-y-2">
                <h3 className="text-xs font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Zap size={14} />
                  Ela pode ajudá-lo a:
                </h3>
                <ul className="text-xs text-zinc-300 space-y-1.5 pl-1">
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400 font-bold">•</span>
                    <span>interpretar suas métricas;</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400 font-bold">•</span>
                    <span>acompanhar sua evolução;</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400 font-bold">•</span>
                    <span>explicar conceitos científicos;</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400 font-bold">•</span>
                    <span>responder dúvidas relacionadas ao treinamento;</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-400 font-bold">•</span>
                    <span>gerar análises e projeções baseadas nos seus dados.</span>
                  </li>
                </ul>
              </div>

              {/* Warnings / Disclaimer list */}
              <div className="bg-amber-950/30 border border-amber-500/30 rounded-2xl p-4 space-y-2">
                <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldAlert size={14} />
                  Antes de continuar, é importante entender que:
                </h3>
                <ul className="text-xs text-zinc-300 space-y-1.5 pl-1">
                  <li className="flex items-start gap-2">
                    <span className="text-amber-400 font-bold">•</span>
                    <span>A inteligência artificial pode cometer erros.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber-400 font-bold">•</span>
                    <span>Algumas respostas podem ser baseadas em estimativas.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber-400 font-bold">•</span>
                    <span>A qualidade das respostas depende da qualidade dos dados registrados.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber-400 font-bold">•</span>
                    <span>A {user?.aiName || 'Invictus IA'} <strong>não realiza diagnósticos médicos</strong>.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber-400 font-bold">•</span>
                    <span>Ela <strong>não substitui</strong> médicos, nutricionistas, fisioterapeutas ou profissionais de Educação Física.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber-400 font-bold">•</span>
                    <span>Nunca utilize as respostas da IA como único critério para decisões relacionadas à sua saúde.</span>
                  </li>
                </ul>
              </div>

              <p className="text-[11px] text-zinc-400 text-center italic">
                Ao continuar, você declara estar ciente dessas informações.
              </p>

              {/* Confirm Button */}
              <button
                onClick={handleConfirmOnboarding}
                className="w-full py-3.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-sm rounded-2xl uppercase tracking-wider transition-all shadow-lg shadow-emerald-500/20 cursor-pointer flex items-center justify-center gap-2"
              >
                <span>Entendi e continuar</span>
                <Check size={18} />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* SOBRE A INVICTUS IA MODAL */}
      <AnimatePresence>
        {showAboutModal && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-2xl bg-zinc-950 border border-emerald-500/40 rounded-3xl p-5 sm:p-7 shadow-2xl text-white flex flex-col max-h-[88vh] overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-zinc-800 pb-4 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center">
                    <Info size={20} />
                  </div>
                  <div>
                    <h2 className="font-headline italic font-black text-lg sm:text-xl text-white uppercase tracking-tight">
                      Sobre a {user?.aiName || 'Invictus IA'}
                    </h2>
                    <p className="text-xs text-zinc-400">
                      Funcionamento, Uso de Dados, Privacidade e Segurança
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowAboutModal(false)}
                  className="w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Content Body */}
              <div className="flex-1 overflow-y-auto pr-1 my-4 space-y-4 text-xs text-zinc-300 leading-relaxed">
                {/* Section 1: Como Funciona */}
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4 space-y-2">
                  <h3 className="font-bold text-sm text-emerald-300 flex items-center gap-2">
                    <Cpu size={16} />
                    Como a IA Funciona
                  </h3>
                  <p>
                    A {user?.aiName || 'Invictus IA'} combina modelos avançados de inteligência artificial com princípios consolidados de fisiologia do esporte. Ela interpreta o histórico de treinos registrados (frequência semanal, tempo, calorias METs, IGA e frequência cardíaca via smartwatch) para responder perguntas e apoiar sua rotina esportiva.
                  </p>
                </div>

                {/* Section 2: Uso de Dados e Privacidade */}
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4 space-y-2">
                  <h3 className="font-bold text-sm text-emerald-300 flex items-center gap-2">
                    <Lock size={16} />
                    Uso de Dados & Privacidade
                  </h3>
                  <p>
                    A IA utiliza exclusivamente dados das permissões e integrações ativamente concedidas por você (Apple Health, Health Connect, Strava, Garmin, etc.).
                  </p>
                  <ul className="list-disc pl-4 space-y-1 text-zinc-400">
                    <li>Caso uma integração não esteja autorizada, a IA informará que a análise está indisponível sem inventar dados biométricos.</li>
                    <li>Seus dados são criptografados e não são vendidos ou utilizados para modelos públicos.</li>
                  </ul>
                </div>

                {/* Section 3: Limitações e Isenção Médica */}
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4 space-y-2">
                  <h3 className="font-bold text-sm text-amber-400 flex items-center gap-2">
                    <ShieldAlert size={16} />
                    Limitações & Isenção Médica
                  </h3>
                  <ul className="list-disc pl-4 space-y-1 text-zinc-300">
                    <li>A IA não realiza diagnósticos clínicos nem substitui avaliação médica presencial.</li>
                    <li>Não substitui médicos, nutricionistas, fisioterapeutas ou educadores físicos.</li>
                    <li>Não prescreve nem altera medicamentos ou tratamentos terapêuticos.</li>
                  </ul>
                </div>

                {/* Section 4: Emergências */}
                <div className="bg-rose-950/30 border border-rose-500/30 rounded-2xl p-4 space-y-2">
                  <h3 className="font-bold text-sm text-rose-400 flex items-center gap-2">
                    <AlertTriangle size={16} />
                    Protocolo em Situações de Emergência
                  </h3>
                  <p>
                    Relatos de dor no peito, falta de ar grave, tontura intensa, desmaio ou perda de consciência disparam a interrupção da IA e orientação para ligar imediatamente para o <strong>SAMU (192)</strong> ou buscar atendimento emergencial.
                  </p>
                </div>

                {/* Section 5: FAQs */}
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4 space-y-3">
                  <h3 className="font-bold text-sm text-emerald-300 flex items-center gap-2">
                    <HelpCircle size={16} />
                    Perguntas Frequentes (FAQ)
                  </h3>
                  <div className="space-y-2">
                    <div>
                      <p className="font-bold text-white">A IA pode cometer erros?</p>
                      <p className="text-zinc-400">Sim, como qualquer sistema de inteligência artificial. Por isso suas análises são informativas e educativas.</p>
                    </div>
                    <div>
                      <p className="font-bold text-white">Sem smartwatch, os dados são inventados?</p>
                      <p className="text-zinc-400">Não. O Invictus calcula métricas auditadas de duração e METs, mantendo gráficos de batimentos transparentes até a conexão do sensor.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer Actions */}
              <div className="pt-3 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
                <button
                  onClick={() => {
                    setShowAboutModal(false);
                    setShowFirstAccessModal(true);
                  }}
                  className="px-3.5 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Sparkles size={14} className="text-emerald-400" />
                  <span>Re-exibir Boas-Vindas</span>
                </button>

                <button
                  onClick={() => setShowAboutModal(false)}
                  className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold rounded-xl text-xs uppercase tracking-wider cursor-pointer transition-colors"
                >
                  Entendi
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
