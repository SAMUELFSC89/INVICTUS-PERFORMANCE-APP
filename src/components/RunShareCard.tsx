import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Share2, Download, X, ShieldCheck, Flame, Heart, Gauge, Mountain, Trophy, EyeOff, RefreshCw } from 'lucide-react';
import { toPng } from 'html-to-image';
import { RunSession, AdvancedRunStats } from '../services/runningService';
import { formatDuration } from '../lib/runUtils';
import { cn } from '../lib/utils';
import { useUser } from '../UserContext';
import { auth } from '../firebase';
import { API_CONFIG } from '../config';
import { InvictusLogo } from './InvictusLogo';

// #202: forma "solta" o suficiente para aceitar tanto RunSession/AdvancedRunStats
// (fluxo da Corrida Invictus oficial) quanto ActivityHistoryItem (historico geral
// de atividades em ActivityHistorySection.tsx, usado para permitir compartilhar
// qualquer atividade a qualquer momento, nao so na hora de finalizar) -- todos os
// campos sao opcionais para nao quebrar nenhum dos dois formatos de origem.
export interface ShareableSession {
  id?: string;
  title?: string;
  km?: number;
  distanceKm?: number;
  totalDistance?: number;
  timeSeconds?: number;
  durationMins?: number;
  startTime?: string;
  endTime?: string;
  pace?: string;
  avgPace?: string;
  calories?: number;
  avgHeartRate?: number;
  elevationGain?: number;
  steps?: number;
  trajectory?: Array<any>;
  checkpoints?: Array<any>;
  date?: string;
  timestamp?: string;
  locationLabel?: string;
  points?: number;
  rankingPointsEarned?: number;
  photoProof?: string;
}

interface RunShareCardProps {
  session: RunSession | AdvancedRunStats | ShareableSession;
  onClose: () => void;
}

