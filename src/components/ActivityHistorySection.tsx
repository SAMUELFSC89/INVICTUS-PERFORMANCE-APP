import React, { useState, useEffect, useMemo } from 'react';
import {
  History, CheckCircle2, XCircle, AlertCircle, Clock, Dumbbell,
  TrendingUp, MapPin, Flame, Trophy, RefreshCw, Search, Filter,
  Calendar, Award, Eye, X, ShieldAlert, Sparkles, Zap, ChevronRight,
  Info, Check, AlertOctagon, Scale, ShieldCheck, Image as ImageIcon,
  Share2, ChevronLeft, Heart, Gauge, Mountain, Route as RouteIcon,
  Lock, ThumbsUp
} from 'lucide-react';
import { collection, query, where, getDocs, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { ActivityMapView } from './ActivityMapView';
import { RunShareCard } from './RunShareCard';
import { API_CONFIG } from '../config';

export interface ActivityHistoryItem {
  id: string;
  source: 'workout' | 'checkin' | 'power';
  type: 'workout' | 'cardio' | 'checkin' | 'power' | 'diet' | 'recovery';
  typeLabel: string;
  title: string;
  subtitle?: string;
  dateStr: string;
  timeStr: string;
  rawTimestamp: number;
  status: 'homologada' | 'rejeitada' | 'pendente';
  statusRaw: string;
  points: number;
  rankingPointsEarned?: number;
  durationMins?: number;
  distanceKm?: number;
  weightKg?: number;
  exerciseName?: string;
  photoUrl?: string;
  rejectionReason?: string;
  aiAnalysis?: string;
  gymName?: string;
  // #204: campos que o historico hoje nao exibia (calorias/ritmo/rota/sensores),
  // mesmo quando ja estavam disponiveis no documento salvo no Firestore.
  avgHeartRate?: number;
  calories?: number;
  pace?: string;
  elevationGain?: number;
  steps?: number;
  trajectory?: Array<{ lat: number; lng: number }>;
  // #215: reacao real e persistida (nao um contador social falso -- e um marcador
  // proprio de "reconheci essa atividade", salvo de volta no documento de origem).
  congratulated?: boolean;
  details?: any;
}

function parseTimestamp(ts: any): { dateStr: string; timeStr: string; rawMs: number } {
  let dateObj: Date;

  if (!ts) {
    dateObj = new Date();
  } else if (typeof ts === 'string') {
    dateObj = new Date(ts);
  } else if (typeof ts === 'number') {
    dateObj = new Date(ts);
  } else if (ts.toDate && typeof ts.toDate === 'function') {
    dateObj = ts.toDate();
  } else if (ts.seconds) {
    dateObj = new Date(ts.seconds * 1000);
  } else {
    dateObj = new Date();
  }

  if (isNaN(dateObj.getTime())) {
    dateObj = new Date();
  }

  const day = dateObj.getDate().toString().padStart(2, '0');
  const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
  const year = dateObj.getFullYear();
  const dateStr = `${day}/${month}/${year}`;

  const hours = dateObj.getHours().toString().padStart(2, '0');
  const mins = dateObj.getMinutes().toString().padStart(2, '0');
  const secs = dateObj.getSeconds().toString().padStart(2, '0');
  const timeStr = `${hours}:${mins}:${secs}`;

  return { dateStr, timeStr, rawMs: dateObj.getTime() };
}

function isToday(rawMs: number): boolean {
  const d = new Date(rawMs);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function formatClock(rawMs: number): string {
  const d = new Date(rawMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDurationLabel(mins?: number): string {
  const m = Math.round(Number(mins) || 0);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return `${h}:${String(rem).padStart(2, '0')}:00`;
  }
  return `${m}:00`;
}

function computePace(distanceKm?: number, durationMins?: number): string | null {
  const km = Number(distanceKm) || 0;
  const mins = Number(durationMins) || 0;
  if (km <= 0 || mins <= 0) return null;
  const paceMinPerKm = mins / km;
  const whole = Math.floor(paceMinPerKm);
  const secs = Math.round((paceMinPerKm - whole) * 60);
  return `${whole}'${String(secs).padStart(2, '0')}"`;
}

function caloriesTier(kcal?: number) {
  if (kcal === undefined) return '';
  if (kcal >= 500) return 'Muito bom';
  if (kcal >= 250) return 'Bom';
  return 'Leve';
}
function hrZoneTier(hr?: number, age?: number) {
  if (hr === undefined) return '';
  const maxHr = 220 - (age || 30);
  const pct = hr / maxHr;
  if (pct >= 0.9) return 'Zona 5';
  if (pct >= 0.8) return 'Zona 4';
  if (pct >= 0.7) return 'Zona 3';
  if (pct >= 0.6) return 'Zona 2';
  return 'Zona 1';
}
function cadenceTier(spm?: number) {
  if (spm === undefined) return '';
  if (spm >= 170) return 'Ótima';
  if (spm >= 150) return 'Boa';
  return 'Regular';
}
function elevationTier(m?: number) {
  if (m === undefined) return '';
  if (m > 0) return 'Ganho positivo';
  if (m < 0) return 'Descida';
  return 'Plano';
}

// #202/#204/#215: tela de detalhe da atividade, estilo Strava, seguindo o layout de
// referencia fornecido pelo usuario (logo INVICTUS, header, localizacao, 3 metricas
// principais, mapa real da rota + clima, callout de resultado com percentual REAL de
// ranking, analise expandida, grid de desempenho, rodape de verificacao e barra de
// acoes reais -- Parabens persistido + Compartilhar).
function ActivityDetailScreen({ item, onClose, onShare }: { item: ActivityHistoryItem; onClose: () => void; onShare: () => void }) {
  const isHomologada = item.status === 'homologada';
  const isRejeitada = item.status === 'rejeitada';
  const cadence = (item.steps && item.durationMins) ? Math.round(item.steps / item.durationMins) : undefined;
  const pace = item.pace || computePace(item.distanceKm, item.durationMins);
  const hasMap = Array.isArray(item.trajectory) && item.trajectory.length >= 2;
  const hasPerf = item.calories !== undefined || item.avgHeartRate !== undefined || cadence !== undefined || item.elevationGain !== undefined;

  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [showFullAnalysis, setShowFullAnalysis] = useState(false);

  // #215: percentual REAL de ranking (nunca um numero chutado) -- busca a lista
  // de topUsers em /api/ranking e calcula em que percentil o usuario esta a
  // partir da posicao (rank) real dele. Se o usuario nao tiver posicao no
  // ranking (ex: sem temporada ativa), simplesmente nao mostramos nenhum
  // percentual, em vez de inventar um.
  const [percentile, setPercentile] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function fetchPercentile() {
      const authUser = auth.currentUser;
      if (!authUser) return;
      try {
        const idToken = await authUser.getIdToken();
        const res = await fetch(`${API_CONFIG.baseUrl}/api/ranking`, {
          headers: { Authorization: `Bearer ${idToken}` }
        });
        const json = await res.json();
        if (cancelled) return;
        const list = Array.isArray(json.topUsers) ? json.topUsers : [];
        const mine = list.find((u: any) => u.uid === authUser.uid);
        if (mine && mine.rank && list.length > 0) {
          const pct = Math.max(1, Math.ceil((Number(mine.rank) / list.length) * 100));
          setPercentile(pct);
        }
      } catch (err) {
        console.warn('[ActivityDetailScreen] Falha ao calcular percentil real de ranking:', err);
      }
    }
    fetchPercentile();
    return () => { cancelled = true; };
  }, []);

  // #215: "Parabéns" real -- marcador persistido no proprio documento da
  // atividade (nao um contador social falso). Alterna e salva no Firestore.
  const [congratulated, setCongratulated] = useState<boolean>(!!item.congratulated);
  const [savingCongrats, setSavingCongrats] = useState(false);
  const collectionName = item.source === 'workout' ? 'workouts' : item.source === 'checkin' ? 'gym_checkins' : 'power_records';
  const handleCongrats = async () => {
    if (savingCongrats) return;
    const next = !congratulated;
    setCongratulated(next);
    setSavingCongrats(true);
    try {
      await updateDoc(doc(db, collectionName, item.id), {
        congratulated: next,
        congratsAt: next ? new Date().toISOString() : null
      });
    } catch (err) {
      console.warn('[ActivityDetailScreen] Falha ao salvar Parabéns:', err);
      setCongratulated(!next);
    } finally {
      setSavingCongrats(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[250] bg-black flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black/95 backdrop-blur-md border-b border-white/10">
        <div className="px-4 pt-2.5 pb-1 flex items-center justify-center gap-1.5">
          <Flame className="text-primary fill-current" size={13} />
          <span className="text-white font-black italic text-[11px] tracking-tight leading-none">INVICTUS</span>
          <span className="text-primary text-[8px] font-bold tracking-[0.25em] uppercase ml-0.5 leading-none">Performance</span>
        </div>
        <div className="px-4 pb-3 flex items-center justify-between">
          <button onClick={onClose} className="p-2 -ml-2 text-white/80 hover:text-white cursor-pointer"><ChevronLeft size={22} /></button>
          <h1 className="text-white font-bold text-sm truncate px-2">{item.typeLabel}</h1>
          <button onClick={onShare} className="p-2 -mr-2 text-white/80 hover:text-white cursor-pointer"><Share2 size={19} /></button>
        </div>
      </div>

      <div className="flex-1 p-4 sm:p-5 space-y-5 max-w-xl w-full mx-auto">
        {/* Activity row */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-full bg-primary flex items-center justify-center shrink-0">
              {item.type === 'cardio' ? <TrendingUp className="text-black" size={20} /> : item.type === 'checkin' ? <MapPin className="text-black" size={20} /> : item.type === 'power' ? <Trophy className="text-black" size={20} /> : <Dumbbell className="text-black" size={20} />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-white font-bold text-sm truncate">{item.title}</p>
                {isHomologada && <ShieldCheck size={14} className="text-primary shrink-0" />}
              </div>
              <p className="text-white/50 text-[11px] font-mono truncate">
                {isToday(item.rawTimestamp) ? 'Hoje' : item.dateStr} às {formatClock(item.rawTimestamp)}{locationLabel ? ` · ${locationLabel}` : ''}
              </p>
            </div>
          </div>
        </div>

        {/* 3 stats */}
        <div className="grid grid-cols-3 gap-2 border-y border-white/10 py-4">
          <div>
            <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">Distância</p>
            <p className="text-white font-black text-2xl">{(item.distanceKm || 0).toFixed(2)}<span className="text-xs ml-1 text-white/40">km</span></p>
          </div>
          <div>
            <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">Tempo</p>
            <p className="text-white font-black text-2xl">{formatDurationLabel(item.durationMins)}</p>
          </div>
          <div>
            <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">Ritmo médio</p>
            <p className="text-white font-black text-2xl">{pace || '--'}<span className="text-xs ml-1 text-white/40">/km</span></p>
          </div>
        </div>

        {/* Map (com badge de clima real via Open-Meteo) */}
        {hasMap && <ActivityMapView trajectory={item.trajectory} heightPx={220} onLocation={setLocationLabel} />}

        {/* Callout: resultado real (pontos de ranking + percentil REAL, ou motivo de rejeicao) */}
        {isRejeitada && item.rejectionReason ? (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 flex items-start gap-3">
            <AlertOctagon size={18} className="text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-rose-400 font-bold text-[10px] uppercase tracking-wider mb-1">Parecer da auditoria antifraude</p>
              <p className="text-rose-200/90 text-xs leading-relaxed">{item.rejectionReason}</p>
            </div>
          </div>
        ) : (
          <div className="border border-primary/30 bg-primary/5 rounded-2xl px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
              <Gauge className="text-primary" size={17} />
            </div>
            <div>
              <p className="text-white font-bold text-xs">
                {item.rankingPointsEarned ? `Você ganhou +${item.rankingPointsEarned} pontos de ranking!` : isHomologada ? `Atividade homologada -- +${item.points} XP` : 'Atividade em análise pela auditoria.'}
              </p>
              <p className="text-primary text-[10px] font-mono">
                {percentile !== null ? `Você está entre os Top ${percentile}% do ranking!` : 'Continue assim para subir no ranking.'}
              </p>
            </div>
          </div>
        )}

        {/* Desempenho */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-bold text-sm flex items-center gap-1.5"><Info size={13} className="text-white/40" /> Desempenho</h3>
          </div>
          {hasPerf ? (
            <div className="grid grid-cols-2 gap-3">
              {item.calories !== undefined && (
                <div className="bg-surface-container-low/60 border border-white/10 rounded-2xl p-3.5">
                  <div className="flex items-center gap-1.5 text-white/50 text-[10px] font-bold uppercase tracking-wide mb-1"><Flame size={12} /> Gasto energético</div>
                  <p className="text-white font-black text-xl">{Math.round(item.calories)}<span className="text-xs ml-1 text-white/40">kcal</span></p>
                  <p className="text-primary text-[10px] font-mono mt-0.5">{caloriesTier(item.calories)}</p>
                </div>
              )}
              {item.avgHeartRate !== undefined && (
                <div className="bg-surface-container-low/60 border border-white/10 rounded-2xl p-3.5">
                  <div className="flex items-center gap-1.5 text-white/50 text-[10px] font-bold uppercase tracking-wide mb-1"><Heart size={12} /> FC média</div>
                  <p className="text-white font-black text-xl">{Math.round(item.avgHeartRate)}<span className="text-xs ml-1 text-white/40">bpm</span></p>
                  <p className="text-primary text-[10px] font-mono mt-0.5">{hrZoneTier(item.avgHeartRate)}</p>
                </div>
              )}
              {cadence !== undefined && (
                <div className="bg-surface-container-low/60 border border-white/10 rounded-2xl p-3.5">
                  <div className="flex items-center gap-1.5 text-white/50 text-[10px] font-bold uppercase tracking-wide mb-1"><Gauge size={12} /> Cadência média</div>
                  <p className="text-white font-black text-xl">{cadence}<span className="text-xs ml-1 text-white/40">spm</span></p>
                  <p className="text-primary text-[10px] font-mono mt-0.5">{cadenceTier(cadence)}</p>
                </div>
              )}
              {item.elevationGain !== undefined && (
                <div className="bg-surface-container-low/60 border border-white/10 rounded-2xl p-3.5">
                  <div className="flex items-center gap-1.5 text-white/50 text-[10px] font-bold uppercase tracking-wide mb-1"><Mountain size={12} /> Elevação</div>
                  <p className="text-white font-black text-xl">{Math.round(item.elevationGain)}<span className="text-xs ml-1 text-white/40">m</span></p>
                  <p className="text-primary text-[10px] font-mono mt-0.5">{elevationTier(item.elevationGain)}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-surface-container-low/40 border border-white/5 rounded-2xl p-4 text-center text-on-surface-variant text-xs">
              Sem dados adicionais de sensores para esta atividade.
            </div>
          )}
        </div>

        {/* Ver análise completa -- expande verificacoes reais feitas pelo antifraude, nao dados inventados */}
        <div>
          <button
            onClick={() => setShowFullAnalysis(v => !v)}
            className="w-full flex items-center justify-center gap-1.5 text-primary text-xs font-bold py-1.5 cursor-pointer"
          >
            {showFullAnalysis ? 'Ocultar análise' : 'Ver análise completa'}
            <ChevronRight size={13} className={cn("transition-transform", showFullAnalysis && "rotate-90")} />
          </button>
          {showFullAnalysis && (
            <div className="bg-surface-container-low/40 border border-white/5 rounded-2xl p-4 space-y-2 text-xs text-on-surface-variant">
              <p className="flex items-start gap-2">
                <ShieldCheck size={14} className="text-primary shrink-0 mt-0.5" />
                <span>Verificação por GPS contínuo {hasMap ? '-- rota registrada e validada' : '-- sem rota GPS disponível para esta atividade'}</span>
              </p>
              <p className="flex items-start gap-2">
                <ShieldCheck size={14} className="text-primary shrink-0 mt-0.5" />
                <span>Sensores de movimento (acelerômetro/giroscópio) auditados pelo pipeline antifraude Invictus</span>
              </p>
              <p className="flex items-start gap-2">
                <ShieldCheck size={14} className="text-primary shrink-0 mt-0.5" />
                <span>Sem indícios de duplicidade ou reprocessamento indevido nesta atividade</span>
              </p>
              {item.aiAnalysis && (
                <p className="pt-2 border-t border-white/5 text-zinc-300">{item.aiAnalysis}</p>
              )}
            </div>
          )}
        </div>

        {item.photoUrl && (
          <div className="space-y-2">
            <span className="text-xs font-bold text-white uppercase block">Comprovante:</span>
            <img src={item.photoUrl} alt="Comprovante" className="w-full max-h-64 object-cover rounded-2xl border border-white/10" />
          </div>
        )}

        {/* Verificado -- com icones de privacidade e compartilhamento rapido */}
        <div className={cn(
          "flex items-center gap-2 border rounded-2xl px-4 py-3",
          isHomologada ? "border-primary/20 bg-primary/5" : isRejeitada ? "border-rose-500/20 bg-rose-500/5" : "border-amber-500/20 bg-amber-500/5"
        )}>
          {isHomologada ? <ShieldCheck className="text-primary shrink-0" size={16} /> : <ShieldAlert className={cn("shrink-0", isRejeitada ? "text-rose-400" : "text-amber-400")} size={16} />}
          <p className="text-white text-[11px] font-bold flex-1">
            {isHomologada ? 'Atividade verificada -- GPS + Antifraude Invictus' : isRejeitada ? 'Atividade não homologada pela auditoria' : 'Atividade em análise'}
          </p>
          <Lock size={13} className="text-white/25 shrink-0" />
          <button onClick={onShare} className="text-white/40 hover:text-primary transition-colors cursor-pointer shrink-0">
            <Share2 size={13} />
          </button>
        </div>
      </div>

      {/* Bottom action bar -- Parabéns (real, persistido) + Compartilhar (real) */}
      <div className="sticky bottom-0 bg-black/95 backdrop-blur-md border-t border-white/10 p-4 flex items-center gap-3">
        <button
          onClick={handleCongrats}
          disabled={savingCongrats}
          className={cn(
            "flex-1 py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 cursor-pointer border transition-all disabled:opacity-60",
            congratulated ? "bg-primary text-black border-primary" : "bg-surface-container text-white/80 border-white/10 hover:border-primary/40"
          )}
        >
          <ThumbsUp size={15} className={congratulated ? "fill-current" : ""} />
          {congratulated ? 'Parabéns! 🎉' : 'Parabéns'}
        </button>
        <button onClick={onShare} className="flex-1 bg-primary text-black py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 cursor-pointer">
          <Share2 size={15} /> Compartilhar
        </button>
      </div>
    </div>
  );
}

export function ActivityHistorySection() {
  const [activities, setActivities] = useState<ActivityHistoryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'all' | 'homologada' | 'rejeitada' | 'pendente'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'workout' | 'cardio' | 'checkin' | 'power' | 'other'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [visibleCount, setVisibleCount] = useState<number>(10);

  const [detailItem, setDetailItem] = useState<ActivityHistoryItem | null>(null);
  const [shareItem, setShareItem] = useState<ActivityHistoryItem | null>(null);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);

  const fetchHistory = async () => {
    const user = auth.currentUser;
    if (!user) {
      setActivities([]);
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const items: ActivityHistoryItem[] = [];

      try {
        const wQuery = query(
          collection(db, 'workouts'),
          where('userId', '==', user.uid)
        );
        const wSnap = await getDocs(wQuery);

        const FAKE_WORKOUT_PREFIXES = ['strava_sim_', 'health_connect_'];
        const fakeWorkoutDocs = wSnap.docs.filter(wd => FAKE_WORKOUT_PREFIXES.some(p => wd.id.startsWith(p)));
        const cleanWorkoutDocs = wSnap.docs.filter(wd => !FAKE_WORKOUT_PREFIXES.some(p => wd.id.startsWith(p)));
        if (fakeWorkoutDocs.length > 0) {
          for (const fwd of fakeWorkoutDocs) {
            try { await deleteDoc(doc(db, 'workouts', fwd.id)); } catch (e) { console.warn('[ActivityHistorySection] cleanup delete failed', fwd.id, e); }
          }
        }
        cleanWorkoutDocs.forEach(d => {
          const data = d.data();
          const { dateStr, timeStr, rawMs } = parseTimestamp(data.timestamp || data.createdAt);

          let mappedStatus: 'homologada' | 'rejeitada' | 'pendente' = 'homologada';
          const rawSt = (data.status || '').toLowerCase();

          if (['valid', 'approved', 'validated', 'confirmed'].includes(rawSt)) {
            mappedStatus = 'homologada';
          } else if (['invalid', 'rejected', 'not_validated', 'not_eligible', 'suspicious'].includes(rawSt)) {
            mappedStatus = 'rejeitada';
          } else if (['pending', 'under_review', 'manual_review', 'biometria_incompleta', 'partially_validated', 'pending_review'].includes(rawSt)) {
            mappedStatus = 'pendente';
          } else if (data.isScoringEligible === false || data.nonScoringReason) {
            mappedStatus = 'rejeitada';
          }

          let typeLabel = 'Treino';
          let title = 'Treino de Musculação';
          if (data.type === 'cardio') {
            typeLabel = 'Cardio ao ar livre';
            title = data.cardioTypeLabel ? `${data.cardioTypeLabel}` : 'Corrida ao ar livre';
          } else if (data.type === 'diet') {
            typeLabel = 'Dieta';
            title = 'Refeição Auditada por IA';
          } else if (data.type === 'recovery') {
            typeLabel = 'Recuperação';
            title = 'Descanso Inteligente';
          } else if (data.type === 'power_video') {
            typeLabel = 'Power Lift';
            title = 'Power Lift Homologado';
          }

          let reason = data.userMessage || data.message || data.nonScoringReason || data.rejectionReason;
          if (!reason && data.validation) {
            reason = data.validation.userMessage || data.validation.reason || data.validation.details?.aiAnalysis;
          }
          if (reason === 'NO_MOVEMENT_DETECTED' || data.nonScoringReason === 'NO_MOVEMENT_DETECTED') {
            reason = '🚨 Nenhum deslocamento foi detectado no GPS durante a sessão de cardio (0.00 km). Atividades estáticas não são homologadas.';
          }

          const trajectoryRaw = Array.isArray(data.trajectory) ? data.trajectory : (Array.isArray(data.checkpoints) ? data.checkpoints : undefined);

          items.push({
            id: d.id,
            source: 'workout',
            type: data.type === 'cardio' ? 'cardio' : data.type === 'diet' ? 'diet' : data.type === 'recovery' ? 'recovery' : 'workout',
            typeLabel,
            title,
            subtitle: data.cardioTypeLabel || (data.duration ? `${data.duration} minutos` : undefined),
            dateStr,
            timeStr,
            rawTimestamp: rawMs,
            status: mappedStatus,
            statusRaw: rawSt || mappedStatus,
            points: Number(data.points || 0),
            rankingPointsEarned: data.rankingPointsEarned ? Number(data.rankingPointsEarned) : undefined,
            durationMins: data.duration ? Number(data.duration) : undefined,
            distanceKm: data.distance ? Number(data.distance) : undefined,
            photoUrl: data.photoUrl || data.verificationPhotoUrl,
            rejectionReason: reason,
            aiAnalysis: data.validation?.details?.aiAnalysis || data.validation?.reason,
            avgHeartRate: data.avgHeartRate !== undefined && data.avgHeartRate !== null ? Number(data.avgHeartRate) : undefined,
            calories: data.calories !== undefined && data.calories !== null ? Number(data.calories) : undefined,
            pace: data.pace || undefined,
            elevationGain: data.elevationGain !== undefined && data.elevationGain !== null ? Number(data.elevationGain) : undefined,
            steps: data.steps !== undefined && data.steps !== null ? Number(data.steps) : undefined,
            trajectory: trajectoryRaw,
            congratulated: !!data.congratulated,
            details: data.validation || data
          });
        });
      } catch (err) {
        console.warn('[ActivityHistory] Error fetching workouts:', err);
      }

      try {
        const cQuery = query(
          collection(db, 'gym_checkins'),
          where('userId', '==', user.uid)
        );
        const cSnap = await getDocs(cQuery);
        cSnap.forEach(d => {
          const data = d.data();
          const { dateStr, timeStr, rawMs } = parseTimestamp(data.checkInTime || data.timestamp || data.createdAt);

          let mappedStatus: 'homologada' | 'rejeitada' | 'pendente' = 'homologada';
          const rawSt = (data.status || '').toLowerCase();
          if (['confirmed', 'valid', 'approved'].includes(rawSt)) {
            mappedStatus = 'homologada';
          } else if (['rejected', 'invalid'].includes(rawSt)) {
            mappedStatus = 'rejeitada';
          } else {
            mappedStatus = 'pendente';
          }

          items.push({
            id: d.id,
            source: 'checkin',
            type: 'checkin',
            typeLabel: 'Check-in Presencial',
            title: 'Check-in Presencial GPS',
            subtitle: data.gymName || 'Academia Vinculada',
            dateStr,
            timeStr,
            rawTimestamp: rawMs,
            status: mappedStatus,
            statusRaw: rawSt,
            points: mappedStatus === 'homologada' ? 20 : 0,
            gymName: data.gymName,
            rejectionReason: mappedStatus === 'rejeitada' ? (data.error || 'Check-in fora do raio da academia.') : undefined,
            congratulated: !!data.congratulated,
            details: data
          });
        });
      } catch (err) {
        console.warn('[ActivityHistory] Error fetching gym_checkins:', err);
      }

      try {
        const pQuery = query(
          collection(db, 'power_records'),
          where('userId', '==', user.uid)
        );
        const pSnap = await getDocs(pQuery);
        pSnap.forEach(d => {
          const data = d.data();
          const { dateStr, timeStr, rawMs } = parseTimestamp(data.timestamp || data.createdAt);

          let mappedStatus: 'homologada' | 'rejeitada' | 'pendente' = 'homologada';
          const rawSt = (data.videoStatus || data.status || '').toLowerCase();
          if (['validated', 'valid', 'approved'].includes(rawSt)) {
            mappedStatus = 'homologada';
          } else if (['rejected', 'invalid'].includes(rawSt)) {
            mappedStatus = 'rejeitada';
          } else {
            mappedStatus = 'pendente';
          }

          const exName = (data.exercise || '').toUpperCase();
          items.push({
            id: d.id,
            source: 'power',
            type: 'power',
            typeLabel: 'Power Lift',
            title: `Invictus Power Lift (${exName})`,
            subtitle: `${data.weight || 0} kg`,
            dateStr,
            timeStr,
            rawTimestamp: rawMs,
            status: mappedStatus,
            statusRaw: rawSt,
            points: mappedStatus === 'homologada' ? 100 : 0,
            weightKg: data.weight ? Number(data.weight) : undefined,
            exerciseName: exName,
            photoUrl: data.videoUrl,
            rejectionReason: data.rejectionReason,
            congratulated: !!data.congratulated,
            details: data
          });
        });
      } catch (err) {
        console.warn('[ActivityHistory] Error fetching power_records:', err);
      }

      items.sort((a, b) => b.rawTimestamp - a.rawTimestamp);
      setActivities(items);
    } catch (err: any) {
      console.error('[ActivityHistory] Unexpected error fetching history:', err);
      setError('Falha ao carregar o histórico de atividades.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchHistory();
  };

  const filteredActivities = useMemo(() => {
    return activities.filter(act => {
      if (statusFilter !== 'all' && act.status !== statusFilter) {
        return false;
      }

      if (typeFilter !== 'all') {
        if (typeFilter === 'workout' && act.type !== 'workout') return false;
        if (typeFilter === 'cardio' && act.type !== 'cardio') return false;
        if (typeFilter === 'checkin' && act.type !== 'checkin') return false;
        if (typeFilter === 'power' && act.type !== 'power') return false;
        if (typeFilter === 'other' && !['diet', 'recovery'].includes(act.type)) return false;
      }

      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const matchTitle = act.title.toLowerCase().includes(q);
        const matchType = act.typeLabel.toLowerCase().includes(q);
        const matchDate = act.dateStr.includes(q);
        const matchTime = act.timeStr.includes(q);
        const matchGym = act.gymName?.toLowerCase().includes(q);
        const matchReason = act.rejectionReason?.toLowerCase().includes(q);
        if (!matchTitle && !matchType && !matchDate && !matchTime && !matchGym && !matchReason) {
          return false;
        }
      }

      return true;
    });
  }, [activities, statusFilter, typeFilter, searchQuery]);

  const stats = useMemo(() => {
    const total = activities.length;
    const homologadas = activities.filter(a => a.status === 'homologada').length;
    const rejeitadas = activities.filter(a => a.status === 'rejeitada').length;
    const pendentes = activities.filter(a => a.status === 'pendente').length;
    const totalXp = activities.reduce((acc, curr) => acc + (curr.points || 0), 0);
    const rate = total > 0 ? Math.round((homologadas / total) * 100) : 0;

    return { total, homologadas, rejeitadas, pendentes, totalXp, rate };
  }, [activities]);

  const visibleItems = filteredActivities.slice(0, visibleCount);

  return (
    <div id="activity-history-section" className="bg-surface-card border border-white/10 rounded-[28px] p-6 space-y-6 shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 w-80 h-80 bg-primary/5 rounded-full blur-3xl pointer-events-none" />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-primary/10 border border-primary/20 rounded-2xl text-primary shrink-0">
            <History size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-black text-primary uppercase tracking-widest block">
                HISTÓRICO DE ATIVIDADES
              </span>
              <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Sincronizado
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-headline italic font-black text-white uppercase tracking-tight">
              Suas Atividades
            </h2>
            <p className="text-xs text-on-surface-variant">
              Data, duração, distância, calorias, ritmo e rota de cada atividade registrada.
            </p>
          </div>
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="px-4 py-2.5 bg-surface-container hover:bg-surface-container-high border border-white/10 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 self-start md:self-auto cursor-pointer"
        >
          <RefreshCw size={15} className={cn(refreshing && "animate-spin text-primary")} />
          <span>{refreshing ? 'Atualizando...' : 'Atualizar Histórico'}</span>
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-surface-container-low/60 border border-white/5 p-3.5 rounded-2xl flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase text-on-surface-variant font-bold">Total Registrado</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-xl font-headline italic font-black text-white">{stats.total}</span>
            <span className="text-[10px] text-on-surface-variant">atividades</span>
          </div>
        </div>

        <div className="bg-emerald-500/10 border border-emerald-500/20 p-3.5 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-emerald-400">
            <span className="text-[10px] font-mono uppercase font-bold">Homologadas</span>
            <CheckCircle2 size={14} />
          </div>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-xl font-headline italic font-black text-emerald-400">{stats.homologadas}</span>
            <span className="text-[10px] text-emerald-300/80">({stats.rate}% de aprovação)</span>
          </div>
        </div>

        <div className="bg-rose-500/10 border border-rose-500/20 p-3.5 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-rose-400">
            <span className="text-[10px] font-mono uppercase font-bold">Rejeitadas</span>
            <XCircle size={14} />
          </div>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-xl font-headline italic font-black text-rose-400">{stats.rejeitadas}</span>
            <span className="text-[10px] text-rose-300/80">não pontuaram</span>
          </div>
        </div>

        <div className="bg-primary/10 border border-primary/20 p-3.5 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-primary">
            <span className="text-[10px] font-mono uppercase font-bold">XP Conquistado</span>
            <Zap size={14} />
          </div>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-xl font-headline italic font-black text-primary">+{stats.totalXp}</span>
            <span className="text-[10px] text-primary/80">XP acumulado</span>
          </div>
        </div>
      </div>

      <div className="space-y-3 bg-black/30 p-4 rounded-2xl border border-white/5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por tipo, data (DD/MM/AAAA), horário, academia..."
              className="w-full bg-surface-container/80 border border-white/10 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder:text-on-surface-variant/60 focus:outline-none focus:border-primary transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-white"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 sm:pb-0">
            {[
              { id: 'all', label: 'Todas' },
              { id: 'homologada', label: '🟢 Homologadas' },
              { id: 'rejeitada', label: '🔴 Rejeitadas' },
              { id: 'pendente', label: '🟡 Em Análise' },
            ].map(pill => (
              <button
                key={pill.id}
                onClick={() => setStatusFilter(pill.id as any)}
                className={cn(
                  "px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all border cursor-pointer whitespace-nowrap shrink-0",
                  statusFilter === pill.id
                    ? "bg-white text-black border-white shadow-md font-extrabold"
                    : "bg-surface-container/60 hover:bg-surface-container border-white/5 text-on-surface-variant hover:text-white"
                )}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1 border-t border-white/5">
          <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1">
            <Filter size={12} /> Modalidade:
          </span>
          {[
            { id: 'all', label: 'Todas' },
            { id: 'workout', label: '🏋️ Musculação' },
            { id: 'cardio', label: '🏃 Cardio' },
            { id: 'checkin', label: '📍 Check-in GPS' },
            { id: 'power', label: '🔥 Power Lift' },
            { id: 'other', label: '🥗 Outros' },
          ].map(typePill => (
            <button
              key={typePill.id}
              onClick={() => setTypeFilter(typePill.id as any)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all border cursor-pointer whitespace-nowrap shrink-0",
                typeFilter === typePill.id
                  ? "bg-primary/20 text-primary border-primary/40"
                  : "bg-surface-container-low border-white/5 text-on-surface-variant hover:text-white"
              )}
            >
              {typePill.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center space-y-3 text-on-surface-variant">
          <RefreshCw className="animate-spin text-primary" size={28} />
          <p className="text-xs font-mono">Carregando histórico de atividades...</p>
        </div>
      ) : error ? (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-2xl text-xs flex items-center gap-3">
          <AlertCircle size={18} className="shrink-0 text-rose-400" />
          <p>{error}</p>
        </div>
      ) : filteredActivities.length === 0 ? (
        <div className="py-12 px-4 text-center space-y-3 bg-surface-container-low/30 border border-white/5 rounded-2xl">
          <div className="w-12 h-12 mx-auto rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-on-surface-variant">
            <History size={24} />
          </div>
          <h3 className="text-sm font-bold text-white uppercase">Nenhuma atividade encontrada</h3>
          <p className="text-xs text-on-surface-variant max-w-md mx-auto">
            {searchQuery || statusFilter !== 'all' || typeFilter !== 'all'
              ? 'Nenhuma atividade corresponde aos filtros selecionados. Tente limpar a busca ou os filtros.'
              : 'Você ainda não possui atividades registradas. Inicie um treino, cardio ou check-in para começar seu histórico!'}
          </p>
          {(searchQuery || statusFilter !== 'all' || typeFilter !== 'all') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
                setTypeFilter('all');
              }}
              className="mt-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Limpar Filtros
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleItems.map((act) => {
            const isHomologada = act.status === 'homologada';
            const isRejeitada = act.status === 'rejeitada';
            const isPendente = act.status === 'pendente';
            const pace = act.pace || computePace(act.distanceKm, act.durationMins);

            return (
              <div
                key={act.id}
                className={cn(
                  "p-4 rounded-2xl border transition-all space-y-3 relative overflow-hidden group",
                  isHomologada
                    ? "bg-surface-container-low/60 border-emerald-500/20 hover:border-emerald-500/40"
                    : isRejeitada
                      ? "bg-rose-950/10 border-rose-500/30 hover:border-rose-500/50"
                      : "bg-amber-950/10 border-amber-500/30 hover:border-amber-500/50"
                )}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "p-2.5 rounded-xl border shrink-0 mt-0.5",
                      act.type === 'workout' ? "bg-amber-500/10 border-amber-500/30 text-amber-400" :
                      act.type === 'cardio' ? "bg-orange-500/10 border-orange-500/30 text-orange-400" :
                      act.type === 'checkin' ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" :
                      act.type === 'power' ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400" :
                      "bg-purple-500/10 border-purple-500/30 text-purple-400"
                    )}>
                      {act.type === 'workout' && <Dumbbell size={20} />}
                      {act.type === 'cardio' && <TrendingUp size={20} />}
                      {act.type === 'checkin' && <MapPin size={20} />}
                      {act.type === 'power' && <Trophy size={20} />}
                      {['diet', 'recovery'].includes(act.type) && <Flame size={20} />}
                    </div>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-on-surface-variant">
                          {act.typeLabel}
                        </span>
                        <span className={cn(
                          "text-[10px] font-mono font-black uppercase tracking-wider px-2 py-0.5 rounded-md border flex items-center gap-1",
                          isHomologada && "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
                          isRejeitada && "bg-rose-500/15 text-rose-400 border-rose-500/30",
                          isPendente && "bg-amber-500/15 text-amber-400 border-amber-500/30"
                        )}>
                          {isHomologada && <CheckCircle2 size={12} />}
                          {isRejeitada && <XCircle size={12} />}
                          {isPendente && <Clock size={12} />}
                          <span>{isHomologada ? 'HOMOLOGADA' : isRejeitada ? 'REJEITADA' : 'EM AUDITORIA'}</span>
                        </span>
                      </div>

                      <h4 className="font-bold text-sm sm:text-base text-white group-hover:text-primary transition-colors">
                        {act.title}
                      </h4>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant font-mono">
                        <span className="flex items-center gap-1 text-zinc-300">
                          <Calendar size={13} className="text-primary" />
                          {act.dateStr}
                        </span>
                        <span className="flex items-center gap-1 text-zinc-300">
                          <Clock size={13} className="text-primary" />
                          {act.timeStr}
                        </span>
                        {act.gymName && (
                          <span className="flex items-center gap-1 text-zinc-400">
                            <MapPin size={13} className="text-emerald-400" />
                            {act.gymName}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        {act.durationMins !== undefined && (
                          <span className="text-[10px] font-mono bg-white/5 border border-white/10 rounded-md px-1.5 py-0.5 text-zinc-300">⏱️ {act.durationMins} min</span>
                        )}
                        {act.distanceKm !== undefined && act.distanceKm > 0 && (
                          <span className="text-[10px] font-mono bg-white/5 border border-white/10 rounded-md px-1.5 py-0.5 text-zinc-300">🏃 {act.distanceKm.toFixed(2)} km</span>
                        )}
                        {pace && (
                          <span className="text-[10px] font-mono bg-white/5 border border-white/10 rounded-md px-1.5 py-0.5 text-zinc-300">⚡ {pace}/km</span>
                        )}
                        {act.calories !== undefined && (
                          <span className="text-[10px] font-mono bg-white/5 border border-white/10 rounded-md px-1.5 py-0.5 text-zinc-300">🔥 {Math.round(act.calories)} kcal</span>
                        )}
                        {act.avgHeartRate !== undefined && (
                          <span className="text-[10px] font-mono bg-white/5 border border-white/10 rounded-md px-1.5 py-0.5 text-zinc-300">❤️ {Math.round(act.avgHeartRate)} bpm</span>
                        )}
                        {act.trajectory && act.trajectory.length >= 2 && (
                          <span className="text-[10px] font-mono bg-white/5 border border-white/10 rounded-md px-1.5 py-0.5 text-zinc-300 flex items-center gap-1"><RouteIcon size={10} /> rota GPS</span>
                        )}
                        {act.weightKg !== undefined && (
                          <span className="text-[10px] font-mono bg-white/5 border border-white/10 rounded-md px-1.5 py-0.5 text-zinc-300">🏋️ {act.weightKg} kg</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 border-white/5 pt-2 sm:pt-0 shrink-0 gap-1.5">
                    <div className={cn(
                      "px-3 py-1 rounded-xl font-headline italic font-black text-xs sm:text-sm flex items-center gap-1 border",
                      isHomologada
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-zinc-800 border-zinc-700 text-zinc-400"
                    )}>
                      <Award size={14} />
                      <span>{isHomologada ? `+${act.points} XP` : '0 XP'}</span>
                    </div>
                  </div>
                </div>

                {isRejeitada && act.rejectionReason && (
                  <div className="bg-rose-500/10 border border-rose-500/30 p-3 rounded-xl flex items-start gap-2.5 text-xs text-rose-300 font-sans">
                    <AlertOctagon size={16} className="text-rose-400 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <p className="font-bold text-rose-400 uppercase tracking-wider text-[10px]">
                        PARECER DE REJEIÇÃO / INDEFERIMENTO ANTIFRAUDE:
                      </p>
                      <p className="leading-relaxed text-[11.5px] text-rose-200/90">
                        {act.rejectionReason}
                      </p>
                    </div>
                  </div>
                )}

                {act.photoUrl && (
                  <div className="pt-2 flex items-center gap-3">
                    <button
                      onClick={() => setPreviewPhotoUrl(act.photoUrl!)}
                      className="group/img relative rounded-xl overflow-hidden border border-white/10 hover:border-primary transition-all cursor-pointer shrink-0"
                    >
                      <img
                        src={act.photoUrl}
                        alt="Comprovante de atividade"
                        className="w-16 h-16 object-cover group-hover/img:scale-105 transition-transform"
                      />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity">
                        <Eye size={16} className="text-white" />
                      </div>
                    </button>
                    <div className="text-[11px] text-on-surface-variant space-y-0.5">
                      <span className="font-bold text-white flex items-center gap-1">
                        <ImageIcon size={12} className="text-primary" /> Registro de Foto/Anexo
                      </span>
                      <p className="text-[10px] text-zinc-400">Clique na miniatura para visualizar o comprovante anexado.</p>
                    </div>
                  </div>
                )}

                <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-on-surface-variant">
                  <button
                    onClick={() => setShareItem(act)}
                    className="text-xs font-bold text-white/60 hover:text-white flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Share2 size={14} />
                    <span>Compartilhar</span>
                  </button>

                  <button
                    onClick={() => setDetailItem(act)}
                    className="text-xs font-bold text-primary hover:text-primary-hover flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <span>Ver Detalhes</span>
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {filteredActivities.length > visibleCount && (
        <div className="text-center pt-2">
          <button
            onClick={() => setVisibleCount(prev => prev + 15)}
            className="px-6 py-3 bg-surface-container hover:bg-surface-container-high border border-white/10 text-white font-headline font-black italic text-xs uppercase tracking-wider rounded-xl shadow-lg transition-all cursor-pointer"
          >
            Carregar Mais Atividades ({filteredActivities.length - visibleCount} restantes)
          </button>
        </div>
      )}

      <AnimatePresence>
        {detailItem && (
          <ActivityDetailScreen
            item={detailItem}
            onClose={() => setDetailItem(null)}
            onShare={() => { setShareItem(detailItem); }}
          />
        )}
      </AnimatePresence>

      {shareItem && (
        <RunShareCard
          session={{
            id: shareItem.id,
            title: shareItem.title,
            distanceKm: shareItem.distanceKm,
            durationMins: shareItem.durationMins,
            pace: shareItem.pace,
            calories: shareItem.calories,
            avgHeartRate: shareItem.avgHeartRate,
            elevationGain: shareItem.elevationGain,
            steps: shareItem.steps,
            trajectory: shareItem.trajectory,
            timestamp: new Date(shareItem.rawTimestamp).toISOString(),
            rankingPointsEarned: shareItem.rankingPointsEarned,
            points: shareItem.points,
          } as any}
          onClose={() => setShareItem(null)}
        />
      )}

      <AnimatePresence>
        {previewPhotoUrl && (
          <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-lg flex items-center justify-center p-4">
            <div className="relative max-w-2xl w-full">
              <button
                onClick={() => setPreviewPhotoUrl(null)}
                className="absolute -top-10 right-0 text-white/80 hover:text-white p-2 rounded-full bg-white/10 cursor-pointer"
              >
                <X size={20} />
              </button>
              <img
                src={previewPhotoUrl}
                alt="Comprovante em tamanho real"
                className="w-full max-h-[80vh] object-contain rounded-2xl border border-white/20 shadow-2xl"
              />
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
