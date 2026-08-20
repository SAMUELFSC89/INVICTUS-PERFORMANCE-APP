import React, { useState, useEffect } from 'react';
import { useUser } from '../UserContext';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Trophy, Dumbbell, Award, ShieldAlert, CheckCircle, RefreshCw, AlertOctagon, 
  ChevronLeft, Video, Sparkles, Send, Users, ShieldCheck, Play, HelpCircle, Eye, Trash2, Ban, Plus, Lock, X,
  Zap, TrendingUp, UserPlus, ChevronRight, Bell, Crown, MessageSquare, Flame, Calendar, MapPin, User, Skull
} from 'lucide-react';
import { db, storage, auth, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, limit, orderBy } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { cn } from '../lib/utils';
import { validationService } from '../services/validationService';

// Core Type Definitions
interface PowerRecord {
  id?: string;
  userId: string;
  userName: string;
  userPhoto?: string;
  gymId: string;
  gymName: string;
  city: string;
  exercise: 'supino' | 'agachamento' | 'terra';
  weight: number;
  date: string;
  videoUrl: string;
  videoStatus: 'approved' | 'manual_review' | 'rejected';
  userMessage?: string;
  reports: string[]; // List of userIds that reported
}

interface PowerDuel {
  id?: string;
  challengerId: string;
  challengerName: string;
  challengerPhoto?: string;
  defenderId: string;
  defenderName: string;
  defenderPhoto?: string;
  exercise: 'supino' | 'agachamento' | 'terra';
  weight: number;
  status: 'pending' | 'accepted' | 'declined' | 'completed' | 'cancelled';
  createdAt: string;
  expiresAt: string;
  result?: 'pending_submissions' | 'challenger_won' | 'defender_won' | 'draw' | 'cancelled';
  challengerStatus?: 'none' | 'completed' | 'failed';
  defenderStatus?: 'none' | 'completed' | 'failed';
}

interface BeltHolder {
  exercise: 'supino' | 'agachamento' | 'terra';
  userName: string;
  weight: number;
  gymName: string;
  city: string;
}

interface PowerFeedEvent {
  id?: string;
  userId: string;
  userName: string;
  eventType: 'record' | 'belt_conquest' | 'duel_accepted' | 'duel_completed' | 'top_10_entry' | 'system_alert';
  message: string;
  timestamp: string;
  exercise?: 'supino' | 'agachamento' | 'terra';
  weight?: number;
}

const extractVideoFramesBase64 = (file: File): Promise<string[]> => {
  return new Promise((resolve) => {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => resolve([(reader.result as string) || '']);
      reader.onerror = () => resolve([]);
      reader.readAsDataURL(file);
      return;
    }

    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = url;

    const capturedFrames: string[] = [];
    let resolved = false;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.remove();
    };

    const finish = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(capturedFrames.filter(Boolean));
    };

    const maxDim = 512;
    const captureFrame = (): string => {
      try {
        const canvas = document.createElement('canvas');
        let w = video.videoWidth || 640;
        let h = video.videoHeight || 480;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          return canvas.toDataURL('image/jpeg', 0.65);
        }
      } catch (err) {
        console.warn('[extractVideoFramesBase64] Frame capture err:', err);
      }
      return '';
    };

    video.onloadedmetadata = () => {
      const dur = video.duration || 3;
      // Extract 3 keyframes across timeline:
      // Frame 1: 0.3s (initial plate/weight view)
      // Frame 2: dur * 0.5 (midpoint / execution)
      // Frame 3: dur - 0.5 (completion / lockout)
      const seekPoints = [
        0.3,
        Math.min(dur * 0.5, Math.max(0.5, dur - 1)),
        Math.max(0.8, dur - 0.5)
      ];

      let currentIndex = 0;

      video.onseeked = () => {
        const frame = captureFrame();
        if (frame) capturedFrames.push(frame);

        currentIndex++;
        if (currentIndex < seekPoints.length && !resolved) {
          video.currentTime = seekPoints[currentIndex];
        } else {
          finish();
        }
      };

      video.currentTime = seekPoints[0];
    };

    video.onerror = () => finish();

    setTimeout(() => {
      if (!resolved) {
        finish();
      }
    }, 3500);
  });
};