function hasValidLatLng(p: any): boolean {
  if (!p) return false;
  const lat = Number(p.lat ?? p.latitude ?? p.location?.lat ?? p.location?.latitude);
  const lng = Number(p.lng ?? p.longitude ?? p.location?.lng ?? p.location?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function caloriesLabel(kcal?: number) {
  if (kcal === undefined) return '';
  if (kcal >= 500) return 'Muito bom';
  if (kcal >= 250) return 'Bom';
  return 'Leve';
}
function hrZoneLabel(hr?: number, age?: number) {
  if (hr === undefined) return '';
  const maxHr = 220 - (age || 30);
  const pct = hr / maxHr;
  if (pct >= 0.9) return 'Zona 5';
  if (pct >= 0.8) return 'Zona 4';
  if (pct >= 0.7) return 'Zona 3';
  if (pct >= 0.6) return 'Zona 2';
  return 'Zona 1';
}
function cadenceLabel(spm?: number) {
  if (spm === undefined) return '';
  if (spm >= 170) return 'Ótima';
  if (spm >= 150) return 'Boa';
  return 'Regular';
}
function elevationLabel(m?: number) {
  if (m === undefined) return '';
  if (m > 0) return 'Ganho positivo';
  if (m < 0) return 'Descida';
  return 'Plano';
}

export function RunShareCard({ session: rawSession, onClose }: RunShareCardProps) {
  const { user } = useUser();
  const cardRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSharingLink, setIsSharingLink] = useState(false);
  const [mapImageDataUrl, setMapImageDataUrl] = useState<string | null>(null);
  const [weather, setWeather] = useState<{ tempC: number; icon: string } | null>(null);

  const session: any = rawSession;

  const distanceKm = Number(
    session.distanceKm ?? session.km ?? (session.totalDistance ? session.totalDistance / 1000 : 0)
  );
  const durationMins = Number(
    session.durationMins ??
    (session.timeSeconds ? Math.round(session.timeSeconds / 60) :
      (session.startTime && session.endTime ? Math.round((new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 60000) : 0))
  );
  const durationSeconds = Number(
    session.timeSeconds ??
    (session.startTime && session.endTime ? Math.round((new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 1000) : durationMins * 60)
  );
  const duration = formatDuration(durationSeconds || 0);
  const pace = session.pace || session.avgPace ||
    (distanceKm > 0 && durationMins > 0
      ? `${Math.floor(durationMins / distanceKm)}'${String(Math.round((durationMins / distanceKm % 1) * 60)).padStart(2, '0')}"/km`
      : "--'--\"/km");
  const calories = session.calories ? Math.round(Number(session.calories)) : undefined;
  const avgHeartRate = session.avgHeartRate ? Math.round(Number(session.avgHeartRate)) : undefined;
  const elevationGain = (session.elevationGain !== undefined && session.elevationGain !== null) ? Math.round(Number(session.elevationGain)) : undefined;
  const cadence = (session.steps && durationMins > 0) ? Math.round(Number(session.steps) / durationMins) : undefined;
  const trajectory: Array<any> = Array.isArray(session.trajectory)
    ? session.trajectory
    : (Array.isArray(session.checkpoints) ? session.checkpoints : []);
  const title = session.title || session.cardioTypeLabel || 'Corrida ao ar livre';
  // #214: XP e pontos de ranking sao coisas DIFERENTES -- nunca rotular XP como
  // "pontos de ranking" (bug anterior: cardio sem rankingPointsEarned caia no
  // fallback de session.points, que e XP, e exibia como se fosse ranking).
  const rankingPointsEarned = Number(session.rankingPointsEarned || 0);
  const xpPoints = Number(session.points || 0);

  const isBike = title.toLowerCase().includes('bike') || session.cardioType === 'bike';
  const isIndoor = session.isIndoorCardio || title.toLowerCase().includes('indoor') || title.toLowerCase().includes('esteira') || title.toLowerCase().includes('ergométrica') || title.toLowerCase().includes('hiit') || title.toLowerCase().includes('musculação') || title.toLowerCase().includes('treino de');
  const hasDistance = distanceKm > 0.05;
  const speedKmH = (distanceKm > 0.01 && durationMins > 0) ? (distanceKm / (durationMins / 60)).toFixed(1) : undefined;

  const activityDate = useMemo(() => {
    const raw = session.date || session.startTime || session.timestamp;
    return raw ? new Date(raw) : new Date();
  }, [session.date, session.startTime, session.timestamp]);

  const dateLabel = useMemo(() => {
    const now = new Date();
    const isToday = activityDate.toDateString() === now.toDateString();
    const hh = String(activityDate.getHours()).padStart(2, '0');
    const mm = String(activityDate.getMinutes()).padStart(2, '0');
    const dayLabel = isToday ? 'Hoje' : activityDate.toLocaleDateString('pt-BR');
    return `${dayLabel} às ${hh}:${mm}`;
  }, [activityDate]);

  const [locationLabel, setLocationLabel] = useState<string | null>(session.locationLabel || null);

  // Busca a imagem do mapa ANTES de permitir exportar -- o html-to-image so
  // captura o que ja esta renderizado no DOM, entao buscamos o data URL
  // diretamente aqui (em vez de depender do componente assincrono
  // ActivityMapView) para garantir que a imagem ja esteja pronta na captura.
  useEffect(() => {
    let cancelled = false;
    async function fetchMap() {
      const points = (trajectory || []).filter(hasValidLatLng);
      if (points.length < 2) return;
      const authUser = auth.currentUser;
      if (!authUser) return;
      try {
        const idToken = await authUser.getIdToken();
        const res = await fetch(`${API_CONFIG.baseUrl}/api/activity-map`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
          body: JSON.stringify({ trajectory: points, width: 640, height: 420 })
        });
        const json = await res.json();
        if (cancelled) return;
        if (json.success) {
          setMapImageDataUrl(json.imageDataUrl);
          setWeather(json.weather || null);
          if (!locationLabel) setLocationLabel(json.location?.label || null);
        }
      } catch (err) {
        console.warn('[RunShareCard] Falha ao carregar mapa para o card:', err);
      }
    }
    fetchMap();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phrases = [
    "Mais um dia sem falhar",
    "Disciplina não negocia",
    "Subindo no ranking",
    "O impossível é apenas o começo",
    "Menos rotina, mais INVICTUS"
  ];
  const randomPhrase = useMemo(() => phrases[Math.floor(Math.random() * phrases.length)], []);

  const handleShareLink = async () => {
    if (!session.id) {
      alert('Sincronizando atividade... tente novamente em instantes.');
      return;
    }
    setIsSharingLink(true);
    const baseUrl = import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://www.invictusperformance.app.br');
    const shareUrl = `${baseUrl.replace(/\/$/, '')}/share/${session.id}`;
    const shareTitle = 'Atividade concluída no INVICTUS! 🔥';
    const shareText = `Vem ver meu treino de ${distanceKm.toFixed(2)}km! ${randomPhrase}. #INVICTUS`;
    try {
      if (navigator.share) {
        await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        alert('Link copiado para a área de transferência!');
      }
    } catch (err) {
      console.error('[RunShareCard] Share Error:', err);
    } finally {
      setIsSharingLink(false);
    }
  };

  const handleExport = async (mode: 'download' | 'share') => {
    if (!cardRef.current) return;
    setIsGenerating(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 150));
      const dataUrl = await toPng(cardRef.current, {
        canvasWidth: 1080,
        canvasHeight: 1920,
        pixelRatio: 2,
      });

      if (mode === 'share' && navigator.share) {
        try {
          const blob = await (await fetch(dataUrl)).blob();
          const file = new File([blob], 'invictus-atividade.png', { type: 'image/png' });
          if ((navigator as any).canShare && (navigator as any).canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Invictus Performance', text: `Atividade de ${distanceKm.toFixed(2)}km no INVICTUS!` });
            return;
          }
        } catch (shareErr) {
          console.warn('[RunShareCard] Compartilhamento de imagem falhou, baixando arquivo:', shareErr);
        }
      }

      const link = document.createElement('a');
      link.download = `invictus-atividade-${distanceKm.toFixed(2)}km.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('[RunShareCard] Export Error:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] bg-black/95 backdrop-blur-xl flex flex-col p-4 sm:p-6 animate-in fade-in duration-300 overflow-y-auto">
      <div className="flex items-center justify-between mb-6 shrink-0">
        <h2 className="text-lg sm:text-xl font-black text-white italic tracking-tighter uppercase">Compartilhar Atividade</h2>
        <button onClick={onClose} className="p-2 text-white/60 hover:text-white cursor-pointer"><X size={22} /></button>
      </div>

      <div className="flex-1 flex flex-col items-center gap-6 pb-6">
        {/* Card exportavel -- estilo Strava (referencia visual fornecida pelo usuario) */}
        <div
          ref={cardRef}
          className="w-full max-w-[380px] bg-black rounded-[28px] border border-primary/20 overflow-hidden p-6 flex flex-col gap-5"
        >
          {/* Header: wordmark + logo real */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-black italic text-lg leading-none tracking-tight">INVICTUS</p>
              <p className="text-primary text-[9px] font-bold tracking-[0.3em] uppercase">Performance</p>
            </div>
            <InvictusLogo size={32} />
          </div>

          {/* Activity row */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-primary flex items-center justify-center shrink-0">
              <Flame className="text-black" size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-white font-bold text-sm truncate">{title}</p>
                <ShieldCheck size={14} className="text-primary shrink-0" />
              </div>
              <p className="text-white/50 text-[11px] font-mono truncate">
                {dateLabel}{locationLabel ? ` · ${locationLabel}` : ''}
              </p>
            </div>
          </div>

          {/* 3 stats */}
          <div className="grid grid-cols-3 gap-2 border-y border-white/10 py-4">
            {hasDistance ? (
              <>
                <div>
                  <p className="text-white/40 text-[9px] font-bold uppercase tracking-widest mb-1">Distância</p>
                  <p className="text-primary font-black text-xl">{distanceKm.toFixed(2)}<span className="text-[10px] ml-0.5 text-primary/70">km</span></p>
                </div>
                <div>
                  <p className="text-white/40 text-[9px] font-bold uppercase tracking-widest mb-1">Tempo</p>
                  <p className="text-primary font-black text-xl">{duration}</p>
                </div>
                <div>
                  <p className="text-white/40 text-[9px] font-bold uppercase tracking-widest mb-1">{isBike ? 'Velocidade' : 'Ritmo médio'}</p>
                  <p className="text-primary font-black text-xl">
                    {isBike ? (speedKmH || '—') : pace.replace('/km', '')}
                    <span className="text-[10px] ml-0.5 text-primary/70">{isBike ? 'km/h' : '/km'}</span>
                  </p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className="text-white/40 text-[9px] font-bold uppercase tracking-widest mb-1">Tempo</p>
                  <p className="text-primary font-black text-xl">{duration}</p>
                </div>
                <div>
                  <p className="text-white/40 text-[9px] font-bold uppercase tracking-widest mb-1">Modalidade</p>
                  <p className="text-primary font-black text-xl">{isIndoor ? 'Indoor' : 'Geral'}</p>
                </div>
                <div>
                  <p className="text-white/40 text-[9px] font-bold uppercase tracking-widest mb-1">Status</p>
                  <p className="text-primary font-black text-xl">Validado</p>
                </div>
              </>
            )}
          </div>

          {/* Map */}
          {trajectory.length >= 2 && (
            <div className="relative w-full h-40 rounded-2xl overflow-hidden border border-white/10 bg-surface-container-low">
              {mapImageDataUrl ? (
                <img src={mapImageDataUrl} alt="Rota percorrida" className="w-full h-full object-cover" crossOrigin="anonymous" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <RefreshCw className="animate-spin text-primary/50" size={20} />
                </div>
              )}
              <div className="absolute top-2 left-2 bg-black/70 rounded-full px-2 py-0.5 text-[8px] font-mono text-white flex items-center gap-1">
                <EyeOff size={9} /> Início e fim ocultos
              </div>
              {weather && (
                <div className="absolute top-2 right-2 bg-black/70 rounded-full px-2 py-0.5 text-[8px] font-mono text-white flex items-center gap-1">
                  <span>{weather.tempC}°C</span><span>{weather.icon}</span>
                </div>
              )}
            </div>
          )}

          {/* Callout */}
          <div className="border border-primary/30 bg-primary/5 rounded-2xl px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
              <Gauge className="text-primary" size={16} />
            </div>
            <div className="min-w-0">
              <p className="text-white font-bold text-xs leading-tight">
                {rankingPointsEarned > 0
                  ? `Você ganhou +${rankingPointsEarned} pontos de ranking!`
                  : xpPoints > 0
                    ? `Atividade homologada -- +${xpPoints} XP`
                    : 'Ótimo trabalho nessa atividade!'}
              </p>
              <p className="text-primary text-[10px] font-mono">Continue assim para subir no ranking.</p>
            </div>
          </div>

          {/* 4 stat icons in a row (so mostra as que tiverem dado real) */}
          {(calories !== undefined || avgHeartRate !== undefined || cadence !== undefined || elevationGain !== undefined) && (
            <div className="flex items-center justify-between gap-2">
              {calories !== undefined && (
                <div className="flex-1 flex flex-col items-center gap-1 text-center">
                  <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center"><Flame className="text-primary" size={15} /></div>
                  <p className="text-white font-bold text-xs">{calories}<span className="text-[8px] text-white/40 ml-0.5">kcal</span></p>
                  <p className="text-primary text-[8px] font-mono">{caloriesLabel(calories)}</p>
                </div>
              )}
              {avgHeartRate !== undefined && (
                <div className="flex-1 flex flex-col items-center gap-1 text-center">
                  <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center"><Heart className="text-primary" size={15} /></div>
                  <p className="text-white font-bold text-xs">{avgHeartRate}<span className="text-[8px] text-white/40 ml-0.5">bpm</span></p>
                  <p className="text-primary text-[8px] font-mono">{hrZoneLabel(avgHeartRate, user?.age)}</p>
                </div>
              )}
              {cadence !== undefined && (
                <div className="flex-1 flex flex-col items-center gap-1 text-center">
                  <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center"><Gauge className="text-primary" size={15} /></div>
                  <p className="text-white font-bold text-xs">{cadence}<span className="text-[8px] text-white/40 ml-0.5">spm</span></p>
                  <p className="text-primary text-[8px] font-mono">{cadenceLabel(cadence)}</p>
                </div>
              )}
              {elevationGain !== undefined && (
                <div className="flex-1 flex flex-col items-center gap-1 text-center">
                  <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center"><Mountain className="text-primary" size={15} /></div>
                  <p className="text-white font-bold text-xs">{elevationGain}<span className="text-[8px] text-white/40 ml-0.5">m</span></p>
                  <p className="text-primary text-[8px] font-mono">{elevationLabel(elevationGain)}</p>
                </div>
              )}
            </div>
          )}

          {/* Verificado */}
          <div className="flex items-center gap-2 border border-white/10 rounded-2xl px-4 py-3">
            <ShieldCheck className="text-primary shrink-0" size={16} />
            <p className="text-white text-[11px] font-bold">Verificado por GPS + Antifraude Invictus</p>
          </div>

          {/* Banner motivacional */}
          <div className="border border-primary/30 bg-primary/5 rounded-2xl px-4 py-3 flex items-center gap-3">
            <Trophy className="text-primary shrink-0" size={20} />
            <div>
              <p className="text-white font-black text-xs uppercase tracking-tight">Bora superar seus limites!</p>
              <p className="text-primary text-[10px] font-bold uppercase tracking-wide">Consistência vence talento.</p>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 pt-1 opacity-60">
            <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-black font-black text-[10px]">
              {user?.displayName?.[0] || 'U'}
            </div>
            <p className="text-white text-[10px] font-bold uppercase tracking-wide">{user?.displayName || 'Atleta Invictus'}</p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="w-full max-w-[380px] space-y-3">
          <button
            onClick={handleShareLink}
            disabled={isSharingLink}
            className="w-full bg-white text-black py-4 rounded-2xl font-black text-xs uppercase tracking-[0.15em] shadow-xl flex items-center justify-center gap-3 disabled:opacity-50 cursor-pointer"
          >
            {isSharingLink ? <RefreshCw className="animate-spin" size={16} /> : <><Share2 size={16} /> Compartilhar Link</>}
          </button>

          <button
            onClick={() => handleExport('share')}
            disabled={isGenerating}
            className="w-full bg-primary text-black py-4 rounded-2xl font-black text-xs uppercase tracking-[0.15em] shadow-xl flex items-center justify-center gap-3 disabled:opacity-50 cursor-pointer"
          >
            {isGenerating ? <RefreshCw className="animate-spin" size={16} /> : <><Share2 size={16} /> Compartilhar Imagem</>}
          </button>

          <button
            onClick={() => handleExport('download')}
            disabled={isGenerating}
            className="w-full bg-surface-container-high text-on-surface py-4 rounded-2xl font-black text-xs uppercase tracking-[0.15em] border border-outline-variant/10 flex items-center justify-center gap-3 disabled:opacity-50 cursor-pointer"
          >
            {isGenerating ? <RefreshCw className="animate-spin" size={16} /> : <><Download size={16} /> Baixar Imagem</>}
          </button>

          <button
            onClick={onClose}
            className="w-full text-white/40 font-black text-[10px] uppercase tracking-[0.3em] py-3 cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
