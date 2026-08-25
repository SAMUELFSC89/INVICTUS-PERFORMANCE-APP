import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import {
  Sparkles,
  X,
  Send,
  Volume2,
  VolumeX,
  Zap,
  TrendingUp,
  Trophy,
  Activity,
  Settings,
  Flame,
  Clock,
  Heart,
  Target,
  Check,
  CheckCheck,
  Play,
  Square,
  Info,
  ShieldAlert,
  HelpCircle,
  Lock,
  Brain,
  Trash2,
  AlertTriangle,
  ChevronRight,
  MapPin,
  Flag,
  RotateCcw
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

  text = text.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/#{1,6}\s?/g, '');
  text = text.replace(/[*_~`#$]/g, '');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/^[•\-\*\>]\s+/gm, '');
  text = text.replace(/^\d+[\.\)]\s+/gm, '');
  text = text.replace(/\(([^)]+)\)/g, ', $1, ');

  text = text.replace(/\bbpm\b/gi, 'batimentos por minuto');
  text = text.replace(/\bkcal\/dia\b/gi, 'quilocalorias por dia');
  text = text.replace(/\bkcal\b/gi, 'quilocalorias');
  text = text.replace(/\bkm\/h\b/gi, 'quilômetros por hora');
  text = text.replace(/\bkm\b/gi, 'quilômetros');
  text = text.replace(/\bkg\b/gi, 'quilos');
  text = text.replace(/\bmin\b/gi, 'minutos');
  text = text.replace(/\bseg\b/gi, 'segundos');
  text = text.replace(/\bpts?\b/gi, 'pontos');
  text = text.replace(/\bIGA\b/g, 'I G A');
  text = text.replace(/\bVO2\b/gi, 'V Ó 2');
  text = text.replace(/\bIA\b/g, 'I A');

  // Remove emojis
  text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
  text = text.replace(/[:;]\s*/g, ', ');
  text = text.replace(/\n+/g, '. ');
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

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

export interface ContextualChip {
  id: string;
  label: string;
  iconType: 'chart' | 'target' | 'flag' | 'flame' | 'heart' | 'zap' | 'trophy' | 'mapPin';
  prompt: string;
}

// Map route path to human-readable screen title, contextual analysis CTA, and exactly 3 contextual chips
function getScreenContext(pathname: string): {
  name: string;
  analysisAction: string;
  analysisPrompt: string;
  chips: ContextualChip[];
} {
  if (pathname.startsWith('/profile')) {
    return {
      name: 'Perfil & Evolução',
      analysisAction: 'Analisar minha evolução completa',
      analysisPrompt: 'Resuma minha evolução completa e progresso desde meu primeiro treino.',
      chips: [
        { id: 'c1', label: 'Minha evolução', iconType: 'chart', prompt: 'Resuma minha evolução desde meu primeiro treino.' },
        { id: 'c2', label: 'Como melhorar?', iconType: 'target', prompt: 'Como posso acelerar minha evolução e melhorar meus resultados?' },
        { id: 'c3', label: 'Próxima meta', iconType: 'flag', prompt: 'Qual deve ser minha próxima meta física e de consistência?' }
      ]
    };
  }

  if (pathname.startsWith('/activity') || pathname.startsWith('/cardio')) {
    return {
      name: 'Cardio',
      analysisAction: 'Analisar meu desempenho no cardio',
      analysisPrompt: 'Analise meu desempenho no cardio, ritmo e zonas cardíacas.',
      chips: [
        { id: 'c1', label: 'Meu cardio', iconType: 'zap', prompt: 'Como está meu desempenho e evolução no cardio?' },
        { id: 'c2', label: 'Melhorar pace', iconType: 'target', prompt: 'Como posso melhorar meu pace mantendo a frequência cardíaca segura?' },
        { id: 'c3', label: 'Recuperação', iconType: 'heart', prompt: 'Como está minha recuperação cardiovascular após os treinos?' }
      ]
    };
  }

  if (pathname.startsWith('/workouts') || pathname.startsWith('/workout')) {
    return {
      name: 'Musculação',
      analysisAction: 'Analisar meus treinos',
      analysisPrompt: 'Analise a frequência, consistência e evolução dos meus treinos de força.',
      chips: [
        { id: 'c1', label: 'Meus treinos', iconType: 'chart', prompt: 'Resuma meus treinos de musculação e volume recente.' },
        { id: 'c2', label: 'Consistência', iconType: 'flame', prompt: 'Como manter minha constância e sequência semanal de treinos?' },
        { id: 'c3', label: 'Próxima meta', iconType: 'flag', prompt: 'Qual deve ser o próximo aumento de carga ou meta de treino?' }
      ]
    };
  }

  if (pathname.startsWith('/rankings')) {
    return {
      name: 'Ranking',
      analysisAction: 'Analisar minha pontuação no ranking',
      analysisPrompt: 'Analise minha posição atual no ranking e quantos pontos preciso para subir na liga.',
      chips: [
        { id: 'c1', label: 'Meu ranking', iconType: 'trophy', prompt: 'Como posso subir posições no ranking esta semana?' },
        { id: 'c2', label: 'Subir na liga', iconType: 'target', prompt: 'Quem está na minha frente e quantos pontos faltam?' },
        { id: 'c3', label: 'Próxima meta', iconType: 'flag', prompt: 'Qual a pontuação necessária para me manter no Top 10?' }
      ]
    };
  }

  if (pathname.startsWith('/challenges') || pathname.startsWith('/campeonatos')) {
    return {
      name: 'Desafios',
      analysisAction: 'Analisar meus desafios e temporada',
      analysisPrompt: 'Analise meu progresso nos desafios e campeonatos ativos.',
      chips: [
        { id: 'c1', label: 'Desafio ativo', iconType: 'target', prompt: 'Dicas para completar meus desafios ativos mais rápido.' },
        { id: 'c2', label: 'Ganhar XP', iconType: 'zap', prompt: 'Quais atividades dão mais pontuação para os desafios?' },
        { id: 'c3', label: 'Premiações', iconType: 'trophy', prompt: 'Quais são as metas para alcançar as melhores premiações?' }
      ]
    };
  }

  if (pathname.startsWith('/performance') || pathname.startsWith('/health')) {
    return {
      name: 'Centro de Performance',
      analysisAction: 'Analisar meus indicadores',
      analysisPrompt: 'Analise meus indicadores biométricos, IGA, prontidão e VO2 Max.',
      chips: [
        { id: 'c1', label: 'Minha prontidão', iconType: 'zap', prompt: 'Qual a minha prontidão metabólica e recuperação para hoje?' },
        { id: 'c2', label: 'Score IGA', iconType: 'chart', prompt: 'Como meu IGA e capacidade física evoluíram recentemente?' },
        { id: 'c3', label: 'Ajuste de treino', iconType: 'target', prompt: 'Devo treinar pesado ou fazer um treino regenerativo hoje?' }
      ]
    };
  }

  if (pathname.startsWith('/gym')) {
    return {
      name: 'Academia & Presença',
      analysisAction: 'Analisar minha frequência presencial',
      analysisPrompt: 'Analise meus check-ins e frequência presencial na academia.',
      chips: [
        { id: 'c1', label: 'Check-in GPS', iconType: 'mapPin', prompt: 'Como funciona a validação presencial por GPS na academia?' },
        { id: 'c2', label: 'Frequência', iconType: 'chart', prompt: 'Quantos check-ins presenciais realizei este mês?' },
        { id: 'c3', label: 'Acelerar IGA', iconType: 'zap', prompt: 'Dicas de treino presencial para acelerar meu IGA.' }
      ]
    };
  }

  // Default Home / Visão Geral
  return {
    name: 'Perfil & Evolução',
    analysisAction: 'Analisar minha evolução completa',
    analysisPrompt: 'Resuma minha evolução completa e progresso desde meu primeiro treino.',
    chips: [
      { id: 'c1', label: 'Minha evolução', iconType: 'chart', prompt: 'Resuma minha evolução desde meu primeiro treino.' },
      { id: 'c2', label: 'Como melhorar?', iconType: 'target', prompt: 'Como posso acelerar minha evolução e melhorar meus treinos?' },
      { id: 'c3', label: 'Próxima meta', iconType: 'flag', prompt: 'Qual deve ser minha próxima meta física e de consistência?' }
    ]
  };
}

// Render chip icon cleanly
function renderChipIcon(type: string) {
  switch (type) {
    case 'chart':
      return <TrendingUp size={13} className="text-[#f5ab12] shrink-0" />;
    case 'target':
      return <Target size={13} className="text-[#f5ab12] shrink-0" />;
    case 'flag':
      return <Flag size={13} className="text-[#f5ab12] shrink-0" />;
    case 'flame':
      return <Flame size={13} className="text-[#f5ab12] shrink-0" />;
    case 'heart':
      return <Heart size={13} className="text-[#f5ab12] shrink-0" />;
    case 'zap':
      return <Zap size={13} className="text-[#f5ab12] shrink-0" />;
    case 'trophy':
      return <Trophy size={13} className="text-[#f5ab12] shrink-0" />;
    case 'mapPin':
      return <MapPin size={13} className="text-[#f5ab12] shrink-0" />;
    default:
      return <Sparkles size={13} className="text-[#f5ab12] shrink-0" />;
  }
}

export function InvictusAIFloatingAssistant() {
  const location = useLocation();
  const { user } = useUser();
  const [isOpen, setIsOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [inputQuery, setInputQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [hasNewInsight, setHasNewInsight] = useState(true);
  const [perfState, setPerfState] = useState<any>(null);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);

  // Onboarding & Safety Modals
  const [isOnboarded, setIsOnboarded] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('invictus_ai_onboarded') === 'true';
    }
    return false;
  });
  const [showFirstAccessModal, setShowFirstAccessModal] = useState<boolean>(false);
  const [showAboutModal, setShowAboutModal] = useState<boolean>(false);

  // User Memories System
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
      if (!res.ok) throw new Error('Não foi possível carregar as memórias.');
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
          return {
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
        console.warn('[Invictus AI] Context load warning:', err);
      }
    }
    loadPerf();
    return () => { isMounted = false; };
  }, [user]);

  // Handle ESC key for closing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showAboutModal) {
          setShowAboutModal(false);
          return;
        }
        if (showMemoriesModal) {
          setShowMemoriesModal(false);
          return;
        }
        if (showSettings) {
          setShowSettings(false);
          return;
        }
        if (showFirstAccessModal) {
          setShowFirstAccessModal(false);
          return;
        }
        if (isOpen) {
          setIsOpen(false);
          stopSpeaking();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showAboutModal, showMemoriesModal, showSettings, showFirstAccessModal]);

  const [messages, setMessages] = useState<Message[]>([]);

  // Initial welcome message (clean and contextual)
  useEffect(() => {
    if (user && messages.length === 0) {
      setMessages([
        {
          id: 'init_msg',
          sender: 'ai',
          text: `Estou acompanhando você.\nComo posso ajudar na sua evolução?`,
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    }
  }, [user, messages.length]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, loading]);

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
        hasHeartRateSensor: false,
        currentHeartRate: null,
        currentZone: null,
        checkInId: currentSession.checkInId
      };
    } catch (e) {
      return null;
    }
  };

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
    setSpeakingMessageId(null);
  };

  const playBase64Audio = (base64Data: string, messageId?: string, mimeType: string = 'audio/mp3') => {
    stopSpeaking();
    if (!voiceConfig.speechEnabled || !base64Data) return;

    try {
      const audioUrl = `data:${mimeType};base64,${base64Data}`;
      const audio = new Audio(audioUrl);
      activeAudioRef.current = audio;

      audio.onplay = () => {
        setIsSpeaking(true);
        if (messageId) setSpeakingMessageId(messageId);
      };

      audio.onended = () => {
        setIsSpeaking(false);
        setSpeakingMessageId(null);
        activeAudioRef.current = null;
        invictusAudioEffects.playResponseChime(voiceConfig.soundEffectsEnabled);
      };

      audio.onerror = () => {
        setIsSpeaking(false);
        setSpeakingMessageId(null);
        activeAudioRef.current = null;
      };

      audio.play().catch(() => {
        setIsSpeaking(false);
        setSpeakingMessageId(null);
      });
    } catch (err) {
      setIsSpeaking(false);
      setSpeakingMessageId(null);
    }
  };

  const speakResponseText = (text: string, messageId?: string, force: boolean = false) => {
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
          if (messageId) setSpeakingMessageId(messageId);
        };

        utterance.onend = () => {
          speechChunkIndexRef.current++;
          playNextChunk();
        };

        utterance.onerror = () => {
          speechChunkIndexRef.current++;
          playNextChunk();
        };

        try {
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
          window.speechSynthesis.speak(utterance);
        } catch (err) {
          setIsSpeaking(false);
          setSpeakingMessageId(null);
        }
      };

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
      setIsSpeaking(false);
      setSpeakingMessageId(null);
    }
  };

  const handleSend = async (queryText?: string) => {
    const textToSend = queryText || inputQuery;
    if (!textToSend.trim()) return;

    stopSpeaking();

    const userMsg: Message = {
      id: `usr_${Date.now()}`,
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    if (!queryText) setInputQuery('');

    // EMERGENCY CHECK
    const qLower = textToSend.toLowerCase();
    const EMERGENCY_KEYWORDS = [
      'dor no peito', 'falta de ar', 'desmaio', 'desmaiei', 'convulsão', 'fraqueza súbita',
      'parada cardiaca', 'avc', 'infarto'
    ];

    if (EMERGENCY_KEYWORDS.some(k => qLower.includes(k))) {
      const emergencyMsg = `🚨 **ATENÇÃO: PROTOCOLO DE EMERGÊNCIA MÉDICA** 🚨\n\nIdentificamos relatos de possíveis sintomas de emergência.\n\n**A análise da IA foi interrompida.**\n\nPor favor, procure atendimento imediatamente:\n• **Ligue para o SAMU: 192**\n• **Dirija-se ao Pronto Socorro mais próximo**`;

      const aiMsg: Message = {
        id: `ai_${Date.now()}`,
        sender: 'ai',
        text: emergencyMsg,
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, aiMsg]);
      setLoading(false);
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
          const newAiMsgId = `ai_${Date.now()}`;

          const aiMsg: Message = {
            id: newAiMsgId,
            sender: 'ai',
            text: data.answer,
            audioBase64: audioB64,
            audioMimeType: audioMime,
            confidence: data.confidence || 'ALTA',
            sources: data.sources,
            timestamp: data.timestamp || new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          };
          setMessages(prev => [...prev, aiMsg]);
          setLoading(false);

          if (voiceConfig.speechEnabled) {
            if (audioB64) {
              playBase64Audio(audioB64, newAiMsgId, audioMime);
            } else {
              speakResponseText(data.answer, newAiMsgId);
            }
          }
          return;
        }
      }
    } catch (err) {
      console.warn('[Invictus AI] Erro ao consultar IA:', err);
    }

    setMessages(prev => [...prev, {
      id: `ai_${Date.now()}`,
      sender: 'ai',
      text: 'Não foi possível consultar a IA no momento. Tente novamente em instantes.',
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    }]);
    setLoading(false);
  };

  const handleOpenPanel = () => {
    setIsOpen(true);
    setHasNewInsight(false);
  };

  // Helper to parse message text and detect progressive disclosure CTA
  const renderMessageContent = (m: Message) => {
    const rawText = m.text;
    const hasFullAnalysisCTA = 
      rawText.includes('[Ver análise completa >]') || 
      rawText.includes('Ver análise completa  >') ||
      rawText.includes('Ver análise completa >') ||
      rawText.includes('Ver análise completa');

    // Clean CTA trigger from raw text if present at the end
    const cleanedText = rawText
      .replace(/\[?Ver análise completa\s*>?\]?/gi, '')
      .trim();

    return (
      <div className="space-y-2">
        <div className="markdown-body text-[13px] sm:text-sm leading-relaxed text-zinc-100 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_strong]:font-semibold [&_strong]:text-[#f5ab12]">
          <Markdown>{cleanedText || rawText}</Markdown>
        </div>

        {/* Progressive Disclosure Interactive Action */}
        {hasFullAnalysisCTA && (
          <button
            onClick={() => handleSend('Quero ver a análise completa detalhada com todos os dados e métricas.')}
            className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-[#f5ab12] hover:text-amber-300 transition-colors cursor-pointer group py-0.5"
          >
            <span>Ver análise completa</span>
            <ChevronRight size={14} className="text-[#f5ab12] group-hover:translate-x-0.5 transition-transform" />
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      {/* GLOBAL FLOATING BUTTON (FAB) WHEN CHAT IS CLOSED */}
      {!isOpen && (
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
          whileDrag={{ scale: 1.08 }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="fixed bottom-20 md:bottom-24 right-4 md:right-8 z-50 flex flex-col items-center cursor-grab active:cursor-grabbing touch-none select-none"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (isDraggingRef.current) return;
              handleOpenPanel();
            }}
            className="group relative flex flex-col items-center gap-1 focus:outline-none cursor-pointer"
            title={`INVICTUS IA - ${screenCtx.name}`}
          >
            {/* Outer Ring with Invictus Golden Glow */}
            <div className="relative w-12 h-12 rounded-full bg-zinc-950 border border-zinc-800 p-1.5 shadow-[0_4px_20px_rgba(0,0,0,0.8),0_0_15px_rgba(245,171,18,0.25)] transition-transform group-hover:scale-105 active:scale-95 flex items-center justify-center">
              {/* Official Invictus Helmet Emblem */}
              <img
                src="/capacete.webp"
                alt="Invictus IA"
                className="w-full h-full object-contain select-none"
                draggable={false}
                onError={(e) => {
                  e.currentTarget.src = '/ranking-emblem-user-provided.png';
                }}
              />

              {/* Notification badge / Ping */}
              {hasNewInsight && (
                <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#f5ab12] opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-[#f5ab12] border-2 border-zinc-950" />
                </span>
              )}
            </div>

            {/* Pill Label under orb */}
            <span className="text-[10px] font-headline font-black uppercase tracking-wider text-white bg-zinc-950/95 px-2.5 py-0.5 rounded-full border border-zinc-800 shadow-md">
              INVICTUS <span className="text-[#f5ab12]">IA</span>
            </span>
          </button>
        </motion.div>
      )}

      {/* CHAT MODAL / BOTTOM SHEET */}
      <AnimatePresence>
        {isOpen && (
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setIsOpen(false);
                stopSpeaking();
              }
            }}
            className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center p-0 sm:p-4 bg-black/85 backdrop-blur-sm cursor-pointer select-none"
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.4 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 100 || info.velocity.y > 300) {
                  setIsOpen(false);
                  stopSpeaking();
                }
              }}
              className="relative w-full max-w-lg h-[92dvh] sm:h-[86vh] bg-[#0c0c0e] border border-zinc-800/80 rounded-t-[32px] sm:rounded-[32px] px-4 pt-3 pb-3 sm:px-5 sm:pt-4 sm:pb-4 shadow-2xl text-white flex flex-col justify-between overflow-hidden cursor-default select-auto"
            >
              {/* Top Golden Pull Handle (Reference Visual) */}
              <div
                onClick={() => {
                  setIsOpen(false);
                  stopSpeaking();
                }}
                className="w-full flex items-center justify-center cursor-pointer py-1 shrink-0 group"
              >
                <div className="w-12 h-1 bg-[#f5ab12]/80 group-hover:bg-[#f5ab12] rounded-full transition-colors" />
              </div>

              {/* 1. Header (Follows visual reference faithful hierarchy) */}
              <div className="flex items-center justify-between pt-1 pb-3 shrink-0">
                {/* Left: Official Logo + Title + Context Subtitle */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative w-11 h-11 rounded-full bg-zinc-950 border border-zinc-800 p-1.5 flex items-center justify-center shrink-0 shadow-inner">
                    <img
                      src="/capacete.webp"
                      alt="Invictus IA"
                      className="w-full h-full object-contain select-none"
                      draggable={false}
                      onError={(e) => {
                        e.currentTarget.src = '/ranking-emblem-user-provided.png';
                      }}
                    />
                  </div>

                  <div className="min-w-0 flex flex-col justify-center">
                    <h2 className="font-headline italic font-black text-lg text-white uppercase tracking-wider leading-none flex items-center gap-1.5">
                      <span>INVICTUS</span>
                      <span className="text-[#f5ab12]">IA</span>
                    </h2>
                    <p className="text-xs text-zinc-400 font-normal truncate mt-1">
                      {screenCtx.name}
                    </p>
                  </div>
                </div>

                {/* Right: Sound, Settings, Close */}
                <div className="flex items-center gap-1.5 shrink-0 text-zinc-400">
                  {/* Sound Toggle */}
                  <button
                    onClick={() => {
                      if (isSpeaking) {
                        stopSpeaking();
                      }
                      updateVoiceConfig({ speechEnabled: !voiceConfig.speechEnabled });
                    }}
                    className={`p-2 rounded-xl hover:text-white transition-colors cursor-pointer ${
                      voiceConfig.speechEnabled ? 'text-[#f5ab12]' : 'text-zinc-400'
                    }`}
                    title={voiceConfig.speechEnabled ? 'Áudio/Voz ativado' : 'Áudio desativado'}
                  >
                    {voiceConfig.speechEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
                  </button>

                  {/* Settings */}
                  <button
                    onClick={() => setShowSettings(!showSettings)}
                    className="p-2 rounded-xl text-zinc-400 hover:text-white transition-colors cursor-pointer"
                    title="Configurações da IA"
                  >
                    <Settings size={20} />
                  </button>

                  {/* Close */}
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      stopSpeaking();
                    }}
                    className="p-2 rounded-xl text-zinc-400 hover:text-white transition-colors cursor-pointer"
                    title="Fechar conversa"
                  >
                    <X size={22} />
                  </button>
                </div>
              </div>

              {/* Settings / Memories Dropdown Drawer */}
              <AnimatePresence>
                {showSettings && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="bg-zinc-900/95 border border-zinc-800 rounded-2xl p-3.5 my-1 text-xs space-y-3 shrink-0 overflow-hidden"
                  >
                    <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                      <span className="font-bold text-white flex items-center gap-1.5">
                        <Settings size={14} className="text-[#f5ab12]" />
                        Preferências da Invictus IA
                      </span>
                      <button
                        onClick={() => setShowSettings(false)}
                        className="text-zinc-400 hover:text-white"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {/* TTS Toggle */}
                      <div className="flex items-center justify-between bg-zinc-950 p-2.5 rounded-xl border border-zinc-800/80">
                        <div>
                          <div className="font-semibold text-zinc-200 text-[11px]">Resposta em Voz</div>
                          <div className="text-[9px] text-zinc-400">Ler respostas em áudio</div>
                        </div>
                        <button
                          onClick={() => updateVoiceConfig({ speechEnabled: !voiceConfig.speechEnabled })}
                          className={`w-9 h-5 rounded-full transition-colors relative ${
                            voiceConfig.speechEnabled ? 'bg-[#f5ab12]' : 'bg-zinc-800'
                          }`}
                        >
                          <span
                            className={`block w-4 h-4 bg-white rounded-full transition-transform transform ${
                              voiceConfig.speechEnabled ? 'translate-x-4' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </div>

                      {/* Memories Manager Button */}
                      <button
                        onClick={() => {
                          setShowMemoriesModal(true);
                          loadUserMemories();
                        }}
                        className="flex items-center justify-between bg-zinc-950 p-2.5 rounded-xl border border-zinc-800/80 hover:border-zinc-700 text-left transition-colors cursor-pointer"
                      >
                        <div>
                          <div className="font-semibold text-zinc-200 text-[11px] flex items-center gap-1">
                            <Brain size={12} className="text-[#f5ab12]" /> Memórias do Coach
                          </div>
                          <div className="text-[9px] text-zinc-400">Ver e gerenciar aprendizados</div>
                        </div>
                        <ChevronRight size={14} className="text-zinc-500" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-zinc-800/60 text-[10px]">
                      <button
                        onClick={() => setShowAboutModal(true)}
                        className="text-zinc-400 hover:text-white flex items-center gap-1 cursor-pointer"
                      >
                        <Info size={12} /> Sobre a IA e Privacidade
                      </button>
                      <button
                        onClick={() => setMessages([{
                          id: `init_${Date.now()}`,
                          sender: 'ai',
                          text: `Estou acompanhando você.\nComo posso ajudar na sua evolução?`,
                          timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                        }])}
                        className="text-zinc-400 hover:text-[#f5ab12] flex items-center gap-1 cursor-pointer"
                      >
                        <RotateCcw size={12} /> Limpar chat
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* 2. Action CTA Card (Compact horizontal action like reference) */}
              <div className="shrink-0 mb-2">
                <button
                  onClick={() => handleSend(screenCtx.analysisPrompt)}
                  className="w-full bg-[#161619] hover:bg-[#1f1f23] border border-zinc-800/90 rounded-2xl px-4 py-3 flex items-center justify-between transition-all active:scale-[0.99] cursor-pointer group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Sparkles size={16} className="text-emerald-400 shrink-0" />
                    <span className="text-xs sm:text-sm font-medium text-zinc-200 tracking-wide truncate">
                      {screenCtx.analysisAction}
                    </span>
                  </div>
                  <ChevronRight size={16} className="text-emerald-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
                </button>
              </div>

              {/* 3. Conversation Area */}
              <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1 py-1 my-1">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    {m.sender === 'ai' ? (
                      // AI Message Bubble
                      <div className="flex items-start gap-2.5 max-w-[94%] sm:max-w-[88%]">
                        {/* Avatar */}
                        <div className="relative w-8 h-8 rounded-full bg-zinc-950 border border-zinc-800 p-1 flex items-center justify-center shrink-0 mt-0.5">
                          <img
                            src="/capacete.webp"
                            alt="Invictus IA"
                            className="w-full h-full object-contain select-none"
                            draggable={false}
                            onError={(e) => {
                              e.currentTarget.src = '/ranking-emblem-user-provided.png';
                            }}
                          />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="bg-[#18181b] border border-zinc-800/80 rounded-2xl rounded-tl-xs p-3.5 sm:p-4 text-zinc-200 shadow-sm relative group">
                            {renderMessageContent(m)}

                            {/* Discreet Audio Speaker Icon */}
                            <div className="absolute top-2.5 right-2.5">
                              <button
                                onClick={() => {
                                  if (isSpeaking && speakingMessageId === m.id) {
                                    stopSpeaking();
                                  } else if (m.audioBase64) {
                                    playBase64Audio(m.audioBase64, m.id, m.audioMimeType);
                                  } else {
                                    speakResponseText(m.text, m.id, true);
                                  }
                                }}
                                className={`p-1 rounded-lg text-zinc-500 hover:text-[#f5ab12] transition-colors cursor-pointer ${
                                  isSpeaking && speakingMessageId === m.id ? 'text-[#f5ab12]' : 'opacity-60 hover:opacity-100'
                                }`}
                                title="Ouvir resposta"
                              >
                                {isSpeaking && speakingMessageId === m.id ? (
                                  <Square size={13} className="fill-current animate-pulse" />
                                ) : (
                                  <Volume2 size={14} />
                                )}
                              </button>
                            </div>
                          </div>
                          <span className="text-[10px] text-zinc-500 mt-1 block pl-1">{m.timestamp}</span>
                        </div>
                      </div>
                    ) : (
                      // User Message Bubble
                      <div className="max-w-[85%] sm:max-w-[80%]">
                        <div className="bg-gradient-to-br from-[#7a5418] to-[#593d0f] border border-amber-600/30 text-white rounded-2xl rounded-tr-xs p-3.5 sm:p-4 text-[13px] sm:text-sm leading-relaxed shadow-md font-normal">
                          <p className="whitespace-pre-line">{m.text}</p>
                        </div>
                        <div className="flex items-center justify-end gap-1 mt-1 pr-1 text-[10px] text-zinc-400">
                          <span>{m.timestamp}</span>
                          <CheckCheck size={13} className="text-[#f5ab12]" />
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Processing Indicator */}
                {loading && (
                  <div className="flex items-start gap-2.5 max-w-[90%]">
                    <div className="relative w-8 h-8 rounded-full bg-zinc-950 border border-zinc-800 p-1 flex items-center justify-center shrink-0">
                      <img
                        src="/capacete.webp"
                        alt="Invictus IA"
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <div className="bg-[#18181b] border border-zinc-800/80 rounded-2xl rounded-tl-xs px-4 py-3 text-xs text-zinc-300 flex items-center gap-2">
                      <Sparkles size={14} className="text-emerald-400 animate-spin" />
                      <span className="font-medium">Analisando...</span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* 4. Three Contextual Suggestion Chips (Reference Visual) */}
              <div className="shrink-0 pt-1 pb-2">
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
                  {screenCtx.chips.slice(0, 3).map((chip) => (
                    <button
                      key={chip.id}
                      onClick={() => handleSend(chip.prompt)}
                      className="bg-black/60 hover:bg-[#f5ab12]/10 border border-[#f5ab12]/40 hover:border-[#f5ab12] text-amber-200/90 text-xs px-3.5 py-1.5 rounded-full flex items-center gap-1.5 transition-all active:scale-95 whitespace-nowrap shrink-0 cursor-pointer shadow-sm"
                    >
                      {renderChipIcon(chip.iconType)}
                      <span className="font-medium">{chip.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 5. Input Field + Circular Send Button */}
              <div className="shrink-0 flex items-center gap-2.5 pt-1">
                <div className="flex-1 bg-[#18181b] border border-zinc-800/90 focus-within:border-[#f5ab12]/60 rounded-full px-4 sm:px-5 py-3 flex items-center transition-colors shadow-inner">
                  <input
                    type="text"
                    placeholder="Pergunte à Invictus IA..."
                    value={inputQuery}
                    onChange={(e) => setInputQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    className="w-full bg-transparent text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none"
                  />
                </div>

                <button
                  onClick={() => handleSend()}
                  disabled={loading || !inputQuery.trim()}
                  className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-[#f5ab12] hover:bg-[#ffb72b] disabled:opacity-40 text-black flex items-center justify-center cursor-pointer transition-all active:scale-95 shadow-[0_4px_15px_rgba(245,171,18,0.35)] shrink-0"
                  title="Enviar mensagem"
                >
                  <Send size={18} className="translate-x-0.5 -translate-y-0.5 fill-black" />
                </button>
              </div>

              {/* 6. Discreet One-Line Safety Disclaimer */}
              <div className="shrink-0 pt-2 pb-0.5 text-center">
                <p className="text-[10px] sm:text-[11px] text-zinc-500 flex items-center justify-center gap-1 truncate px-2">
                  <Info size={12} className="shrink-0 text-zinc-500" />
                  <span>IA pode cometer erros. Use as orientações com consciência.</span>
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MEMORIES SYSTEM MODAL */}
      <AnimatePresence>
        {showMemoriesModal && (
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowMemoriesModal(false);
            }}
            className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md cursor-pointer select-none"
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg bg-[#0f0f12] border border-zinc-800 rounded-3xl p-5 sm:p-6 shadow-2xl text-white flex flex-col max-h-[85vh] overflow-hidden cursor-default select-auto"
            >
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3 shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-[#f5ab12]">
                    <Brain size={18} />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">Memórias do Coach</h3>
                    <p className="text-[10px] text-zinc-400">Aprendizados individualizados para você</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowMemoriesModal(false)}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-1 my-3 space-y-2 text-xs">
                {loadingMemories ? (
                  <div className="py-8 text-center text-zinc-400 flex items-center justify-center gap-2">
                    <Sparkles size={14} className="animate-spin text-[#f5ab12]" /> Carregando memórias...
                  </div>
                ) : userMemories.length === 0 ? (
                  <div className="py-8 text-center text-zinc-500 italic bg-zinc-950 p-4 rounded-2xl border border-zinc-900">
                    Nenhuma memória gravada ainda. Converse com a IA para que ela aprenda suas metas e preferências automaticamente.
                  </div>
                ) : (
                  userMemories.map(m => (
                    <div
                      key={m.id}
                      className="bg-zinc-950 p-3 rounded-xl border border-zinc-800/80 flex items-start justify-between gap-2"
                    >
                      <div className="space-y-1 min-w-0">
                        <span className="px-1.5 py-0.5 rounded bg-zinc-900 text-[#f5ab12] border border-[#f5ab12]/30 uppercase font-semibold text-[8px]">
                          {m.category || 'Geral'}
                        </span>
                        <p className="text-zinc-200 text-xs break-words">
                          {m.content}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteMemory(m.id)}
                        className="text-zinc-500 hover:text-rose-400 p-1 rounded transition-colors shrink-0"
                        title="Excluir memória"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="pt-2 border-t border-zinc-800 shrink-0 text-right">
                <button
                  onClick={() => setShowMemoriesModal(false)}
                  className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-xs font-semibold"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ABOUT MODAL */}
      <AnimatePresence>
        {showAboutModal && (
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowAboutModal(false);
            }}
            className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md cursor-pointer select-none"
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-xl bg-[#0f0f12] border border-zinc-800 rounded-3xl p-5 sm:p-6 shadow-2xl text-white flex flex-col max-h-[85vh] overflow-hidden cursor-default select-auto"
            >
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3 shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-[#f5ab12]">
                    <Info size={18} />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">Sobre a INVICTUS IA</h3>
                    <p className="text-[10px] text-zinc-400">Segurança, Termos e Limitações</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowAboutModal(false)}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-1 my-3 space-y-3 text-xs text-zinc-300 leading-relaxed">
                <div className="bg-zinc-950 p-3.5 rounded-2xl border border-zinc-800/80 space-y-1.5">
                  <h4 className="font-bold text-white text-xs flex items-center gap-1.5">
                    <Zap size={14} className="text-[#f5ab12]" /> Inteligência & Fisiologia
                  </h4>
                  <p className="text-[11px] text-zinc-400">
                    A Invictus IA interpreta seu histórico de treinos registrados (frequência, tempo, calorias e sensores) para oferecer suporte informativo à sua evolução.
                  </p>
                </div>

                <div className="bg-zinc-950 p-3.5 rounded-2xl border border-zinc-800/80 space-y-1.5">
                  <h4 className="font-bold text-amber-400 text-xs flex items-center gap-1.5">
                    <ShieldAlert size={14} /> Isenção Médica
                  </h4>
                  <p className="text-[11px] text-zinc-400">
                    A IA não realiza diagnósticos clínicos e não substitui médicos, nutricionistas ou educadores físicos.
                  </p>
                </div>

                <div className="bg-rose-950/20 p-3.5 rounded-2xl border border-rose-500/20 space-y-1.5">
                  <h4 className="font-bold text-rose-400 text-xs flex items-center gap-1.5">
                    <AlertTriangle size={14} /> Emergências de Saúde
                  </h4>
                  <p className="text-[11px] text-zinc-300">
                    Em sintomas graves como dor no peito ou falta de ar intensa, ligue imediatamente para o SAMU (192).
                  </p>
                </div>
              </div>

              <div className="pt-2 border-t border-zinc-800 shrink-0 text-right">
                <button
                  onClick={() => setShowAboutModal(false)}
                  className="px-4 py-2 bg-[#f5ab12] text-black font-bold rounded-xl text-xs"
                >
                  Entendi
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* FIRST ACCESS MODAL */}
      <AnimatePresence>
        {showFirstAccessModal && (
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowFirstAccessModal(false);
            }}
            className="fixed inset-0 z-[160] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md cursor-pointer select-none"
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-[#0f0f12] border border-zinc-800 rounded-3xl p-6 shadow-2xl text-white flex flex-col space-y-4 cursor-default select-auto"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-zinc-950 border border-zinc-800 p-1.5 flex items-center justify-center shrink-0">
                  <img
                    src="/capacete.webp"
                    alt="Invictus IA"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div>
                  <h3 className="font-headline font-black italic uppercase text-lg text-white">
                    INVICTUS <span className="text-[#f5ab12]">IA</span>
                  </h3>
                  <p className="text-xs text-zinc-400">Seu Coach e Inteligência de Treino</p>
                </div>
              </div>

              <p className="text-xs text-zinc-300 leading-relaxed">
                A Invictus IA ajuda você a interpretar suas métricas de treino, acompanhar sua evolução e esclarecer dúvidas sobre sua performance física.
              </p>

              <div className="bg-zinc-950 p-3 rounded-2xl border border-zinc-800/80 text-[11px] text-zinc-400 space-y-1">
                <p>• As orientações têm caráter informativo e educativo.</p>
                <p>• Não realiza diagnósticos médicos nem substitui profissionais.</p>
              </div>

              <button
                onClick={handleConfirmOnboarding}
                className="w-full py-3 bg-[#f5ab12] hover:bg-[#ffb72b] text-black font-extrabold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md flex items-center justify-center gap-2"
              >
                <span>Entendi e Continuar</span>
                <Check size={16} />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