export function PowerModule() {
  const { user, refreshUser } = useUser();
  const navigate = useNavigate();

  // Active sub-tab
  const [activeTab, setActiveTab] = useState<'desafios' | 'records' | 'rankings' | 'duels' | 'belts' | 'career' | 'social'>('desafios');
  const [activeExercise, setActiveExercise] = useState<'supino' | 'agachamento' | 'terra'>('supino');

  // Loading and State
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [records, setRecords] = useState<PowerRecord[]>([]);
  const [duels, setDuels] = useState<PowerDuel[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [feedEvents, setFeedEvents] = useState<PowerFeedEvent[]>([]);

  // Selected rival for the interactive career confrontation view
  const [selectedRivalH2HId, setSelectedRivalH2HId] = useState<string>('');

  // Proof Video Preview Modal State
  const [previewVideo, setPreviewVideo] = useState<{ url: string; title?: string } | null>(null);

  // Dedicated Modal for Record Registration Outcome (Acceptance / Refusal with Reasons Summary)
  const [recordResultModal, setRecordResultModal] = useState<{
    isOpen: boolean;
    type: 'APPROVED' | 'REJECTED' | 'MANUAL_REVIEW';
    title: string;
    weight: number;
    exerciseLabel: string;
    confidence: number;
    congratulationsMessage?: string;
    refusalMessage?: string;
    motivos: string[];
    isBeltConquest?: boolean;
    analysis?: string;
  } | null>(null);

  // Form states
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [newWeight, setNewWeight] = useState<number>(0);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [showDuelModal, setShowDuelModal] = useState(false);
  const [selectedRivalId, setSelectedRivalId] = useState<string>('');
  const [duelWeight, setDuelWeight] = useState<number>(0);
  const [duelHours, setDuelHours] = useState<number>(72);
  const [safetyAccepted, setSafetyAccepted] = useState(false);

  // IA simulation progress
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);

  // Active Rival Head-to-Head calculations
  const [rivalStats, setRivalStats] = useState<{wins: number, losses: number, draws: number, commonRival: string} | null>(null);

  // Switch between Local Gym and Global rankings
  const [rankingScope, setRankingScope] = useState<'gym' | 'global'>('gym');

  // Load initial dataset from Firestore or seed them
  useEffect(() => {
    if (!user) return;
    
    let isMounted = true;
    
    const triggerFetch = async () => {
      if (isMounted) {
        await fetchData();
      }
    };

    if (auth.currentUser) {
      triggerFetch();
    } else {
      const unsubscribe = auth.onAuthStateChanged((fbUser) => {
        if (fbUser) {
          triggerFetch();
        }
      });
      return () => {
        isMounted = false;
        unsubscribe();
      };
    }
  }, [user]);

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // 1. Fetch own/all records from Firestore
      const recordsCol = collection(db, 'power_records');
      let recSnap;
      try {
        recSnap = await getDocs(recordsCol);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'power_records');
        return;
      }
      const dbRecs = recSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as PowerRecord));

      // One-time cleanup: remove legacy fake/test records that were never created through the real
      // addDoc() flow (which always yields a random 20-char Firestore auto-id). Any record whose id
      // does not match that pattern (e.g. 'strava_sim_...', 'health_connect_...') is leftover test data.
      const FIRESTORE_AUTO_ID = /^[A-Za-z0-9]{20}$/;
      const fakeRecs = dbRecs.filter(r => !FIRESTORE_AUTO_ID.test(r.id));
      const cleanRecs = dbRecs.filter(r => FIRESTORE_AUTO_ID.test(r.id));
      if (fakeRecs.length > 0) {
        for (const fr of fakeRecs) {
          try { await deleteDoc(doc(db, 'power_records', fr.id)); } catch (e) { handleFirestoreError(e, OperationType.DELETE, `power_records/${fr.id}`); }
        }
      }

      setRecords(cleanRecs);

      // 2. Fetch duels from Firestore
      const duelsCol = collection(db, 'power_duels');
      let duelSnap;
      try {
        duelSnap = await getDocs(duelsCol);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'power_duels');
        return;
      }
      const dbDuels = duelSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as PowerDuel));

      // One-time cleanup: remove legacy fake/seed duels written by a bug that has since been fixed
      // (challenger/defender id 'atleta_carlos' or 'atleta_joao' identifies the old hardcoded test data)
      const FAKE_DUEL_IDS = ['atleta_carlos', 'atleta_joao'];
      const fakeDuels = dbDuels.filter(d => FAKE_DUEL_IDS.includes(d.challengerId) || FAKE_DUEL_IDS.includes(d.defenderId));
      const cleanDuels = dbDuels.filter(d => !FAKE_DUEL_IDS.includes(d.challengerId) && !FAKE_DUEL_IDS.includes(d.defenderId));
      if (fakeDuels.length > 0) {
        for (const fd of fakeDuels) {
          try { await deleteDoc(doc(db, 'power_duels', fd.id)); } catch (e) { handleFirestoreError(e, OperationType.DELETE, `power_duels/${fd.id}`); }
        }
      }

      setDuels(cleanDuels);

      // 3. Fetch list of users from Firestore and merge with static mock list of competitors
      const usersCol = collection(db, 'users');
      let userSnap;
      try {
        userSnap = await getDocs(usersCol);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'users');
        return;
      }
      const userList = userSnap.docs
        .map(doc => ({ uid: doc.id, ...doc.data() } as any))
        .filter(u => u.uid !== user?.uid);
      
      setAllUsers(userList);

      // 4. Fetch feed events from Firestore and merge with static mock feed
      const feedCol = collection(db, 'power_feed_events');
      let feedSnap;
      try {
        feedSnap = await getDocs(feedCol);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'power_feed_events');
        return;
      }
      const feedList = feedSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as PowerFeedEvent));
      
      const finalFeed = [...feedList]
        .sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setFeedEvents(finalFeed);

      } catch (err) {
      console.error('Error fetching power records/duels:', err);
    } finally {
      setLoading(false);
    }
  };

  const seedSampleData = async () => {
    // Left as non-blocking stub as seeding is now handled granularly in fetchData
    console.log('[PowerModule] Seeding handled inline during data fetching.');
  };

  // Helper selectors
  const getPersonalBest = (exercise: 'supino' | 'agachamento' | 'terra'): number => {
    const userRecs = records.filter(r => r.userId === user?.uid && r.exercise === exercise && r.videoStatus === 'approved');
    if (userRecs.length === 0) return 0;
    return Math.max(...userRecs.map(r => r.weight));
  };

  const getRecentEvolution = (exercise: 'supino' | 'agachamento' | 'terra') => {
    // Return all records for user sorted by date
    return records
      .filter(r => r.userId === user?.uid && r.exercise === exercise)
      .sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  };

  // Trava de segurança rule (max 20% above athlete's current record or default baseline limit)
  const calculateMaxAllowedWeight = (currPB: number): number => {
    if (currPB <= 0) return 250;
    return Math.round(currPB * 1.20);
  };

  const handleDeleteRecord = async (recordId?: string) => {
    if (!recordId) return;
    if (!confirm('Deseja realmente excluir este registro de carga? Esta ação não poderá ser desfeita.')) return;
    try {
      await deleteDoc(doc(db, 'power_records', recordId));
      setRecords(prev => prev.filter(r => r.id !== recordId));
      alert('Registro excluído com sucesso.');
      fetchData();
    } catch (err: any) {
      console.error('Error deleting record:', err);
      alert('Erro ao excluir registro: ' + (err.message || 'Erro Firestore'));
    }
  };

  // Actions
  const logSocialEvent = async (
    eventType: 'record' | 'belt_conquest' | 'duel_accepted' | 'duel_completed' | 'top_10_entry' | 'system_alert',
    message: string,
    exercise?: 'supino' | 'agachamento' | 'terra',
    weight?: number
  ) => {
    if (!user) return;
    try {
      try {
        await addDoc(collection(db, 'power_feed_events'), {
          userId: user.uid,
          userName: user.displayName || 'Você',
          eventType,
          message,
          timestamp: new Date().toISOString(),
          exercise: exercise || null,
          weight: weight || null
        });
      } catch (e) {
        handleFirestoreError(e, OperationType.CREATE, 'power_feed_events');
      }
    } catch (err) {
      console.error('Error adding social log:', err);
    }
  };

  const handleAddNewRecord = async () => {
    if (!user) return;

    // 1. VÍDEO OBRIGATÓRIO: É proibido registrar qualquer tentativa sem upload de vídeo.
    if (!videoFile && !videoUrl) {
      alert('Envie um vídeo para validar sua tentativa.');
      return;
    }

    if (newWeight <= 0) {
      alert('Por favor, insira uma carga válida em KG (ex: 80).');
      return;
    }
    if (!safetyAccepted) {
      alert('Você precisa declarar estar ciente dos termos de segurança.');
      return;
    }

    // 2. ANÁLISE OBRIGATÓRIA: Enquanto estiver analisando, não salvar nenhuma informação
    setUpdating(true);
    setAiAnalyzing(true);
    setAiStatus('Validando tentativa...');

    let finalVideoUrl = videoUrl || '';
    let aiRes: {
      isValid: boolean;
      isManualReview?: boolean;
      auditResult?: 'VALIDADO' | 'AUDITORIA_MANUAL' | 'REPROVADO';
      analysis: string;
      confidence: number;
      estimatedWeight?: number;
      motivos?: string[];
      reason?: string;
    } = {
      isValid: false,
      analysis: 'Validando tentativa...',
      confidence: 0
    };

    try {
      if (videoFile) {
        setAiStatus('Validando tentativa... (Auditoria Sequencial de Vídeo Gemini IA)');
        const framesBase64 = await extractVideoFramesBase64(videoFile);
        if (framesBase64 && framesBase64.length > 0) {
          aiRes = await validationService.validatePowerVideo(framesBase64, activeExercise, newWeight);
        } else {
          aiRes = {
            isValid: false,
            isManualReview: true,
            auditResult: 'AUDITORIA_MANUAL',
            confidence: 80,
            analysis: 'STATUS: AUDITORIA_MANUAL\nCONFIANÇA: 80%\nMOTIVOS:\n• Não foi possível extrair os quadros para auditoria de mídia. Encaminhado para revisão manual.',
            motivos: ['Não foi possível extrair os quadros para auditoria de mídia. Encaminhado para revisão manual.']
          };
        }
      } else {
        aiRes = {
          isValid: false,
          isManualReview: true,
          auditResult: 'AUDITORIA_MANUAL',
          confidence: 82,
          analysis: 'STATUS: AUDITORIA_MANUAL\nCONFIANÇA: 82%\nMOTIVOS:\n• Link de vídeo externo enviado. Encaminhado para fila de auditoria manual.',
          motivos: ['Link de vídeo externo enviado. Encaminhado para fila de auditoria manual.']
        };
      }

      const confidenceNum = aiRes.confidence || 0;
      const isApproved = aiRes.isValid && confidenceNum >= 95;
      const isManual = !isApproved && (aiRes.isManualReview || (confidenceNum >= 80 && confidenceNum < 95));
      const isRejected = !isApproved && !isManual;

      // 9. REGRA ABSOLUTA: Se reprovado, NÃO salvar registro, NÃO atualizar ranking, NÃO salvar histórico, NÃO conceder XP
      if (isRejected) {
        // 12. LOG DE AUDITORIA MANDATÓRIO
        try {
          await addDoc(collection(db, 'power_audit_logs'), {
            userId: user.uid,
            userName: user.displayName || user.name || 'Atleta',
            exercise: activeExercise,
            declaredWeight: newWeight,
            estimatedWeight: aiRes.estimatedWeight || newWeight,
            confidence: confidenceNum,
            result: 'REPROVADO',
            motivos: aiRes.motivos || [aiRes.analysis],
            videoUrl: finalVideoUrl,
            timestamp: new Date().toISOString(),
            aiVersion: "Gemini AI Invictus Audit v2.0"
          });
        } catch (e) {
          console.warn('Failed to save audit log:', e);
        }

        setAiAnalyzing(false);
        setAiStatus(null);
        setUpdating(false);

        const exLabel = activeExercise === 'supino' ? 'Supino' : activeExercise === 'agachamento' ? 'Agachamento' : 'Terra';
        const motivosList = (aiRes.motivos && aiRes.motivos.length > 0)
          ? aiRes.motivos
          : [aiRes.analysis || 'Não atendeu aos critérios de validação técnica do movimento ou do ambiente.'];

        const refusalMsg = (aiRes as any).mensagemRecusa || `Sua tentativa de registro de nova marca (${newWeight}kg no ${exLabel}) foi recusada porque não atendeu aos critérios técnicos obrigatórios.`;

        setRecordResultModal({
          isOpen: true,
          type: 'REJECTED',
          title: 'REGISTRO DE MARCA RECUSADO',
          weight: newWeight,
          exerciseLabel: exLabel,
          confidence: confidenceNum,
          refusalMessage: refusalMsg,
          motivos: motivosList,
          analysis: aiRes.analysis
        });
        return;
      }

      // Upload do vídeo se aprovado ou se enviado para auditoria manual
      if (videoFile) {
        setAiStatus('Fazendo upload do vídeo de prova...');
        const storageRef = ref(storage, `power_records/${user.uid}/${Date.now()}_${videoFile.name}`);
        const uploadTask = uploadBytesResumable(storageRef, videoFile);

        const uploadPromise = new Promise<string>((resolve) => {
          let isSettled = false;

          const timer = setTimeout(() => {
            if (!isSettled) {
              isSettled = true;
              console.warn('[PowerModule] Video upload timed out. Using fallback URL.');
              try { uploadTask.cancel(); } catch (e) {}
                        resolve('');
            }
          }, 60000);

          uploadTask.on(
            'state_changed', 
            (snapshot) => {
              if (isSettled) return;
              const progress = (snapshot.bytesTransferred / (snapshot.totalBytes || 1)) * 100;
              setUploadProgress(progress);
              setAiStatus(`Enviando vídeo de prova... ${progress.toFixed(0)}%`);
            }, 
            (error) => {
              if (isSettled) return;
              isSettled = true;
              clearTimeout(timer);
                      resolve('');
            }, 
            async () => {
              if (isSettled) return;
              isSettled = true;
              clearTimeout(timer);
              try {
                const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
                resolve(downloadUrl);
              } catch (err) {
                          resolve('');
              }
            }
          );
        });

        finalVideoUrl = await uploadPromise;
        setUploadProgress(null);
      }

      const finalStatus: 'approved' | 'manual_review' = isApproved ? 'approved' : 'manual_review';

      // 11. REGISTRO APÓS AUDITORIA CONCLUÍDA
      const newRec: PowerRecord = {
        userId: user.uid,
        userName: user.displayName || user.name || 'Você',
        userPhoto: user.photoURL || '',
        gymId: user.gymId || 'gym_default',
        gymName: user.gymName || 'Invictus Central',
        city: user.city || 'São Paulo',
        exercise: activeExercise,
        weight: newWeight,
        date: new Date().toISOString().split('T')[0],
        videoUrl: finalVideoUrl,
        videoStatus: finalStatus,
        userMessage: aiRes.analysis,
        reports: []
      };

      try {
        await addDoc(collection(db, 'power_records'), newRec);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'power_records');
      }

      // 12. LOG DE AUDITORIA MANDATÓRIO
      try {
        await addDoc(collection(db, 'power_audit_logs'), {
          userId: user.uid,
          userName: user.displayName || user.name || 'Atleta',
          exercise: activeExercise,
          declaredWeight: newWeight,
          estimatedWeight: aiRes.estimatedWeight || newWeight,
          confidence: confidenceNum,
          result: isApproved ? 'VALIDADO' : 'AUDITORIA_MANUAL',
          motivos: aiRes.motivos || [aiRes.analysis],
          videoUrl: finalVideoUrl,
          timestamp: new Date().toISOString(),
          aiVersion: "Gemini AI Invictus Audit v2.0"
        });
      } catch (e) {
        console.warn('Failed to save audit log:', e);
      }

      const exLabel = activeExercise === 'supino' ? 'Supino' : activeExercise === 'agachamento' ? 'Agachamento' : 'Terra';

      if (finalStatus === 'approved') {
        await logSocialEvent('record', `homologou um novo recorde oficial de ${newWeight}kg no ${exLabel}! 🏆`, activeExercise, newWeight);
        
        const gymId = user.gymId || 'gym_default';
        const gymRecs = records.filter(r => r.gymId === gymId && r.exercise === activeExercise && r.videoStatus === 'approved');
        const isBetter = gymRecs.every(r => r.userId === user.uid || r.weight < newWeight);
        if (isBetter) {
          await logSocialEvent('belt_conquest', `faturou o Cinturão de Rei do ${exLabel} da academia! 👑`, activeExercise, newWeight);
        }

        const congratulationsMsg = (aiRes as any).mensagemParabens || `🎉 PARABÉNS! NOVA MARCA HOMOLOGADA COM SUCESSO! 🏆\n\nSua nova marca de ${newWeight}kg no ${exLabel} foi validada com ${confidenceNum}% de confiança pela inteligência de auditoria Invictus! Seu recorde oficial e ranking foram atualizados.`;

        setRecordResultModal({
          isOpen: true,
          type: 'APPROVED',
          title: 'PARABÉNS POR SUA NOVA MARCA! 🏆',
          weight: newWeight,
          exerciseLabel: exLabel,
          confidence: confidenceNum,
          congratulationsMessage: congratulationsMsg,
          motivos: aiRes.motivos && aiRes.motivos.length > 0 ? aiRes.motivos : ['Execução e ambiente validados pela inteligência artificial.'],
          isBeltConquest: isBetter,
          analysis: aiRes.analysis
        });
      } else {
        await logSocialEvent('system_alert', `submeteu um levantamento de ${newWeight}kg no ${exLabel} para revisão e auditoria manual. ⏳`, activeExercise, newWeight);

        setRecordResultModal({
          isOpen: true,
          type: 'MANUAL_REVIEW',
          title: 'ENVIADO PARA AUDITORIA MANUAL ⏳',
          weight: newWeight,
          exerciseLabel: exLabel,
          confidence: confidenceNum,
          refusalMessage: `Sua tentativa de ${newWeight}kg no ${exLabel} foi gravada e encaminhada para a fila de revisão técnica dos auditores.`,
          motivos: aiRes.motivos && aiRes.motivos.length > 0 ? aiRes.motivos : ['Vídeo encaminhado para auditoria técnica manual.'],
          analysis: aiRes.analysis
        });
      }

      setShowRecordModal(false);
      setNewWeight(0);
      setVideoFile(null);
      setVideoUrl('');
      setSafetyAccepted(false);
      fetchData();
    } catch (err) {
      console.error('Error in AI audit or record saving:', err);
      alert('Erro ao processar auditoria do levantamento. Por favor, tente novamente.');
    } finally {
      setAiAnalyzing(false);
      setAiStatus(null);
      setUpdating(false);
    }
  };

  const handleProposeDuel = async () => {
    if (!user) return;
    if (!selectedRivalId) {
      alert('Por favor, selecione um atleta rival para desafiar.');
      return;
    }
    if (duelWeight <= 0) {
      alert('Por favor insira um peso do duelo válido.');
      return;
    }
    if (!safetyAccepted) {
      alert('Você precisa declarar concordância técnica com os termos de integridade física antes de enviar.');
      return;
    }

    const rival = allUsers.find(u => u.uid === selectedRivalId);
    if (!rival) return;

    // Check rival's verified record to make sure we do NOT propose something beyond 10% of their capacity!
    // This blocks abusive/harmful bullying spikes.
    const rivalPBRecords = records.filter(r => r.userId === selectedRivalId && r.exercise === activeExercise && r.videoStatus === 'approved');
    const rivalPB = rivalPBRecords.length > 0 ? Math.max(...rivalPBRecords.map(r => r.weight)) : 60;
    const rivalMaxAllowed = calculateMaxAllowedWeight(rivalPB);

    if (duelWeight > rivalMaxAllowed) {
      alert(`DESAFIO BLOQUEADO AUTOMATICAMENTE!\n\nProposta de ${duelWeight}kg está acima do limite seguro recomendado para o atleta ${rival.displayName || 'Rival'} (Limite Máximo: ${rivalMaxAllowed}kg, derivado de 10% sobre o recorde dele de ${rivalPB}kg).\n\nMensagem: "Peso acima do limite seguro para o atleta."`);
      return;
    }

    setUpdating(true);
    try {
      const newDuel: PowerDuel = {
        challengerId: user.uid,
        challengerName: user.displayName || 'Você',
        challengerPhoto: user.photoURL || '',
        defenderId: selectedRivalId,
        defenderName: rival.displayName || 'Rival do Duelo',
        defenderPhoto: rival.photoURL || '',
        exercise: activeExercise,
        weight: duelWeight,
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + duelHours * 3600 * 1000).toISOString()
      };

      try {
        await addDoc(collection(db, 'power_duels'), newDuel);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'power_duels');
      }
      await logSocialEvent('system_alert', `lançou um Desafio de Duelo contra ${rival.displayName || 'atleta'} de ${duelWeight}kg no ${activeExercise === 'supino' ? 'Supino' : activeExercise === 'agachamento' ? 'Agachamento' : 'Terra'}! 🥊`, activeExercise, duelWeight);
      
      alert(`DESAFIO OFICIALIZADO! ${rival.displayName} tem ${duelHours} horas para aceitar sua disputa de ${duelWeight}kg no ${activeExercise}. Prepare as anilhas! 🥊`);
      setShowDuelModal(false);
      setDuelWeight(0);
      fetchData();
    } catch (err) {
      console.error('Error proposing duel:', err);
    } finally {
      setUpdating(false);
    }
  };

  const handleUpdateDuelStatus = async (duelId: string, action: 'accepted' | 'declined' | 'completed' | 'failed', userRole: 'challenger' | 'defender') => {
    setUpdating(true);
    try {
      const matchedDuel = duels.find(d => d.id === duelId);
      if (!matchedDuel) return;

      let updates: Partial<PowerDuel> = {};
      
      if (action === 'accepted') {
        updates.status = 'accepted';
        await logSocialEvent('duel_accepted', `aceitou o duelo de ${matchedDuel.weight}kg no ${matchedDuel.exercise === 'supino' ? 'Supino' : matchedDuel.exercise === 'agachamento' ? 'Agachamento' : 'Terra'} contra ${userRole === 'defender' ? matchedDuel.challengerName : matchedDuel.defenderName}! 🥊`, matchedDuel.exercise, matchedDuel.weight);
        alert('Duelo aceito com louvor! Complete a carga proposta dentro do prazo e envie seu vídeo de evidência no aplicativo.');
      } else if (action === 'declined') {
        updates.status = 'declined';
        alert('Você recusou esta disputa. Priorizar a fadiga regenerativa é a melhor decisão de um fisiculturista consciente.');
      } else if (action === 'completed') {
        if (userRole === 'challenger') {
          updates.challengerStatus = 'completed';
        } else {
          updates.defenderStatus = 'completed';
        }
        
        // Check if both have completed or rule outcome
        const currentChallengerStatus = userRole === 'challenger' ? 'completed' : matchedDuel.challengerStatus;
        const currentDefenderStatus = userRole === 'defender' ? 'completed' : matchedDuel.defenderStatus;

        if (currentChallengerStatus === 'completed' && currentDefenderStatus === 'completed') {
          updates.status = 'completed';
          updates.result = 'draw';
          await logSocialEvent('duel_completed', `empatou o duelo incrível de ${matchedDuel.weight}kg de ${matchedDuel.exercise === 'supino' ? 'Supino' : matchedDuel.exercise === 'agachamento' ? 'Agachamento' : 'Terra'} contra ${userRole === 'defender' ? matchedDuel.challengerName : matchedDuel.defenderName}! 🤝`, matchedDuel.exercise, matchedDuel.weight);
          alert('🔥 AMBOS COMPLETARAM COM SUCESSO! Resultado oficial: EMPATE HEROICO! Ambos validaram sua força monumental!');
        } else if (currentChallengerStatus === 'completed' && currentDefenderStatus === 'failed') {
          updates.status = 'completed';
          updates.result = 'challenger_won';
          await logSocialEvent('duel_completed', `venceu o combate de ${matchedDuel.weight}kg no ${matchedDuel.exercise === 'supino' ? 'Supino' : matchedDuel.exercise === 'agachamento' ? 'Agachamento' : 'Terra'} contra ${matchedDuel.defenderName}! 🏆`, matchedDuel.exercise, matchedDuel.weight);
          alert('🏆 VITÓRIA AUTOMÁTICA! Apenas o proponente solidificou a técnica perfeita de carga!');
        } else if (currentChallengerStatus === 'failed' && currentDefenderStatus === 'completed') {
          updates.status = 'completed';
          updates.result = 'defender_won';
          await logSocialEvent('duel_completed', `defendeu seu posto e venceu ${matchedDuel.challengerName} no ${matchedDuel.exercise === 'supino' ? 'Supino' : matchedDuel.exercise === 'agachamento' ? 'Agachamento' : 'Terra'} com ${matchedDuel.weight}kg! 🏆`, matchedDuel.exercise, matchedDuel.weight);
          alert('🏆 VITÓRIA AUTOMÁTICA! O defensor aguentou a pressão e se sagrou imperador!');
        } else {
          alert('Sua repetição de evidência foi sinalizada como completa! Aguardando retorno final do competidor.');
        }
      } else if (action === 'failed') {
        if (userRole === 'challenger') {
          updates.challengerStatus = 'failed';
        } else {
          updates.defenderStatus = 'failed';
        }

        const currentChallengerStatus = userRole === 'challenger' ? 'failed' : matchedDuel.challengerStatus;
        const currentDefenderStatus = userRole === 'defender' ? 'failed' : matchedDuel.defenderStatus;

        if (currentChallengerStatus === 'failed' && currentDefenderStatus === 'failed') {
          updates.status = 'cancelled';
          updates.result = 'cancelled';
          alert('Nenhum atleta conseguiu completar o levantamento proposto no tempo estipulado. Desafio cancelado.');
        } else if (currentChallengerStatus === 'failed' && currentDefenderStatus === 'completed') {
          updates.status = 'completed';
          updates.result = 'defender_won';
          await logSocialEvent('duel_completed', `defendeu seu posto e venceu ${matchedDuel.challengerName} no ${matchedDuel.exercise === 'supino' ? 'Supino' : matchedDuel.exercise === 'agachamento' ? 'Agachamento' : 'Terra'} com ${matchedDuel.weight}kg! 🏆`, matchedDuel.exercise, matchedDuel.weight);
        } else if (currentChallengerStatus === 'completed' && currentDefenderStatus === 'failed') {
          updates.status = 'completed';
          updates.result = 'challenger_won';
          await logSocialEvent('duel_completed', `venceu o combate de ${matchedDuel.weight}kg no ${matchedDuel.exercise === 'supino' ? 'Supino' : matchedDuel.exercise === 'agachamento' ? 'Agachamento' : 'Terra'} contra ${matchedDuel.defenderName}! 🏆`, matchedDuel.exercise, matchedDuel.weight);
        }
      }

      const duelRef = doc(db, 'power_duels', duelId);
      try {
        await updateDoc(duelRef, updates);
      } catch (e) {
        handleFirestoreError(e, OperationType.UPDATE, `power_duels/${duelId}`);
      }

      fetchData();
    } catch (err) {
      console.error('Error updating duel state:', err);
    } finally {
      setUpdating(false);
    }
  };

  const handleReportVideo = async (recordId: string) => {
    if (!user) return;
    const confirmRep = window.confirm('Declarar denúncia sob suspeita de montagem, ajuda ilegal, ou amplitude falsa? Múltiplas denúncias retiram a carga provisoriamente para auditoria humana.');
    if (!confirmRep) return;

    try {
      const targetRecord = records.find(r => r.id === recordId);
      if (!targetRecord) return;

      const updatedReports = [...(targetRecord.reports || []), user.uid];
      const newStatus = updatedReports.length >= 2 ? 'manual_review' as const : targetRecord.videoStatus;

      const recRef = doc(db, 'power_records', recordId);
      try {
        await updateDoc(recRef, {
          reports: updatedReports,
          videoStatus: newStatus
        });
      } catch (e) {
        handleFirestoreError(e, OperationType.UPDATE, `power_records/${recordId}`);
      }

      alert(updatedReports.length >= 2 
        ? 'A comunidade se organizou e flagrou anomalias. O vídeo foi movido para o patamar de REVISÃO INTERNA MANUAL imediata! 🟡' 
        : 'Sua denúncia foi registrada de forma anônima e assertiva. Obrigado por zelar pelo fair play.'
      );
      fetchData();
    } catch (err) {
      console.error('Error reporting video:', err);
    }
  };

  // Belt computations
  const getBeltHolders = (): BeltHolder[] => {
    // Find absolute highest weight for each exercise
    const exercises: ('supino' | 'agachamento' | 'terra')[] = ['supino', 'agachamento', 'terra'];
    return exercises.map(ex => {
      const filterEx = records.filter(r => r.exercise === ex && r.videoStatus === 'approved');
      if (filterEx.length === 0) {
        return { exercise: ex, userName: 'Sem Detentos', weight: 0, gymName: 'Nenhuma Academia', city: 'São Paulo' };
      }
      const sorted = filterEx.sort((a,b) => b.weight - a.weight);
      const champion = sorted[0];
      return {
        exercise: ex,
        userName: champion.userName,
        weight: champion.weight,
        gymName: champion.gymName,
        city: champion.city
      };
    });
  };

  const beltHolders = getBeltHolders();

  const getDynamicH2HStats = (rivalId: string) => {
    if (!user || !rivalId) return { wins: 0, losses: 0, draws: 0 };
    const finishedDuels = duels.filter(d => 
      d.status === 'completed' && 
      ((d.challengerId === user.uid && d.defenderId === rivalId) || 
       (d.challengerId === rivalId && d.defenderId === user.uid))
    );

    let wins = 0;
    let losses = 0;
    let draws = 0;

    finishedDuels.forEach(d => {
      if (d.result === 'draw') {
        draws++;
      } else if (d.result === 'challenger_won') {
        if (d.challengerId === user.uid) {
          wins++;
        } else {
          losses++;
        }
      } else if (d.result === 'defender_won') {
        if (d.defenderId === user.uid) {
          wins++;
        } else {
          losses++;
        }
      }
    });

    return { wins, losses, draws };
  };

  return (
    <div className="relative min-h-screen bg-background pb-32">
      {/* GLOWING AMBIENT TOP SHADOW */}
      <div className="absolute top-0 inset-x-0 h-96 bg-gradient-to-b from-primary/10 via-transparent to-transparent pointer-events-none" />

      <div className="relative z-10 space-y-6">
        
        {/* HEADER BAR */}
        <div className="flex items-center justify-between">
          <button 
            onClick={() => navigate('/')} 
            className="flex items-center gap-1.5 text-[10px] text-on-surface-variant hover:text-white font-black uppercase tracking-widest bg-surface-container px-3.5 py-2 rounded-2xl border border-white/5 transition-all active:scale-95 cursor-pointer"
          >
            <ChevronLeft size={14} className="text-primary" /> Painel Geral
          </button>
          
          <div className="flex items-center gap-2">
            <span className="bg-gradient-to-r from-[#FF4500] to-primary rounded-full px-3.5 py-1 text-[8.5px] font-black text-white tracking-widest uppercase flex items-center gap-1.5 leading-none shadow-[0_0_15px_rgba(255,69,0,0.30)]">
              <Dumbbell size={11} className="animate-spin" style={{ animationDuration: '4s' }} /> MÓDULO SOCIAL DE FORÇA
            </span>
          </div>
        </div>

        {/* HERO TITLE CONTAINER */}
        <div className="bg-surface-container-low border border-outline-variant/10 rounded-[32px] p-6 relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
            <Trophy size={180} className="text-[#FF4500]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-primary animate-ping shrink-0" />
              <p className="text-[9px] font-black text-primary uppercase tracking-widest leading-none">INVICTUS POWER SYSTEM</p>
            </div>
            <h1 className="font-headline italic font-black text-2xl md:text-4xl text-white uppercase mt-1 leading-none tracking-tight">
              POWER RECORDS & DUELS
            </h1>
            <p className="text-[10px] text-on-surface-variant font-semibold uppercase mt-1">
              Desafio Direto entre Atletas • Competição Limpa de Técnicas e Carga Máxima
            </p>
          </div>

          <div className="bg-surface-container rounded-2xl p-4 border border-white/5 flex flex-wrap items-center justify-between gap-4 w-full md:w-auto">
            <div className="flex gap-4">
              <div>
                <span className="text-[7px] text-on-surface-variant font-black uppercase tracking-wider block">DUELOS CONCLUÍDOS</span>
                <span className="text-2xl font-headline italic font-black text-white leading-none mt-1 block">
                  {duels.filter(d => d.status === 'completed').length}
                </span>
              </div>
              <div className="border-l border-white/5 pl-4">
                <span className="text-[7px] text-on-surface-variant font-black uppercase tracking-wider block">RECORDE SUPINO ATIVO</span>
                <span className="text-2xl font-headline italic font-black text-primary leading-none mt-1 block">
                  {getPersonalBest('supino')}kg
                </span>
              </div>
            </div>

            <button
              onClick={() => {
                setNewWeight(getPersonalBest(activeExercise) + 5 || 60);
                setShowRecordModal(true);
              }}
              className="w-full md:w-auto bg-primary hover:bg-yellow-400 text-black font-headline italic font-black text-xs uppercase tracking-wider px-4 py-3 rounded-2xl transition-all cursor-pointer shadow-lg shadow-primary/20 flex items-center justify-center gap-2 shrink-0 active:scale-95"
            >
              <Plus size={16} /> REGISTRAR NOVA MARCA
            </button>
          </div>
        </div>

        {/* SAFETY WARNING MANDATORY ALERT */}
        <div className="bg-red-500/5 border border-red-500/20 p-4 rounded-3xl flex items-start gap-3">
          <ShieldAlert size={18} className="text-red-500 mt-0.5 shrink-0 animate-bounce" />
          <div className="space-y-1">
            <p className="text-[9px] font-black text-red-500 uppercase tracking-widest leading-none">MANDATO DE INTEGRIDADE FÍSICA INVICTUS</p>
            <p className="text-[10px] text-white font-medium uppercase leading-snug">
              "O INVICTUS não recomenda tentativas de cargas acima da capacidade individual do atleta. Execute os exercícios somente em ambiente adequado, respeitando suas limitações físicas e utilizando supervisão profissional quando necessário."
            </p>
          </div>
        </div>

        {/* TABS SELECTOR */}
        <div className="flex border-b border-white/5 pb-1 gap-1 overflow-x-auto no-scrollbar">
          {([
            { id: 'desafios', label: '🔥 Desafios de Carga', icon: Flame },
            { id: 'records', label: '🏆 Recordes Pessoais', icon: Award },
            { id: 'rankings', label: '📊 Rankings', icon: TrendingUp },
            { id: 'duels', label: '🥊 Duelos', icon: Zap },
            { id: 'belts', label: '👑 Cinturões', icon: Trophy },
            { id: 'career', label: '📈 Carreira & Evolução', icon: Calendar },
            { id: 'social', label: '⚡ Feed Social', icon: Bell }
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                "px-4 py-2.5 font-headline italic font-black text-xs uppercase tracking-wider border-b-2 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 shrink-0",
                activeTab === tab.id 
                  ? "border-primary text-white bg-primary/5" 
                  : "border-transparent text-on-surface-variant hover:text-white"
              )}
            >
              <tab.icon size={13} className={activeTab === tab.id ? "text-primary" : "text-on-surface-variant"} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* LOADING INDICATOR */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <RefreshCw className="animate-spin text-primary" size={32} />
            <p className="text-xs uppercase font-mono text-on-surface-variant">Carregando painel de força...</p>
          </div>
        ) : (
          <div className="space-y-8">
            
            {/* TAB 0: DESAFIOS DE CARGA PROGRESSIVOS */}
            {activeTab === 'desafios' && (
              <div className="space-y-6">
                {/* Exercise Selection */}
                <div className="flex gap-2">
                  {(['supino', 'agachamento', 'terra'] as const).map(ex => (
                    <button
                      key={ex}
                      onClick={() => setActiveExercise(ex)}
                      className={cn(
                        "flex-1 py-3 rounded-2xl font-label text-[10px] font-black uppercase tracking-wider border transition-all cursor-pointer flex items-center justify-center gap-1.5",
                        activeExercise === ex 
                          ? "bg-primary text-black border-primary font-black shadow-lg shadow-primary/20" 
                          : "bg-surface-container border-white/5 text-on-surface-variant hover:text-white"
                      )}
                    >
                      <span>{ex === 'supino' ? '🏋️ Supino' : ex === 'agachamento' ? '🦵 Agachamento' : '⚫ Levantamento Terra'}</span>
                    </button>
                  ))}
                </div>

                {/* Header Stats Summary */}
                {(() => {
                  const currentPR = getPersonalBest(activeExercise);
                  const PROGRESSIVE_TIERS = [40, 60, 80, 100, 120, 140, 160, 180, 200];
                  const nextTarget = PROGRESSIVE_TIERS.find(w => w > currentPR) || currentPR + 20;
                  const completedCount = PROGRESSIVE_TIERS.filter(w => currentPR >= w).length;
                  const exName = activeExercise === 'supino' ? 'Supino Reto' : activeExercise === 'agachamento' ? 'Agachamento Completo' : 'Levantamento Terra';

                  return (
                    <div className="space-y-6">
                      <div className="bg-gradient-to-br from-surface-container-high via-surface-container to-surface-container-low border border-primary/20 p-6 rounded-[28px] relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
                        
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative z-10">
                          <div>
                            <span className="text-[9px] font-mono font-black uppercase text-primary tracking-widest block mb-1">
                              🔥 DESAFIOS PROGRESSIVOS DE FORÇA • {exName.toUpperCase()}
                            </span>
                            <h2 className="text-2xl sm:text-3xl font-headline italic font-black text-white uppercase tracking-tight">
                              Jornada de Evolução
                            </h2>
                            <p className="text-xs text-on-surface-variant mt-1 max-w-xl">
                              Supere metas de carga com execuções homologadas via vídeo. Suba de nível, desbloqueie badges e evolua no ranking global Invictus e da sua academia.
                            </p>
                          </div>

                          <div className="flex items-center gap-3 bg-black/40 backdrop-blur-md px-4 py-3 rounded-2xl border border-white/10 shrink-0">
                            <Trophy className="text-amber-400 shrink-0" size={28} />
                            <div>
                              <span className="text-[8px] font-mono text-on-surface-variant uppercase block">Melhor Marca Pessoal (PR)</span>
                              <span className="text-xl font-headline italic font-black text-white">{currentPR} <span className="text-xs text-primary">KG</span></span>
                            </div>
                          </div>
                        </div>

                        {/* General Progress Bar */}
                        <div className="mt-6 pt-4 border-t border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-4">
                          <div>
                            <span className="text-[8px] font-mono uppercase text-on-surface-variant block">Progresso da Jornada</span>
                            <span className="text-sm font-bold text-white">{completedCount} de {PROGRESSIVE_TIERS.length} Concluídos</span>
                          </div>
                          <div>
                            <span className="text-[8px] font-mono uppercase text-on-surface-variant block">Próxima Meta</span>
                            <span className="text-sm font-bold text-amber-400">{nextTarget} KG</span>
                          </div>
                          <div>
                            <span className="text-[8px] font-mono uppercase text-on-surface-variant block">Status do Algoritmo</span>
                            <span className="text-sm font-bold text-emerald-400">🟢 Homologação IA Ativa</span>
                          </div>
                          <div>
                            <span className="text-[8px] font-mono uppercase text-on-surface-variant block">Categoria</span>
                            <span className="text-sm font-bold text-primary">Power Lift Oficial</span>
                          </div>
                        </div>
                      </div>

                      {/* List of Progressive Challenges */}
                      <div className="space-y-4">
                        <h3 className="text-xs font-mono font-black text-white uppercase tracking-widest flex items-center gap-2">
                          <Zap size={14} className="text-primary" />
                          Desafios de Carga Progressivos ({exName})
                        </h3>

                        <div className="grid grid-cols-1 gap-4">
                          {PROGRESSIVE_TIERS.map((tierWeight) => {
                            const isCompleted = currentPR >= tierWeight;
                            const isNextTarget = tierWeight === nextTarget;
                            const isLocked = currentPR < tierWeight && !isNextTarget;
                            const progressPct = Math.min(100, Math.round((currentPR / tierWeight) * 100));
                            const xpVal = Math.round(tierWeight * 2.5);
                            const coinsVal = Math.round(tierWeight * 1.2);

                            const getBadgeName = (w: number) => {
                              if (w <= 40) return 'Iniciante de Aço (40kg)';
                              if (w <= 60) return 'Força em Ascensão (60kg)';
                              if (w <= 80) return 'Guerreiro do Ferro (80kg)';
                              if (w <= 100) return 'Clube dos 100KG 🏆';
                              if (w <= 120) return 'Esmagador (120kg)';
                              if (w <= 140) return 'Titã do Power Lift (140kg) 👑';
                              return `Lenda Suprema (${w}kg+) ⚡`;
                            };

                            return (
                              <div
                                key={tierWeight}
                                className={cn(
                                  "p-5 rounded-[24px] border transition-all relative overflow-hidden flex flex-col justify-between gap-4",
                                  isCompleted && "bg-emerald-500/5 border-emerald-500/30",
                                  isNextTarget && "bg-amber-500/10 border-amber-500/50 shadow-lg shadow-amber-500/5",
                                  isLocked && "bg-surface-container-low/50 border-white/5 opacity-75"
                                )}
                              >
                                {/* Top Row */}
                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                                  <div className="flex items-center gap-3">
                                    <div className={cn(
                                      "w-12 h-12 rounded-2xl flex items-center justify-center font-headline italic font-black text-lg shrink-0",
                                      isCompleted && "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
                                      isNextTarget && "bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse",
                                      isLocked && "bg-white/5 text-on-surface-variant border border-white/5"
                                    )}>
                                      {tierWeight}kg
                                    </div>

                                    <div>
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <h4 className="font-headline italic font-black text-base text-white uppercase">
                                          Desafio {tierWeight} KG
                                        </h4>
                                        {isCompleted && (
                                          <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider flex items-center gap-1">
                                            <CheckCircle size={10} /> Concluído
                                          </span>
                                        )}
                                        {isNextTarget && (
                                          <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider flex items-center gap-1">
                                            <Flame size={10} /> Desafio Ativo
                                          </span>
                                        )}
                                        {isLocked && (
                                          <span className="bg-white/5 text-on-surface-variant border border-white/10 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider flex items-center gap-1">
                                            <Lock size={10} /> Bloqueado
                                          </span>
                                        )}
                                      </div>
                                      
                                      <p className="text-xs text-on-surface-variant mt-0.5">
                                        <strong>Objetivo:</strong> Executar 1 repetição limpa com {tierWeight} kg no {exName}
                                      </p>
                                    </div>
                                  </div>

                                  {/* Action Button */}
                                  {(isNextTarget || isCompleted) && (
                                    <button
                                      onClick={() => {
                                        setNewWeight(tierWeight);
                                        setShowRecordModal(true);
                                      }}
                                      className={cn(
                                        "px-4 py-2.5 rounded-xl font-headline italic font-black text-xs uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer shrink-0 self-end sm:self-center",
                                        isNextTarget 
                                          ? "bg-amber-400 hover:bg-amber-300 text-black shadow-lg shadow-amber-400/20 active:scale-95" 
                                          : "bg-surface-container-high hover:bg-surface-container-highest text-white border border-white/10"
                                      )}
                                    >
                                      <Video size={14} />
                                      <span>{isCompleted ? 'Nova Marca' : 'Homologar Marca por Vídeo'}</span>
                                    </button>
                                  )}
                                </div>

                                {/* Progress Bar & Details */}
                                <div className="space-y-2 bg-black/30 p-3.5 rounded-xl border border-white/5">
                                  <div className="flex justify-between items-center text-[10px] font-mono">
                                    <span className="text-on-surface-variant font-medium">Progresso de Carga</span>
                                    <span className={cn("font-bold", isCompleted ? "text-emerald-400" : isNextTarget ? "text-amber-400" : "text-on-surface-variant")}>
                                      {Math.min(currentPR, tierWeight)} KG / {tierWeight} KG ({progressPct}%)
                                    </span>
                                  </div>
                                  
                                  <div className="w-full h-2 bg-surface-container rounded-full overflow-hidden">
                                    <div 
                                      className={cn(
                                        "h-full transition-all duration-500 rounded-full",
                                        isCompleted ? "bg-emerald-400" : isNextTarget ? "bg-amber-400" : "bg-white/20"
                                      )}
                                      style={{ width: `${progressPct}%` }}
                                    />
                                  </div>

                                  {/* Detailed Meta Items */}
                                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 text-[9px] font-mono border-t border-white/5">
                                    <div>
                                      <span className="text-on-surface-variant uppercase block">Melhor Marca Pessoal</span>
                                      <span className="text-white font-bold">{currentPR} KG</span>
                                    </div>
                                    <div>
                                      <span className="text-on-surface-variant uppercase block">Próxima Meta</span>
                                      <span className="text-amber-400 font-bold">{nextTarget} KG</span>
                                    </div>
                                    <div>
                                      <span className="text-on-surface-variant uppercase block">Recompensa XP</span>
                                      <span className="text-primary font-bold">+{xpVal} XP</span>
                                    </div>
                                    <div>
                                      <span className="text-on-surface-variant uppercase block">Prêmio em Dinheiro</span>
                                      <span className="text-amber-300 font-bold">+R$ {coinsVal}</span>
                                    </div>
                                    <div className="col-span-2 sm:col-span-1">
                                      <span className="text-on-surface-variant uppercase block">Badge Desbloqueável</span>
                                      <span className="text-white font-bold truncate flex items-center gap-1">
                                        <Award size={10} className="text-amber-400 shrink-0" />
                                        {getBadgeName(tierWeight)}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Evolution Timeline History */}
                      <div className="bg-surface-container-low border border-white/10 rounded-[28px] p-6 space-y-4">
                        <h3 className="text-sm font-headline italic font-black text-white uppercase tracking-wider flex items-center gap-2">
                          <TrendingUp size={16} className="text-primary" />
                          Histórico de Evolução • {exName}
                        </h3>

                        <div className="space-y-2">
                          {getRecentEvolution(activeExercise).length === 0 ? (
                            <p className="text-xs font-mono text-on-surface-variant py-6 text-center">
                              Nenhum registro de evolução homologado ainda para este exercício.
                            </p>
                          ) : (
                            getRecentEvolution(activeExercise).map((ev, idx) => (
                              <div key={idx} className="p-3.5 bg-surface-container rounded-xl border border-white/5 flex items-center justify-between">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-white">{ev.weight} KG</span>
                                    <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[8px] font-black uppercase">
                                      Homologado 🟢
                                    </span>
                                  </div>
                                  <span className="text-[9px] text-on-surface-variant font-mono block mt-0.5">
                                    {ev.date} • {ev.gymName}
                                  </span>
                                </div>

                                {ev.videoUrl && (
                                  <button
                                    type="button"
                                    onClick={() => setPreviewVideo({ 
                                      url: ev.videoUrl, 
                                      title: `Vídeo de Prova • ${ev.exercise ? ev.exercise.toUpperCase() : activeExercise.toUpperCase()} ${ev.weight} KG (${ev.gymName})` 
                                    })}
                                    className="px-3 py-1.5 bg-surface-container-high hover:bg-surface-container-highest text-white text-[10px] font-bold rounded-lg border border-white/10 flex items-center gap-1.5 transition-all cursor-pointer"
                                  >
                                    <Video size={12} /> Ver Gravação
                                  </button>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
            {activeTab === 'records' && (
              <div className="space-y-6">
                
                {/* Exercise choosing subtabs */}
                <div className="flex gap-2">
                  {(['supino', 'agachamento', 'terra'] as const).map(ex => (
                    <button
                      key={ex}
                      onClick={() => setActiveExercise(ex)}
                      className={cn(
                        "flex-1 py-3 rounded-2xl font-label text-[10px] font-black uppercase tracking-wider border transition-all cursor-pointer",
                        activeExercise === ex 
                          ? "bg-primary text-black border-primary font-black" 
                          : "bg-surface-container border-white/5 text-on-surface-variant hover:text-white"
                      )}
                    >
                      {ex === 'supino' ? 'Supino Reto' : ex === 'agachamento' ? 'Agachamento Completo' : 'Levantamento Terra'}
                    </button>
                  ))}
                </div>

                {/* CURRENT BEST STATS */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-surface-container-low border border-outline-variant/10 p-5 rounded-[28px] relative overflow-hidden flex flex-col justify-between">
                    <div>
                      <span className="text-[7.5px] text-on-surface-variant font-black uppercase block">RECORDE PESSOAL ATUAL</span>
                      <span className="text-4xl font-headline italic font-black text-white mt-1 block">
                        {getPersonalBest(activeExercise)} <span className="text-xs text-on-surface-variant font-sans tracking-normal font-medium">KG</span>
                      </span>
                    </div>
                    <div className="mt-4 pt-3 border-t border-white/5 flex justify-between items-center text-[9px] uppercase font-bold">
                      <span className="text-on-surface-variant">Status da IA</span>
                      <span className="text-green-400 flex items-center gap-1">🟢 Verificado Continuamente</span>
                    </div>
                  </div>

                  <div className="bg-surface-container-low border border-outline-variant/10 p-5 rounded-[28px] relative overflow-hidden flex flex-col justify-between">
                    <div>
                      <span className="text-[7.5px] text-on-surface-variant font-black uppercase block">LIMITE MÁXIMO DE SEGURANÇA</span>
                      <span className="text-4xl font-headline italic font-black text-rose-500 mt-1 block">
                        {calculateMaxAllowedWeight(getPersonalBest(activeExercise))} <span className="text-xs text-on-surface-variant font-sans tracking-normal font-medium">KG</span>
                      </span>
                    </div>
                    <p className="text-[8.5px] text-on-surface-variant mt-2 leading-tight uppercase font-medium">
                      Tentativas de levantamentos acima desse limite são barradas para prevenção de rompimentos articulares.
                    </p>
                  </div>
                </div>

                {/* EVOLUTION TIMELINE AND NEW SUBMISSION */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  
                  {/* Past progression */}
                  <div className="bg-surface-container-low border border-outline-variant/10 rounded-[28px] p-5 space-y-4 md:col-span-2">
                    <h3 className="text-sm font-headline italic font-black text-white uppercase tracking-wider">Histórico de Carga e Progresso</h3>
                    
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                      {getRecentEvolution(activeExercise).length === 0 ? (
                        <p className="text-xs uppercase font-mono text-on-surface-variant py-8 text-center">Nenhum recorde registrado nesta modalidade.</p>
                      ) : (
                        getRecentEvolution(activeExercise).reverse().map((rec, idx) => (
                          <div key={idx} className="bg-surface-container p-3 rounded-xl border border-white/5 flex justify-between items-center">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-white">{rec.weight}kg</span>
                                {rec.videoStatus === 'approved' && <span className="bg-green-500/10 text-green-400 border border-green-500/20 text-[7px] font-black px-1.5 py-0.5 rounded uppercase">VALIDADO 🟢</span>}
                                {rec.videoStatus === 'manual_review' && <span className="bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 text-[7px] font-black px-1.5 py-0.5 rounded uppercase">EM REVISÃO 🟡</span>}
                              </div>
                              <p className="text-[8px] text-on-surface-variant uppercase mt-1">Registrado em {rec.date} • {rec.gymName}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {rec.videoUrl && (
                                <button
                                  type="button"
                                  onClick={() => setPreviewVideo({ 
                                    url: rec.videoUrl, 
                                    title: `Vídeo de Prova • ${rec.exercise ? rec.exercise.toUpperCase() : activeExercise.toUpperCase()} ${rec.weight} KG (${rec.gymName})` 
                                  })}
                                  className="bg-surface-container-high hover:text-white p-2 rounded-lg text-xs transition-colors flex items-center gap-1 font-bold text-on-surface-variant cursor-pointer"
                                >
                                  <Video size={12} /> Ver Vídeo
                                </button>
                              )}
                              {rec.userId === user?.uid && rec.id && (
                                <button 
                                  onClick={() => handleDeleteRecord(rec.id)} 
                                  className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 p-2 rounded-lg text-xs transition-colors flex items-center gap-1 font-bold"
                                  title="Excluir este registro"
                                >
                                  <Trash2 size={12} /> Excluir
                                </button>
                              )}
                              {rec.userId !== user?.uid && (
                                <button onClick={() => rec.id && handleReportVideo(rec.id)} className="text-rose-500 hover:text-rose-400 p-2 text-xs font-bold font-mono">
                                  Denunciar 🚩
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Submission box */}
                  <div className="bg-surface-container-low border border-outline-variant/10 rounded-[28px] p-5 flex flex-col justify-between">
                    <div>
                      <h3 className="text-sm font-headline italic font-black text-white uppercase tracking-wider mb-2">Registrar Nova Marca</h3>
                      <p className="text-[9.5px] text-on-surface-variant leading-relaxed mb-4">
                        <strong className="text-primary font-bold">Regra de Vídeo:</strong> O vídeo DEVE abrir mostrando claramente o peso marcado na 1ª anilha e seguir <strong className="text-white font-bold">sem cortes nem edições</strong> até o movimento completo. Se houver mais de uma anilha, exiba a marcação da 1ª e informe (falado no áudio do vídeo ou texto na tela) o peso total combinado das demais.
                      </p>

                      <div className="space-y-3 font-sans">
                        <div>
                          <label className="text-[8px] text-on-surface-variant uppercase font-bold block mb-1">Carga Tentada (KG)</label>
                          <input 
                            type="number" 
                            className="w-full bg-surface-container border border-white/5 h-11 px-3 rounded-xl text-white font-bold"
                            placeholder="Ex: 95"
                            value={newWeight || ''}
                            onChange={(e) => setNewWeight(Number(e.target.value))}
                          />
                        </div>

                        <div>
                          <label className="text-[8px] text-on-surface-variant uppercase font-bold block mb-1">Vídeo do Levantamento (Direto da Galeria)</label>
                          <div className="relative border-2 border-dashed border-white/10 rounded-2xl p-4 bg-surface-container text-center hover:border-primary/50 transition-colors flex flex-col items-center justify-center gap-2 min-h-[120px]">
                            {videoFile ? (
                              <div className="space-y-2 w-full">
                                <div className="flex items-center justify-between bg-surface-container-high px-3 py-2 rounded-xl border border-white/5">
                                  <div className="flex items-center gap-2 truncate text-left">
                                    <Video size={14} className="text-primary shrink-0" />
                                    <div className="truncate">
                                      <p className="text-[10px] font-bold text-white truncate max-w-[130px] sm:max-w-xs">{videoFile.name}</p>
                                      <p className="text-[8px] text-on-surface-variant uppercase font-mono">{(videoFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                                    </div>
                                  </div>
                                  <button 
                                    type="button"
                                    onClick={() => {
                                      setVideoFile(null);
                                      setVideoUrl('');
                                    }}
                                    className="p-1 hover:bg-white/10 rounded-lg text-rose-500 transition-colors cursor-pointer"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                                {videoUrl && (
                                  <div className="rounded-xl overflow-hidden aspect-video bg-black/50 border border-white/5">
                                    <video 
                                      src={videoUrl} 
                                      controls 
                                      playsInline 
                                      webkit-playsinline="true" 
                                      preload="metadata" 
                                      className="w-full h-full object-cover" 
                                    />
                                  </div>
                                )}
                              </div>
                            ) : (
                              <>
                                <input 
                                  type="file" 
                                  accept="video/*" 
                                  className="absolute inset-0 opacity-0 cursor-pointer"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      if (file.size > 120 * 1024 * 1024) {
                                        alert(`O vídeo selecionado é muito grande (${(file.size / (1024 * 1024)).toFixed(0)} MB). Para envio rápido pelo celular, escolha um vídeo de até 80 MB.`);
                                        return;
                                      }
                                      setVideoFile(file);
                                      try {
                                        setVideoUrl(URL.createObjectURL(file));
                                      } catch (err) {
                                        console.warn('Failed to create Object URL:', err);
                                      }
                                    }
                                  }}
                                />
                                <div className="p-2.5 bg-surface-container-high rounded-full border border-white/5">
                                  <Video size={16} className="text-primary" />
                                </div>
                                <p className="text-[10px] font-bold text-white">Toque ou arraste o vídeo do treino</p>
                                <p className="text-[8px] text-on-surface-variant uppercase font-mono">Mídia da Galeria (MP4, MOV, etc.)</p>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="bg-[#FF4500]/5 p-3 rounded-xl border border-[#FF4500]/20 space-y-1">
                          <p className="text-[8px] text-[#FF4500] font-black uppercase tracking-wider">REQUISITOS ADICIONAIS OBRIGATÓRIOS</p>
                          <p className="text-[8px] text-on-surface-variant leading-normal">
                            Sem cortes ou edições, início e fim nítidos das repetições e visibilidade total da barra carregada.
                          </p>
                        </div>

                        <div className="flex items-start gap-2 pt-2">
                          <input 
                            type="checkbox" 
                            id="safetycheck" 
                            className="mt-1"
                            checked={safetyAccepted}
                            onChange={(e) => setSafetyAccepted(e.target.checked)}
                          />
                          <label htmlFor="safetycheck" className="text-[8.5px] text-on-surface-variant leading-tight lowercase">
                            Declaro que executarei com spotter, suporte ou ambiente apto de segurança.
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="pt-4">
                      <button
                        onClick={handleAddNewRecord}
                        disabled={updating || aiAnalyzing}
                        className={cn(
                          "w-full bg-primary hover:bg-yellow-400 text-black font-headline italic font-black text-xs uppercase h-12 rounded-2xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-primary/10",
                          (updating || aiAnalyzing) && "opacity-50 pointer-events-none"
                        )}
                      >
                        {aiAnalyzing ? (
                          <>
                            <RefreshCw className="animate-spin text-black" size={14} />
                            IA PROCESSANDO...
                          </>
                        ) : (
                          <>
                            <Send size={14} /> SOLICITAR HOMOLOGAÇÃO
                          </>
                        )}
                      </button>

                      {aiStatus && (
                        <p className="text-[8.5px] text-yellow-400 font-mono text-center mt-2 animate-pulse leading-tight uppercase font-medium">{aiStatus}</p>
                      )}
                    </div>

                  </div>
                </div>

                {/* DETAILED IA INSTRUCTIONS ACCORDING TO AUDITOR SPEC */}
                <div className="bg-surface-container-low border border-outline-variant/10 rounded-[28px] p-5 space-y-3 mt-4">
                  <h3 className="text-xs font-headline italic font-black text-white uppercase tracking-wider">Como funciona nossa Inteligência Artificial de Auditoria Física?</h3>
                  <p className="text-[9.5px] text-on-surface-variant leading-relaxed uppercase">
                    A rede neural dedicada do INVICTUS faz uma varredura quadro-a-quadro do seu levantamento enviado para corroborar que a marca é autêntica:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-[9px] text-on-surface-variant leading-relaxed font-semibold uppercase">
                    <div className="bg-surface-container p-3 rounded-xl border border-white/5 space-y-1">
                      <span className="text-emerald-400 font-black">1. Presença Humana e Barra</span>
                      <p className="lowercase font-normal">Identificamos o atleta e a barra olímpica nas coordenadas do frame central.</p>
                    </div>
                    <div className="bg-surface-container p-3 rounded-xl border border-white/5 space-y-1">
                      <span className="text-emerald-400 font-black">2. Existência de Anilhas</span>
                      <p className="lowercase font-normal">Processamentos estáticos e dinâmicos de peso validam a dimensão das anilhas.</p>
                    </div>
                    <div className="bg-surface-container p-3 rounded-xl border border-white/5 space-y-1">
                      <span className="text-emerald-400 font-black">3. Detecção de Cortes</span>
                      <p className="lowercase font-normal">Filtros de continuidade temporal anulam submissões adulteradas virtualmente.</p>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* TAB 2: POWER DUELS */}
            {activeTab === 'duels' && (
              <div className="space-y-6">
                
                {/* ACTIVE DUELS BOARD */}
                <div className="bg-surface-container-low border border-outline-variant/10 rounded-[28px] p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                      <h3 className="text-sm font-headline italic font-black text-white uppercase tracking-wider">Disputas e Combates Ativos</h3>
                      <p className="text-[9.5px] text-on-surface-variant uppercase">Verifique e resolva seus confrontos pendentes ou andamentos atuais.</p>
                    </div>
                    
                    <button
                      onClick={() => setShowDuelModal(true)}
                      className="bg-primary hover:bg-yellow-400 text-black font-label text-[9px] font-black uppercase tracking-wider px-4 py-2 rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <Plus size={14} /> DESAFIAR ATLETA
                    </button>
                  </div>

                  {/* DUELS LIST CONTAINER */}
                  <div className="space-y-4 pt-2">
                    {duels.length === 0 ? (
                      <p className="text-xs uppercase font-mono text-on-surface-variant text-center py-12">Nenhum duelo registrado. Desafie um rival!</p>
                    ) : (
                      duels.map((duel, idx) => {
                        const isRequester = duel.challengerId === user?.uid;
                        const isTarget = duel.defenderId === user?.uid;
                        const hasExpired = new Date(duel.expiresAt).getTime() < Date.now();

                        return (
                          <div key={idx} className="bg-surface-container p-4 rounded-3xl border border-white/5 space-y-4 relative overflow-hidden">
                            
                            {/* Top header state */}
                            <div className="flex justify-between items-center pb-2 border-b border-white/5">
                              <span className="text-[8px] font-black text-primary uppercase bg-primary/10 border border-primary/20 rounded-full px-2 py-0.5 font-mono">
                                Exercício: {duel.exercise === 'supino' ? 'Supino' : duel.exercise === 'agachamento' ? 'Agachamento' : 'Terra'}
                              </span>
                              <span className="text-[8px] text-on-surface-variant font-medium">Prazo de Expiração: {new Date(duel.expiresAt).toLocaleDateString('pt-BR')}</span>
                            </div>

                            {/* Center competitors row */}
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-3 text-left">
                                <div className="w-10 h-10 rounded-2xl bg-surface-container-high border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                                  {duel.challengerPhoto ? (
                                    <img src={duel.challengerPhoto} alt="" className="w-full h-full object-cover" />
                                  ) : (
                                    <span className="text-xs font-black text-rose-500 font-headline uppercase">{duel.challengerName.substring(0,2)}</span>
                                  )}
                                </div>
                                <div>
                                  <span className="text-[7px] text-on-surface-variant uppercase font-semibold block">Desafiante</span>
                                  <span className="text-xs font-black text-white">{duel.challengerName}</span>
                                  <span className="text-[8.5px] text-green-400 block font-headline italic">{duel.challengerStatus === 'completed' ? 'CONCLUÍDO ✓' : 'Em Execução'}</span>
                                </div>
                              </div>

                              <div className="text-center bg-background px-4 py-2.5 rounded-2xl border border-white/5 min-w-[80px]">
                                <span className="text-[6.5px] text-on-surface-variant uppercase block">Carga Proposta</span>
                                <span className="text-lg font-headline italic font-black text-primary leading-none mt-1 block">{duel.weight}kg</span>
                              </div>

                              <div className="flex items-center gap-3 text-right">
                                <div>
                                  <span className="text-[7px] text-on-surface-variant uppercase font-semibold block">Desafiado</span>
                                  <span className="text-xs font-black text-white">{duel.defenderName}</span>
                                  <span className="text-[8.5px] text-green-400 block font-headline italic">{duel.defenderStatus === 'completed' ? 'CONCLUÍDO ✓' : 'Em Execução'}</span>
                                </div>
                                <div className="w-10 h-10 rounded-2xl bg-surface-container-high border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                                  {duel.defenderPhoto ? (
                                    <img src={duel.defenderPhoto} alt="" className="w-full h-full object-cover" />
                                  ) : (
                                    <span className="text-xs font-black text-rose-500 font-headline uppercase">{duel.defenderName.substring(0,2)}</span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Bottom CTA Actions based on roles */}
                            <div className="flex items-center justify-between pt-2 border-t border-white/5 text-xs text-on-surface-variant">
                              <div>
                                <span className="text-[8px] uppercase font-bold text-on-surface-variant block">Status do combate</span>
                                <span className="text-[10px] font-black text-white uppercase">{duel.status === 'pending' ? 'AGUARDANDO CONFIRMAÇÃO' : duel.status.toUpperCase()}</span>
                              </div>

                              <div className="flex gap-2">
                                {/* If pending & target athlete is current user, allow accept/decline */}
                                {duel.status === 'pending' && isTarget && (
                                  <>
                                    <button 
                                      onClick={() => duel.id && handleUpdateDuelStatus(duel.id, 'accepted', 'defender')}
                                      className="bg-emerald-500 hover:bg-emerald-400 text-black font-bold px-3 py-1.5 rounded-lg text-[9px] uppercase tracking-wider"
                                    >
                                      Aceitar Combate
                                    </button>
                                    <button 
                                      onClick={() => duel.id && handleUpdateDuelStatus(duel.id, 'declined', 'defender')}
                                      className="bg-red-500/15 hover:bg-red-500/20 text-red-400 border border-red-500/10 font-bold px-3 py-1.5 rounded-lg text-[9px] uppercase tracking-wider"
                                    >
                                      Declinar
                                    </button>
                                  </>
                                )}

                                {/* If accepted and not yet completed by target athlete */}
                                {duel.status === 'accepted' && (
                                  <div className="flex gap-1">
                                    {isRequester && duel.challengerStatus !== 'completed' && (
                                      <button 
                                        onClick={() => duel.id && handleUpdateDuelStatus(duel.id, 'completed', 'challenger')}
                                        className="bg-primary text-black font-bold px-2.5 py-1.5 rounded-lg text-[8.5px] uppercase"
                                      >
                                        Marcar Vídeo Concluído
                                      </button>
                                    )}
                                    {isTarget && duel.defenderStatus !== 'completed' && (
                                      <button 
                                        onClick={() => duel.id && handleUpdateDuelStatus(duel.id, 'completed', 'defender')}
                                        className="bg-primary text-black font-bold px-2.5 py-1.5 rounded-lg text-[8.5px] uppercase"
                                      >
                                        Marcar Vídeo Concluído
                                      </button>
                                    )}
                                  </div>
                                )}

                                {/* Completed display */}
                                {duel.status === 'completed' && (
                                  <span className="text-primary font-bold text-[9px] flex items-center gap-1">
                                    🏆 DISPUTA CONCLUÍDA - VENCEDOR COORDENADO
                                  </span>
                                )}
                              </div>
                            </div>

                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* HISTORICAL RIVALS CONFRONTATION */}
                {rivalStats && (
                  <div className="bg-surface-container-low border border-outline-variant/10 rounded-[28px] p-6 space-y-4">
                    <h3 className="text-sm font-headline italic font-black text-white uppercase tracking-wider">Histórico de Rivalidade Recíproca</h3>
                    <p className="text-[9.5px] text-on-surface-variant uppercase mt-1">Confronte seus resultados contra seu principal rival da modalidade de força.</p>
                    
                    <div className="bg-background/80 p-5 rounded-2xl border border-white/5 flex flex-col sm:flex-row justify-between items-center gap-4">
                      <div className="text-center sm:text-left space-y-1">
                        <span className="text-[7px] text-on-surface-variant uppercase font-bold block">Confronto Líder</span>
                        <p className="text-sm font-black text-white uppercase">VOCÊ VS {rivalStats.commonRival}</p>
                        <p className="text-[8.5px] text-on-surface-variant">Confrontos de supino olímpico acumulados entre academias parceiras.</p>
                      </div>

                      <div className="flex gap-4 font-mono text-center">
                        <div className="bg-surface-container px-4 py-2 rounded-xl border border-white/5">
                          <span className="text-[7px] text-on-surface-variant block">VITÓRIAS</span>
                          <span className="text-base font-black text-primary">{rivalStats.wins}</span>
                        </div>
                        <div className="bg-surface-container px-4 py-2 rounded-xl border border-white/5">
                          <span className="text-[7px] text-on-surface-variant block">DERROTAS</span>
                          <span className="text-base font-black text-rose-500">{rivalStats.losses}</span>
                        </div>
                        <div className="bg-surface-container px-4 py-2 rounded-xl border border-white/5">
                          <span className="text-[7px] text-on-surface-variant block">EMPATES</span>
                          <span className="text-base font-black text-cyan-400">{rivalStats.draws}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            )}

            {/* TAB 3: BELTS / CINTURÕES */}
            {activeTab === 'belts' && (
              <div className="space-y-6">
                
                {/* INSTRUCTION BOX */}
                <div className="bg-surface-container-low border border-outline-variant/10 rounded-[28px] p-6 space-y-2">
                  <h3 className="text-sm font-headline italic font-black text-white uppercase tracking-wider">Mural dos Cinturões Ativos</h3>
                  <p className="text-[9.5px] text-on-surface-variant leading-relaxed uppercase">
                    Os Atletas de mais alto levantamento de cada unidade conquistam simbologia absoluta local. Sem interferência no plano essencial ou prêmios reais, somente relevância máxima.
                  </p>
                </div>

                {/* CHAMPIONS GRID */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {beltHolders.map((belt, idx) => (
                    <div key={idx} className="bg-gradient-to-b from-yellow-500/10 to-surface-container-low border border-yellow-500/20 rounded-[28px] p-6 text-center space-y-4 relative overflow-hidden flex flex-col justify-between">
                      <div className="absolute top-0 right-0 p-3 opacity-10">
                        <Award size={64} className="text-yellow-500" />
                      </div>

                      <div>
                        <span className="bg-yellow-500 text-black text-[8px] font-black uppercase px-2.5 py-0.5 rounded-full inline-block tracking-widest font-mono">
                          👑 REALEZA DO {belt.exercise.toUpperCase()}
                        </span>
                        
                        <h4 className="text-xl font-headline italic font-black text-white uppercase mt-4 block leading-none">
                          {belt.exercise === 'supino' ? 'Rei do Supino' : belt.exercise === 'agachamento' ? 'Rei do Agachamento' : 'Rei do Terra'}
                        </h4>
                        
                        <div className="w-16 h-16 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 flex items-center justify-center mx-auto mt-4 text-3xl font-black font-headline italic">
                          {belt.userName.substring(0,2).toUpperCase()}
                        </div>

                        <p className="text-lg font-headline italic font-black text-yellow-400 mt-4 leading-none">{belt.userName}</p>
                        <p className="text-3xl font-black text-white font-headline italic mt-1.5">{belt.weight || '60'} <span className="text-xs text-on-surface-variant font-sans tracking-normal font-medium">KG</span></p>
                      </div>

                      <div className="bg-surface-container p-3 rounded-2xl border border-white/5 space-y-1 block mt-2 text-left">
                        <span className="text-[6.5px] text-on-surface-variant font-bold uppercase block">Unidade Academia</span>
                        <p className="text-[9.5px] font-black text-white uppercase leading-none">{belt.gymName}</p>
                        <p className="text-[8px] text-on-surface-variant block">{belt.city}</p>
                      </div>

                    </div>
                  ))}
                </div>

              </div>
            )}

            {/* TAB: POWER RANKINGS (EXCLUSIVE PER ACADEMY AND GLOBAL) */}
            {activeTab === 'rankings' && (() => {
              // Calculate rankings dynamically
              let filtered = records.filter(r => r.exercise === activeExercise && r.videoStatus === 'approved');
              
              // Group by userId, keeping only user's highest weight
              const highestByUser: { [userId: string]: PowerRecord } = {};
              filtered.forEach(rec => {
                if (!highestByUser[rec.userId] || highestByUser[rec.userId].weight < rec.weight) {
                  highestByUser[rec.userId] = rec;
                }
              });
              
              let result = Object.values(highestByUser);
              
              const currentGymId = user?.gymId || 'gym_default';
              const currentGymName = user?.gymName || 'Invictus Central';
              
              if (rankingScope === 'gym') {
                result = result.filter(r => r.gymId === currentGymId);
              }
              
              // Sort descending by weight
              const rankedAthletes = result.sort((a, b) => b.weight - a.weight);

              // Suggested Challenges: Search other close athletes to duel safely!
              const userPB = getPersonalBest(activeExercise);
              const MathMaxAllowed = calculateMaxAllowedWeight(userPB);
              const suggestedRivals = rankedAthletes
                .filter(ath => ath.userId !== user?.uid)
                .map(ath => {
                  const diff = ath.weight - userPB;
                  const ratio = Math.abs(diff) / (userPB || 1);
                  return { ...ath, diff, ratio };
                })
                .filter(ath => ath.ratio <= 0.15) // within 15% margin
                .slice(0, 3); // top 3 closest

              return (
                <div className="space-y-6">
                  {/* Selectors */}
                  <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center bg-surface-container-low border border-outline-variant/10 p-5 rounded-[28px]">
                    <div className="space-y-1">
                      <h3 className="text-sm font-headline italic font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                        <TrendingUp size={16} className="text-primary" /> Classificações de Força Permanente
                      </h3>
                      <p className="text-[9px] text-on-surface-variant uppercase">
                        Sua evolução comparada em tempo real com todos os atletas do ecossistema.
                      </p>
                    </div>

                    <div className="flex gap-2 w-full sm:w-auto">
                      <button
                        onClick={() => setRankingScope('gym')}
                        className={cn(
                          "flex-1 sm:flex-initial px-4 py-2 rounded-xl text-[9.5px] font-black uppercase tracking-wider transition-all cursor-pointer",
                          rankingScope === 'gym'
                            ? "bg-primary text-black font-black"
                            : "bg-surface-container text-on-surface-variant hover:text-white border border-white/5"
                        )}
                      >
                        🏫 {currentGymName.substring(0, 15)}...
                      </button>
                      <button
                        onClick={() => setRankingScope('global')}
                        className={cn(
                          "flex-1 sm:flex-initial px-4 py-2 rounded-xl text-[9.5px] font-black uppercase tracking-wider transition-all cursor-pointer",
                          rankingScope === 'global'
                            ? "bg-primary text-black font-black"
                            : "bg-surface-container text-on-surface-variant hover:text-white border border-white/5"
                        )}
                      >
                        🌎 Geral INVICTUS
                      </button>
                    </div>
                  </div>

                  {/* Exercise Filter */}
                  <div className="flex gap-2">
                    {(['supino', 'agachamento', 'terra'] as const).map(ex => (
                      <button
                        key={ex}
                        onClick={() => setActiveExercise(ex)}
                        className={cn(
                          "flex-1 py-3 rounded-2xl font-label text-[10px] font-black uppercase tracking-wider border transition-all cursor-pointer",
                          activeExercise === ex 
                            ? "bg-primary text-black border-primary font-black animate-pulse" 
                            : "bg-surface-container border-white/5 text-on-surface-variant hover:text-white"
                        )}
                      >
                        {ex === 'supino' ? 'Supino Reto' : ex === 'agachamento' ? 'Agachamento' : 'Terra'}
                      </button>
                    ))}
                  </div>

                  {/* RANKINGS BOARD */}
                  <div className="bg-surface-container-low border border-outline-variant/10 rounded-[28px] p-6 space-y-4">
                    <span className="text-[8.5px] text-primary font-black uppercase tracking-wider block">
                      {rankingScope === 'gym' ? 'RANKING DA UNIDADE ATIVA' : 'MURAL GERAL DE LÍDERES DO ECOSSISTEMA'}
                    </span>

                    {rankedAthletes.length === 0 ? (
                      <p className="text-xs uppercase font-mono text-on-surface-variant text-center py-12">
                        Nenhum levantamento homologado nesta modalidade. Seja o primeiro!
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-[10px] uppercase font-sans">
                          <thead>
                            <tr className="border-b border-white/5 text-on-surface-variant font-black tracking-widest text-[8px]">
                              <th className="py-3 px-2">Posição</th>
                              <th className="py-3 px-4">Atleta</th>
                              <th className="py-3 px-4 text-primary text-right">Carga Validada</th>
                              <th className="py-3 px-4">Data</th>
                              <th className="py-3 px-4">Academia</th>
                              <th className="py-3 px-4">Cidade</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rankedAthletes.map((ath, idx) => {
                              const pos = idx + 1;
                              const isPodium = pos <= 3;
                              const isCurrentUser = ath.userId === user?.uid;

                              return (
                                <tr 
                                  key={idx} 
                                  className={cn(
                                    "border-b border-white/5 transition-colors group",
                                    isCurrentUser && "bg-primary/5 border-l-2 border-l-primary",
                                    isPodium && "font-bold"
                                  )}
                                >
                                  <td className="py-4 px-2">
                                    {pos === 1 && <span className="bg-amber-400 text-black px-2 py-0.5 rounded text-[8px] font-black">👑 1º Lugar</span>}
                                    {pos === 2 && <span className="bg-slate-300 text-black px-2 py-0.5 rounded text-[8px] font-black">2º Lugar</span>}
                                    {pos === 3 && <span className="bg-[#cd7f32] text-white px-2 py-0.5 rounded text-[8px] font-black">3º Lugar</span>}
                                    {pos > 3 && <span className="text-on-surface-variant font-mono pl-2">{pos}º</span>}
                                  </td>
                                  <td className="py-4 px-4 flex items-center gap-2 group-hover:text-primary transition-colors">
                                    <div className="w-6 h-6 rounded-full bg-surface-container-high border border-white/5 overflow-hidden flex items-center justify-center shrink-0">
                                      <span className="text-[8px] font-black text-rose-500 font-headline uppercase">{ath.userName.substring(0,2)}</span>
                                    </div>
                                    <span className="text-white group-hover:text-primary transition-colors">{ath.userName}</span>
                                  </td>
                                  <td className="py-4 px-4 text-right font-headline italic font-black text-white text-xs">
                                    {ath.weight} kg
                                  </td>
                                  <td className="py-4 px-4 text-on-surface-variant font-mono text-[9px]">{ath.date}</td>
                                  <td className="py-4 px-4 text-on-surface-variant max-w-[120px] truncate">{ath.gymName}</td>
                                  <td className="py-4 px-4 text-on-surface-variant">{ath.city}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* AUTOMATED SUGGESTED CHALLENGES BOX */}
                  <div className="bg-gradient-to-r from-primary/5 via-transparent to-transparent border border-primary/20 rounded-[28px] p-6 space-y-4">
                    <div className="space-y-1">
                      <span className="text-[7.5px] text-primary font-black uppercase tracking-widest block">Inteligência Competitiva</span>
                      <h4 className="text-sm font-headline italic font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                        <Flame size={16} className="text-primary" /> Oponentes Compatíveis Sugeridos
                      </h4>
                      <p className="text-[9px] text-on-surface-variant leading-snug lowercase">
                        Nossos algoritmos selecionaram atletas cujos recordes validados estão no seu quadrante de força direto (+- 15%). Proponha dUelos seguros hoje mesmo!
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                      {suggestedRivals.length === 0 ? (
                        <div className="col-span-3 bg-surface-container p-4 rounded-xl border border-white/5 text-center">
                          <p className="text-xs uppercase font-mono text-on-surface-variant w-full">Nenhum atleta compatível no momento. Continue evoluindo!</p>
                        </div>
                      ) : (
                        suggestedRivals.map((op, idx) => (
                          <div 
                            key={idx} 
                            className="bg-surface-container p-4 rounded-2xl border border-white/5 flex flex-col justify-between items-stretch gap-3 relative overflow-hidden"
                          >
                            <div className="space-y-1 text-left">
                              <span className="text-[6.5px] text-primary font-bold uppercase block">{op.gymName}</span>
                              <p className="text-xs font-black text-white truncate">{op.userName}</p>
                              <p className="text-[9px] text-on-surface-variant lowercase">
                                Recorde: <strong className="text-white">{op.weight}kg</strong> 
                                ({op.diff > 0 ? `+${op.diff}kg` : `${op.diff}kg`} de você)
                              </p>
                            </div>

                            <button
                              onClick={() => {
                                setSelectedRivalId(op.userId);
                                setDuelWeight(Math.min(userPB + 5, calculateMaxAllowedWeight(op.weight)));
                                setShowDuelModal(true);
                              }}
                              className="w-full bg-primary/10 hover:bg-primary text-primary hover:text-black font-headline italic font-black text-[9px] py-2 rounded-xl transition-all uppercase tracking-wider flex items-center justify-center gap-1 cursor-pointer"
                            >
                              propor duelo <Zap size={10} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                </div>
              );
            })()}

            {/* TAB 5: ATHLETE CAREER & RIVALRIES COMPILATION */}
            {activeTab === 'career' && (() => {
              // Dynamically select H2H stats
              const rival = allUsers.find(u => u.uid === selectedRivalH2HId);
              const { wins, losses, draws } = getDynamicH2HStats(selectedRivalH2HId);

              // Calculate user's best vs selected rival's best across exercises
              const exercises = ['supino', 'agachamento', 'terra'] as const;
              const rivalPB = (ex: 'supino' | 'agachamento' | 'terra'): number => {
                const recs = records.filter(r => r.userId === selectedRivalH2HId && r.exercise === ex && r.videoStatus === 'approved');
                if (recs.length === 0) return 60;
                return Math.max(...recs.map(r => r.weight));
              };

              return (
                <div className="space-y-6">
                  {/* Overview statistics Header */}
                  <div className="bg-surface-container-low border border-outline-variant/10 rounded-[28px] p-6 grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="space-y-1 col-span-1">
                      <span className="text-[7.5px] text-primary font-black uppercase tracking-wider block">Portfólio de Evolução</span>
                      <h3 className="text-sm font-headline italic font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                        <Users size={16} className="text-primary" /> Carreira no Módulo Power
                      </h3>
                      <p className="text-[9px] text-on-surface-variant lowercase">
                        Seu registro consolidado e histórico de disputas.
                      </p>
                    </div>

                    <div className="bg-surface-container p-4 rounded-xl border border-white/5 text-center">
                      <span className="text-[7px] text-on-surface-variant block font-bold">RECORDES HOMOLOGADOS</span>
                      <span className="text-xl font-headline italic font-black text-white block mt-1">
                        {records.filter(r => r.userId === user?.uid && r.videoStatus === 'approved').length}
                      </span>
                    </div>

                    <div className="bg-surface-container p-4 rounded-xl border border-white/5 text-center">
                      <span className="text-[7px] text-on-surface-variant block font-bold">DUELOS REIVINDICADOS</span>
                      <span className="text-xl font-headline italic font-black text-white block mt-1">
                        {duels.filter(d => d.challengerId === user?.uid).length}
                      </span>
                    </div>

                    <div className="bg-surface-container p-4 rounded-xl border border-white/5 text-center">
                      <span className="text-[7px] text-on-surface-variant block font-bold">DUELOS DEFENDIDOS</span>
                      <span className="text-xl font-headline italic font-black text-white block mt-1">
                        {duels.filter(d => d.defenderId === user?.uid).length}
                      </span>
                    </div>
                  </div>

                  {/* Interactive rival selector & confronto direto panel */}
                  <div className="bg-surface-container-low border border-outline-variant/10 rounded-[28px] p-6 space-y-6">
                    <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                      <div className="space-y-1">
                        <h4 className="text-xs font-headline italic font-black text-white uppercase tracking-wider">
                          🥊 Confronto Direto Interativo
                        </h4>
                        <p className="text-[9px] text-on-surface-variant uppercase">
                          Escolha qualquer atleta do ecossistema e contraponha suas valências físicas em tempo real!
                        </p>
                      </div>

                      {/* Select Athlete Dropdown */}
                      <div className="w-full sm:w-64">
                        <select
                          className="w-full bg-surface-container border border-white/5 h-10 px-3 rounded-xl text-white text-xs uppercase"
                          value={selectedRivalH2HId}
                          onChange={(e) => setSelectedRivalH2HId(e.target.value)}
                        >
                          <option value="">Selecione um Atleta...</option>
                          {allUsers.map((ath, idx) => (
                            <option key={idx} value={ath.uid}>
                              {ath.displayName || 'Atleta Anônimo'}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {rival ? (
                      <div className="space-y-6">
                        {/* Summary Duel Record */}
                        <div className="bg-background/80 p-5 rounded-2xl border border-white/5 flex flex-col sm:flex-row justify-between items-center gap-4">
                          <div className="text-left space-y-1">
                            <span className="text-[7.5px] text-primary font-black tracking-widest uppercase block">Registro de Duelos Oficiais</span>
                            <h4 className="text-sm font-headline italic font-black text-white uppercase">VOCÊ VS {rival.displayName || 'Competidor'}</h4>
                            <p className="text-[8.5px] text-on-surface-variant">Confrontos concluídos computados no histórico geral do banco.</p>
                          </div>

                          <div className="flex gap-4 font-mono text-center">
                            <div className="bg-surface-container px-4 py-2 rounded-xl border border-white/5 min-w-[70px]">
                              <span className="text-[6.5px] text-emerald-400 block font-bold">VITÓRIAS</span>
                              <span className="text-base font-black text-emerald-400">{wins}</span>
                            </div>
                            <div className="bg-surface-container px-4 py-2 rounded-xl border border-white/5 min-w-[70px]">
                              <span className="text-[6.5px] text-red-500 block font-bold">DERROTAS</span>
                              <span className="text-base font-black text-red-500">{losses}</span>
                            </div>
                            <div className="bg-surface-container px-4 py-2 rounded-xl border border-white/5 min-w-[70px]">
                              <span className="text-[6.5px] text-cyan-400 block font-bold">EMPATES</span>
                              <span className="text-base font-black text-cyan-400">{draws}</span>
                            </div>
                          </div>
                        </div>

                        {/* Comparative metric rows per exercise */}
                        <div className="space-y-3">
                          <span className="text-[7.5px] text-on-surface-variant font-black tracking-widest uppercase block">
                            Métricas Comparativas Carga Máxima (PB)
                          </span>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {exercises.map((ex) => {
                              const userWeight = getPersonalBest(ex);
                              const rivalWeight = rivalPB(ex);
                              const difference = userWeight - rivalWeight;

                              return (
                                <div key={ex} className="bg-surface-container/60 p-4 rounded-2xl border border-white/5 space-y-3">
                                  <span className="text-[8px] text-primary font-black uppercase tracking-wider block">
                                    {ex === 'supino' ? 'Supino Reto' : ex === 'agachamento' ? 'Agachamento' : 'Terra'}
                                  </span>

                                  <div className="flex justify-between items-center text-xs">
                                    <div className="text-left">
                                      <span className="text-[7px] text-on-surface-variant block uppercase font-medium">Seu PB</span>
                                      <span className="text-base font-headline italic font-black text-white">{userWeight}kg</span>
                                    </div>

                                    <div className="text-center font-bold px-2 py-1 rounded bg-black/50 text-[9px]">
                                      {difference > 0 ? (
                                        <span className="text-emerald-400">+{difference}kg ▲</span>
                                      ) : difference < 0 ? (
                                        <span className="text-rose-500">{difference}kg ▼</span>
                                      ) : (
                                        <span className="text-cyan-400">=</span>
                                      )}
                                    </div>

                                    <div className="text-right">
                                      <span className="text-[7px] text-on-surface-variant block uppercase font-medium">Rival PB</span>
                                      <span className="text-base font-headline italic font-black text-white">{rivalWeight}kg</span>
                                    </div>
                                  </div>

                                  {/* Progress bar visualizer */}
                                  <div className="h-1.5 bg-background rounded-full overflow-hidden flex animate-pulse">
                                    <div 
                                      className="bg-emerald-500 h-full" 
                                      style={{ width: `${(userWeight / (userWeight + rivalWeight || 1)) * 100}%` }}
                                    />
                                    <div 
                                      className="bg-rose-500 h-full" 
                                      style={{ width: `${(rivalWeight / (userWeight + rivalWeight || 1)) * 100}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs uppercase font-mono text-on-surface-variant text-center py-6">
                        Por favor, selecione um atleta no menu acima para expor as estatísticas comparativas!
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* TAB 6: POWER SOCIAL FEED OF FORÇA & BELT CHANGES */}
            {activeTab === 'social' && (
              <div className="space-y-6">
                
                {/* SUBTITLE */}
                <div className="bg-surface-container-low border border-outline-variant/10 rounded-[28px] p-6 space-y-2">
                  <h3 className="text-sm font-headline italic font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Bell size={16} className="text-primary animate-bounce" /> Mural de Ocorrências Ativas do Ecossistema
                  </h3>
                  <p className="text-[9.5px] text-on-surface-variant leading-relaxed uppercase">
                    Fique por dentro das homologações mais recentes, disputas travadas, conquistas de cinturão na sua unidade de treino e incidentes de carga.
                  </p>
                </div>

                {/* EVENTS CONTAINER */}
                <div className="space-y-4">
                  {feedEvents.length === 0 ? (
                    <div className="bg-surface-container-low border border-outline-variant/10 rounded-[28px] p-12 text-center">
                      <p className="text-xs uppercase font-mono text-on-surface-variant">Nenhuma nova publicação na comunidade. Treine e publique para iniciar!</p>
                    </div>
                  ) : (
                    feedEvents.map((ev, idx) => (
                      <div 
                        key={idx} 
                        className="bg-surface-container-low border border-outline-variant/10 rounded-3xl p-5 space-y-3 relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition-all hover:bg-surface-container-high/40"
                      >
                        <div className="flex items-start gap-4">
                          {/* Left Avatar Icon according to type */}
                          <div className={cn(
                            "w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border border-white/5",
                            ev.eventType === 'belt_conquest' && "bg-amber-500/10 text-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)]",
                            ev.eventType === 'record' && "bg-emerald-500/10 text-emerald-400",
                            ev.eventType === 'duel_completed' && "bg-primary/10 text-primary",
                            ev.eventType === 'duel_accepted' && "bg-rose-500/10 text-rose-400",
                            ev.eventType === 'system_alert' && "bg-red-500/10 text-red-500 animate-pulse"
                          )}>
                            {ev.eventType === 'belt_conquest' && <Crown size={18} />}
                            {ev.eventType === 'record' && <Trophy size={18} />}
                            {ev.eventType === 'duel_completed' && <Flame size={18} />}
                            {ev.eventType === 'duel_accepted' && <Zap size={18} />}
                            {ev.eventType === 'system_alert' && <ShieldAlert size={18} />}
                          </div>

                          {/* Event Text */}
                          <div className="space-y-1 text-left uppercase">
                            <div className="flex items-center gap-2">
                              <span className="text-[9.5px] font-black text-white">{ev.userName}</span>
                              <span className="text-[7px] text-on-surface-variant font-mono">{new Date(ev.timestamp).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}</span>
                            </div>
                            <p className="text-xs text-white leading-tight font-headline italic font-bold">
                              {ev.message}
                            </p>
                            {ev.weight && ev.exercise && (
                              <p className="text-[8px] text-on-surface-variant font-black">
                                Exercício: {ev.exercise === 'supino' ? 'Supino' : ev.exercise === 'agachamento' ? 'Agachamento' : 'Terra'} • Carga: <strong className="text-primary">{ev.weight}kg</strong>
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Interactive Supporting (👊 Fist-Bump button) */}
                        <button 
                          onClick={() => alert(`Você manifestou apoio mútuo a ${ev.userName}! A união e competição saudável geram progresso! 👊`)}
                          className="bg-surface-container hover:bg-primary/20 hover:text-white border border-white/5 hover:border-primary/20 rounded-xl px-3.5 py-2 text-[8.5px] font-black text-on-surface-variant uppercase tracking-widest flex items-center gap-1.5 transition-all self-end md:self-auto cursor-pointer"
                        >
                          Apoiar 👊
                        </button>
                      </div>
                    ))
                  )}
                </div>

              </div>
            )}

          </div>
        )}

      </div>

      {/* RECORD HOMOLOGATION MODAL */}
      <AnimatePresence>
        {showRecordModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="relative w-full max-w-lg bg-surface-container-low border border-white/10 rounded-[32px] p-6 shadow-2xl overflow-hidden font-sans my-8"
            >
              <button 
                onClick={() => {
                  setShowRecordModal(false);
                  setVideoFile(null);
                  setVideoUrl('');
                }}
                className="absolute top-4 right-4 text-on-surface-variant hover:text-white transition-colors text-sm font-bold bg-white/5 hover:bg-white/10 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>

              <div className="text-center mb-5">
                <div className="inline-flex items-center gap-1.5 bg-primary/10 border border-primary/20 px-3 py-1 rounded-full text-primary text-[9px] font-mono font-bold uppercase mb-2">
                  <Award size={12} /> INVICTUS POWER SYSTEM
                </div>
                <h3 className="font-headline italic font-black text-2xl text-white uppercase leading-none">
                  REGISTRAR NOVA MARCA
                </h3>
                <p className="text-[10px] text-on-surface-variant uppercase tracking-wider mt-1 font-semibold">
                  Homologação Oficial de Levantamento de Carga
                </p>
              </div>

              <div className="space-y-4">
                {/* Exercise Selector */}
                <div>
                  <label className="text-[9px] text-on-surface-variant font-bold uppercase block mb-1.5">1. Modalidade de Exercício</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['supino', 'agachamento', 'terra'] as const).map(ex => (
                      <button
                        key={ex}
                        type="button"
                        onClick={() => setActiveExercise(ex)}
                        className={cn(
                          "py-2.5 rounded-xl font-headline italic font-black text-xs uppercase border transition-all cursor-pointer flex items-center justify-center gap-1",
                          activeExercise === ex 
                            ? "bg-primary text-black border-primary shadow-md shadow-primary/20" 
                            : "bg-surface-container border-white/5 text-on-surface-variant hover:text-white"
                        )}
                      >
                        {ex === 'supino' ? 'Supino' : ex === 'agachamento' ? 'Agachamento' : 'Terra'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Weight Input & Presets */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-[9px] text-on-surface-variant font-bold uppercase">2. Carga Tentada (KG)</label>
                    <span className="text-[9px] font-mono text-primary">Recorde Atual: {getPersonalBest(activeExercise)} kg</span>
                  </div>
                  
                  <div className="relative">
                    <input 
                      type="number" 
                      className="w-full bg-surface-container border border-white/10 h-12 px-4 rounded-xl text-white font-headline italic font-black text-xl placeholder:text-white/20 focus:border-primary focus:outline-none"
                      placeholder="Ex: 100"
                      value={newWeight || ''}
                      onChange={(e) => setNewWeight(Number(e.target.value))}
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-mono font-bold text-on-surface-variant">KG</span>
                  </div>

                  {/* Preset Buttons */}
                  <div className="flex items-center gap-1.5 mt-2 overflow-x-auto no-scrollbar pb-1">
                    <span className="text-[8px] font-mono uppercase text-on-surface-variant shrink-0">Atalhos:</span>
                    {[40, 60, 80, 100, 120, 140, 160, 180, 200].map(w => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => setNewWeight(w)}
                        className={cn(
                          "px-2.5 py-1 rounded-lg text-[9px] font-mono font-bold border transition-all shrink-0 cursor-pointer",
                          newWeight === w ? "bg-primary text-black border-primary" : "bg-surface-container border-white/5 text-on-surface-variant hover:text-white"
                        )}
                      >
                        {w}kg
                      </button>
                    ))}
                  </div>
                </div>

                {/* Protocol Notice Box */}
                <div className="bg-amber-950/30 border border-amber-500/30 rounded-2xl p-3.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="p-1 bg-amber-500/20 text-amber-400 rounded-lg">
                      <ShieldAlert size={14} />
                    </div>
                    <span className="text-[10px] font-headline italic font-black uppercase text-amber-400 tracking-wide">
                      Protocolo de Gravação Obrigatório
                    </span>
                  </div>
                  <ul className="text-[9px] text-amber-100/90 space-y-1 pl-1 list-disc list-inside leading-snug font-medium">
                    <li><strong>Início do Vídeo:</strong> Enquadre o peso gravado na 1ª anilha no início do vídeo.</li>
                    <li><strong>Múltiplas Anilhas:</strong> Se houver várias anilhas, mostre a 1ª e informe o total.</li>
                    <li><strong>Sem Cortes:</strong> Grave de forma contínua do peso até o final do levantamento.</li>
                  </ul>
                </div>

                {/* Video Upload Input */}
                <div>
                  <label className="text-[9px] text-on-surface-variant font-bold uppercase block mb-1.5">
                    3. Vídeo do Levantamento <span className="text-red-400 font-bold uppercase">(Obrigatório para Validação IA)</span>
                  </label>
                  
                  <div className="relative border-2 border-dashed border-white/10 rounded-2xl p-4 bg-surface-container text-center hover:border-primary/50 transition-colors flex flex-col items-center justify-center gap-2 min-h-[110px]">
                    {videoFile ? (
                      <div className="space-y-2 w-full">
                        <div className="flex items-center justify-between bg-surface-container-high px-3 py-2 rounded-xl border border-white/5">
                          <div className="flex items-center gap-2 truncate text-left">
                            <Video size={16} className="text-primary shrink-0" />
                            <div className="truncate">
                              <p className="text-[10px] font-bold text-white truncate max-w-[180px] sm:max-w-xs">{videoFile.name}</p>
                              <p className="text-[8px] text-on-surface-variant font-mono">{(videoFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                            </div>
                          </div>
                          <button 
                            type="button"
                            onClick={() => {
                              setVideoFile(null);
                              setVideoUrl('');
                            }}
                            className="p-1 hover:bg-white/10 rounded-lg text-rose-500 transition-colors cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        {videoUrl && (
                          <div className="rounded-xl overflow-hidden aspect-video bg-black/50 border border-white/5 max-h-[140px]">
                            <video 
                              src={videoUrl} 
                              controls 
                              playsInline 
                              webkit-playsinline="true" 
                              preload="metadata" 
                              className="w-full h-full object-cover" 
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <input 
                          type="file" 
                          accept="video/*" 
                          className="absolute inset-0 opacity-0 cursor-pointer z-10"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              if (file.size > 120 * 1024 * 1024) {
                                alert(`O vídeo selecionado é muito grande (${(file.size / (1024 * 1024)).toFixed(0)} MB). Escolha um vídeo de até 80 MB.`);
                                return;
                              }
                              setVideoFile(file);
                              try {
                                setVideoUrl(URL.createObjectURL(file));
                              } catch (err) {
                                console.warn('Failed to create Object URL:', err);
                              }
                            }
                          }}
                        />
                        <div className="p-2.5 bg-surface-container-high rounded-full border border-white/5">
                          <Video size={18} className="text-primary" />
                        </div>
                        <p className="text-[10px] font-bold text-white">Toque ou selecione o vídeo da galeria</p>
                        <p className="text-[8px] text-on-surface-variant font-mono uppercase">Anexe para validação por Inteligência Artificial</p>
                      </>
                    )}
                  </div>
                </div>

                {/* Safety Checkbox */}
                <div className="flex items-start gap-2.5 pt-2 border-t border-white/5">
                  <input 
                    type="checkbox" 
                    id="modalSafetycheck" 
                    className="mt-0.5 accent-primary cursor-pointer w-4 h-4 rounded"
                    checked={safetyAccepted}
                    onChange={(e) => setSafetyAccepted(e.target.checked)}
                  />
                  <label htmlFor="modalSafetycheck" className="text-[9px] text-on-surface-variant leading-snug cursor-pointer select-none">
                    Declaro estar executando em ambiente seguro, com suporte adequado e responsabilidade técnica.
                  </label>
                </div>

                {/* Submit Button */}
                <button
                  type="button"
                  onClick={handleAddNewRecord}
                  disabled={updating || aiAnalyzing}
                  className={cn(
                    "w-full bg-primary hover:bg-yellow-400 text-black font-headline italic font-black text-xs uppercase h-12 rounded-2xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-primary/20 mt-2",
                    (updating || aiAnalyzing) && "opacity-50 pointer-events-none"
                  )}
                >
                  {aiAnalyzing ? (
                    <>
                      <RefreshCw className="animate-spin text-black" size={16} />
                      IA PROCESSANDO REGISTRO...
                    </>
                  ) : (
                    <>
                      <Send size={16} /> REGISTRAR E HOMOLOGAR MARCA
                    </>
                  )}
                </button>

                {aiStatus && (
                  <p className="text-[8.5px] text-yellow-400 font-mono text-center mt-2 animate-pulse leading-tight uppercase font-medium">
                    {aiStatus}
                  </p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DISPATCH NEW CHALLENGE DUEL PROPOSAL MODAL */}
      <AnimatePresence>
        {showDuelModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
          >
            <motion.div 
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="relative w-full max-w-md bg-surface-container-low border border-white/10 rounded-[32px] p-6 shadow-2xl overflow-hidden font-sans"
            >
              <button 
                onClick={() => setShowDuelModal(false)}
                className="absolute top-4 right-4 text-on-surface-variant hover:text-white transition-colors text-sm font-bold bg-white/5 hover:bg-white/10 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
              <div className="text-center mb-6">
                <h3 className="font-headline italic font-black text-xl text-white uppercase leading-none">
                  DESAFIAR RIVAL DIRETO
                </h3>
                <p className="text-[9px] text-on-surface-variant uppercase tracking-widest mt-1">PROPOSTA DE CARGA RIGOROSA</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[8.5px] text-on-surface-variant font-bold uppercase block mb-1">Escolha o Exercício</label>
                  <select 
                    className="w-full bg-surface-container border border-white/5 h-11 px-3 rounded-xl text-white text-xs"
                    value={activeExercise}
                    onChange={(e) => setActiveExercise(e.target.value as any)}
                  >
                    <option value="supino">Supino Reto</option>
                    <option value="agachamento">Agachamento</option>
                    <option value="terra">Levantamento Terra</option>
                  </select>
                </div>

                <div>
                  <label className="text-[8.5px] text-on-surface-variant font-bold uppercase block mb-1 font-sans">Selecione o Atleta</label>
                  <select 
                    className="w-full bg-surface-container border border-white/5 h-11 px-3 rounded-xl text-white text-xs"
                    value={selectedRivalId}
                    onChange={(e) => setSelectedRivalId(e.target.value)}
                  >
                    <option value="">Selecione um rival...</option>
                    {allUsers.map((u, idx) => (
                      <option key={idx} value={u.uid}>{u.displayName || 'Atleta Anônimo'} ({u.gymName || 'Invictus Central'})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[8.5px] text-on-surface-variant font-bold uppercase block mb-1 font-sans">Carga Proposta (KG)</label>
                  <input 
                    type="number" 
                    className="w-full bg-surface-container border border-white/5 h-11 px-3 rounded-xl text-white font-bold"
                    placeholder="Ex: 100"
                    value={duelWeight || ''}
                    onChange={(e) => setDuelWeight(Number(e.target.value))}
                  />
                  <p className="text-[8px] text-on-surface-variant uppercase mt-1">Limite do rival: até 10% do recorde atual dele.</p>
                </div>

                <div>
                  <label className="text-[8.5px] text-on-surface-variant font-bold uppercase block mb-1 font-sans">Prazo de Resolução</label>
                  <select 
                    className="w-full bg-surface-container border border-white/5 h-11 px-3 rounded-xl text-white text-xs font-medium"
                    value={duelHours}
                    onChange={(e) => setDuelHours(Number(e.target.value))}
                  >
                    <option value={72}>72 Horas (Recomendado)</option>
                    <option value={48}>48 Horas</option>
                    <option value={24}>24 Horas (Express)</option>
                  </select>
                </div>

                <div className="flex items-start gap-2 pt-2 border-t border-white/5">
                  <input 
                    type="checkbox" 
                    id="duelcheck" 
                    className="mt-1"
                    checked={safetyAccepted}
                    onChange={(e) => setSafetyAccepted(e.target.checked)}
                  />
                  <label htmlFor="duelcheck" className="text-[8.5px] text-on-surface-variant leading-tight font-sans font-medium">
                    Declaro que esta carga estimula o fair play e está em conformidade com as regras de Spotter do INVICTUS.
                  </label>
                </div>

                <button
                  onClick={handleProposeDuel}
                  disabled={updating}
                  className="w-full bg-primary hover:bg-yellow-400 text-black font-headline italic font-black text-xs uppercase h-12 rounded-2xl transition-all cursor-pointer mt-2"
                >
                  {updating ? 'ENVIANDO DESAFIO EM ANDAMENTO...' : 'LANÇAR DESAFIO DIRETO 🥊'}
                </button>
              </div>

            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* In-App Proof Video Player Modal */}
      <AnimatePresence>
        {previewVideo && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 backdrop-blur-md z-[100] flex items-center justify-center p-4 sm:p-6"
            onClick={() => setPreviewVideo(null)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface border border-white/10 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col"
            >
              <div className="p-4 bg-surface-container flex items-center justify-between border-b border-white/10">
                <div className="flex items-center gap-2">
                  <Video className="text-primary" size={18} />
                  <span className="text-xs font-black uppercase text-white tracking-wide font-headline italic">
                    {previewVideo.title || 'Vídeo de Prova • Auditoria Invictus'}
                  </span>
                </div>
                <button 
                  onClick={() => setPreviewVideo(null)}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="bg-black flex items-center justify-center aspect-video w-full max-h-[70vh]">
                <video 
                  src={previewVideo.url} 
                  controls 
                  autoPlay 
                  playsInline
                  className="w-full h-full object-contain"
                >
                  Seu navegador não suporta a reprodução deste vídeo.
                </video>
              </div>

              <div className="p-3.5 bg-surface-container-high/50 flex items-center justify-between text-[10px] text-on-surface-variant font-mono">
                <span>🔒 Prova Homologada pelo Invictus Power System</span>
                <button 
                  onClick={() => setPreviewVideo(null)}
                  className="text-primary font-bold hover:underline cursor-pointer"
                >
                  Fechar Vídeo
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* RECORD REGISTRATION AUDIT RESULT MODAL (PARABÉNS OU RECUSA COM RESUMO DOS MOTIVOS) */}
      <AnimatePresence>
        {recordResultModal && recordResultModal.isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/95 backdrop-blur-xl z-[120] flex items-center justify-center p-4 sm:p-6"
            onClick={() => setRecordResultModal(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "w-full max-w-lg bg-surface border rounded-[32px] overflow-hidden shadow-2xl flex flex-col relative",
                recordResultModal.type === 'APPROVED' ? "border-emerald-500/40 shadow-emerald-500/10" :
                recordResultModal.type === 'REJECTED' ? "border-rose-500/40 shadow-rose-500/10" :
                "border-amber-500/40 shadow-amber-500/10"
              )}
            >
              {/* Top Banner Header */}
              <div className={cn(
                "p-6 text-center border-b flex flex-col items-center gap-3 relative overflow-hidden",
                recordResultModal.type === 'APPROVED' ? "bg-gradient-to-b from-emerald-500/20 via-emerald-950/40 to-surface border-emerald-500/20" :
                recordResultModal.type === 'REJECTED' ? "bg-gradient-to-b from-rose-500/20 via-rose-950/40 to-surface border-rose-500/20" :
                "bg-gradient-to-b from-amber-500/20 via-amber-950/40 to-surface border-amber-500/20"
              )}>
                <button
                  onClick={() => setRecordResultModal(null)}
                  className="absolute top-4 right-4 p-2 text-on-surface-variant hover:text-white rounded-full bg-white/5 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>

                <div className={cn(
                  "w-16 h-16 rounded-full flex items-center justify-center border-2 shadow-xl",
                  recordResultModal.type === 'APPROVED' ? "bg-emerald-500/20 border-emerald-400 text-emerald-400" :
                  recordResultModal.type === 'REJECTED' ? "bg-rose-500/20 border-rose-400 text-rose-400" :
                  "bg-amber-500/20 border-amber-400 text-amber-400"
                )}>
                  {recordResultModal.type === 'APPROVED' ? <Trophy size={32} /> :
                   recordResultModal.type === 'REJECTED' ? <AlertOctagon size={32} /> :
                   <ShieldAlert size={32} />}
                </div>

                <div className="space-y-1 text-center">
                  <span className={cn(
                    "text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full border inline-block font-mono",
                    recordResultModal.type === 'APPROVED' ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300" :
                    recordResultModal.type === 'REJECTED' ? "bg-rose-500/20 border-rose-500/40 text-rose-300" :
                    "bg-amber-500/20 border-amber-500/40 text-amber-300"
                  )}>
                    {recordResultModal.type === 'APPROVED' ? 'HOMOLOGADO COM ÉXITO' :
                     recordResultModal.type === 'REJECTED' ? 'REGISTRO DE MARCA RECUSADO' :
                     'AUDITORIA MANUAL PENDENTE'}
                  </span>
                  <h3 className="text-xl font-headline italic font-black text-white uppercase tracking-tight">
                    {recordResultModal.title}
                  </h3>
                </div>
              </div>

              {/* Main Body */}
              <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto font-sans">
                {/* Weight & Exercise Banner */}
                <div className="bg-surface-container-high border border-white/5 rounded-2xl p-4 flex items-center justify-between">
                  <div>
                    <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest block">Exercício & Modalidade</span>
                    <span className="text-sm font-headline italic font-black text-white uppercase">{recordResultModal.exerciseLabel}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest block">Nova Carga Tentada</span>
                    <span className="text-2xl font-headline italic font-black text-primary">{recordResultModal.weight} KG</span>
                  </div>
                </div>

                {/* APPROVED: Congratulations Box */}
                {recordResultModal.type === 'APPROVED' && (
                  <div className="space-y-4">
                    <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-2xl p-4 space-y-2">
                      <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs uppercase tracking-wide">
                        <Sparkles size={16} />
                        <span>Mensagem de Parabéns por Nova Marca</span>
                      </div>
                      <p className="text-xs text-emerald-100 leading-relaxed font-medium">
                        {recordResultModal.congratulationsMessage}
                      </p>
                    </div>

                    {recordResultModal.isBeltConquest && (
                      <div className="bg-gradient-to-r from-amber-500/20 to-yellow-500/10 border border-amber-500/40 rounded-2xl p-4 flex items-center gap-3">
                        <Crown className="text-amber-400 shrink-0" size={28} />
                        <div>
                          <p className="text-xs font-black text-amber-300 uppercase italic font-headline">CINTURÃO CONQUISTADO! 👑</p>
                          <p className="text-[10px] text-amber-200/80 font-medium">Você acaba de assumir o 1º lugar do {recordResultModal.exerciseLabel} da sua academia!</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* REJECTED: Refusal Message & Summary of Reasons */}
                {recordResultModal.type === 'REJECTED' && (
                  <div className="space-y-4">
                    <div className="bg-rose-950/40 border border-rose-500/30 rounded-2xl p-4 space-y-2">
                      <div className="flex items-center gap-2 text-rose-400 font-bold text-xs uppercase tracking-wide">
                        <AlertOctagon size={16} />
                        <span>Notificação de Indeferimento do Registro</span>
                      </div>
                      <p className="text-xs text-rose-100 leading-relaxed font-medium">
                        {recordResultModal.refusalMessage}
                      </p>
                    </div>

                    {/* Resumo dos Motivos da Recusa */}
                    <div className="space-y-2">
                      <h4 className="text-[10px] font-mono text-rose-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                        <ShieldAlert size={14} />
                        Resumo dos Motivos da Recusa:
                      </h4>
                      <div className="space-y-2">
                        {recordResultModal.motivos.map((motive, idx) => (
                          <div key={idx} className="bg-rose-950/30 border border-rose-500/20 rounded-xl p-3 flex items-start gap-2.5">
                            <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0 mt-1.5" />
                            <p className="text-[11px] text-rose-200 leading-normal font-medium">{motive}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Dicas para Próxima Submissão */}
                    <div className="bg-surface-container border border-white/5 rounded-2xl p-4 space-y-1.5">
                      <p className="text-[9px] font-bold text-primary uppercase tracking-wider">💡 Dicas para Homologação de Sucesso:</p>
                      <ul className="text-[10px] text-on-surface-variant space-y-1 list-disc list-inside leading-relaxed">
                        <li><strong>Exiba a 1ª anilha no início:</strong> O vídeo DEVE abrir mostrando claramente o peso marcado na 1ª anilha.</li>
                        <li><strong>Mais de 1 anilha:</strong> Mostre o peso da 1ª anilha e informe (falado no áudio ou por texto na tela) o total combinado das demais.</li>
                        <li><strong>Sem cortes ou edições:</strong> Grave de forma 100% contínua desde a exibição do peso até o movimento completo.</li>
                        <li><strong>Ambiente de academia:</strong> Grave em ambiente iluminado e visível de academia real.</li>
                        <li><strong>Execução biomecânica:</strong> Movimento completo com lockout (Supino: barra toca peito; Agachamento: quadril abaixo dos joelhos; Terra: extensão total).</li>
                      </ul>
                    </div>
                  </div>
                )}

                {/* MANUAL REVIEW */}
                {recordResultModal.type === 'MANUAL_REVIEW' && (
                  <div className="space-y-4">
                    <div className="bg-amber-950/40 border border-amber-500/30 rounded-2xl p-4 space-y-2">
                      <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wide">
                        <ShieldAlert size={16} />
                        <span>Notificação de Auditoria Manual</span>
                      </div>
                      <p className="text-xs text-amber-100 leading-relaxed font-medium">
                        Sua marca de {recordResultModal.weight}kg no {recordResultModal.exerciseLabel} foi submetida e aguarda revisão final da equipe técnica.
                      </p>
                    </div>

                    {/* Resumo dos Motivos de Envio para Revisão */}
                    <div className="space-y-2">
                      <h4 className="text-[10px] font-mono text-amber-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                        <HelpCircle size={14} />
                        Motivos do Encaminhamento para Revisão:
                      </h4>
                      <div className="space-y-2">
                        {recordResultModal.motivos.map((motive, idx) => (
                          <div key={idx} className="bg-amber-950/30 border border-amber-500/20 rounded-xl p-3 flex items-start gap-2.5">
                            <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0 mt-1.5" />
                            <p className="text-[11px] text-amber-200 leading-normal font-medium">{motive}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer CTA */}
              <div className="p-4 bg-surface-container border-t border-white/5">
                <button
                  onClick={() => setRecordResultModal(null)}
                  className={cn(
                    "w-full h-12 rounded-xl font-headline italic font-black text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg",
                    recordResultModal.type === 'APPROVED' ? "bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-500/20" :
                    recordResultModal.type === 'REJECTED' ? "bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20" :
                    "bg-amber-500 hover:bg-amber-400 text-black shadow-amber-500/20"
                  )}
                >
                  Entendido & Continuar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
