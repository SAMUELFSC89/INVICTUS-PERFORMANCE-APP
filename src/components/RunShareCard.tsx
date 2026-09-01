import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Share2, Download, X, ShieldCheck, ShieldAlert, Clock, Flame, Gauge, RefreshCw, Image as ImageIcon, Map, Upload, MapPin, Timer } from 'lucide-react';
import { toPng } from 'html-to-image';
import { RunSession, AdvancedRunStats } from '../services/runningService';
import { formatDuration } from '../lib/runUtils';
import { cn } from '../lib/utils';
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
  photoUrl?: string;
  status?: string;
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


export function RunShareCard({ session: rawSession, onClose }: RunShareCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSharingLink, setIsSharingLink] = useState(false);
  const [mapImages, setMapImages] = useState<{ satellite: string | null; roadmap: string | null }>({
    satellite: null,
    roadmap: null,
  });

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
  const trajectory: Array<any> = Array.isArray(session.trajectory)
    ? session.trajectory
    : (Array.isArray(session.checkpoints) ? session.checkpoints : []);
  const title = session.title || session.cardioTypeLabel || 'Corrida ao ar livre';
  // #214: XP e pontos de ranking sao coisas DIFERENTES -- nunca rotular XP como
  // "pontos de ranking" (bug anterior: cardio sem rankingPointsEarned caia no
  // fallback de session.points, que e XP, e exibia como se fosse ranking).
  const rawStatus = String(session.status || session.validationStatus || '').toLowerCase();
  const validationState: 'approved' | 'pending' | 'rejected' = ['validated', 'valid', 'approved', 'homologada'].includes(rawStatus)
    ? 'approved'
    : ['rejected', 'invalid', 'not_eligible', 'rejeitada', 'suspicious'].includes(rawStatus)
      ? 'rejected'
      : 'pending';
  const existingPhoto = session.photoProof || session.photoUrl || null;
  const hasRoute = trajectory.filter(hasValidLatLng).length >= 2;
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(existingPhoto);
  const [backgroundMode, setBackgroundMode] = useState<'map' | 'photo'>(() => existingPhoto && !hasRoute ? 'photo' : 'map');

  const isBike = title.toLowerCase().includes('bike') || session.cardioType === 'bike';
  const hasDistance = distanceKm > 0.05;
  const speedKmH = (distanceKm > 0.01 && durationMins > 0) ? (distanceKm / (durationMins / 60)).toFixed(1) : undefined;

  const [locationLabel, setLocationLabel] = useState<string | null>(session.locationLabel || null);

  const handlePhotoSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Selecione uma imagem válida.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setSelectedPhoto(reader.result);
        setBackgroundMode('photo');
      }
    };
    reader.readAsDataURL(file);
  };

  // Fallback temporario enquanto o Mapbox e configurado. A mesma interface de
  // estado sera alimentada pelo renderer Mapbox; assim o layout aprovado nao
  // precisa mudar quando os tokens forem adicionados.
  useEffect(() => {
    let cancelled = false;
    async function fetchMap() {
      const points = (trajectory || []).filter(hasValidLatLng);
      if (points.length < 2) return;
      const variant = backgroundMode === 'photo' ? 'roadmap' : 'satellite';
      if (mapImages[variant]) return;
      const authUser = auth.currentUser;
      if (!authUser) return;
      try {
        const idToken = await authUser.getIdToken();
        const res = await fetch(`${API_CONFIG.baseUrl}/api/activity-map`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
          body: JSON.stringify({ trajectory: points, width: 640, height: 640, mapType: variant })
        });
        const json = await res.json();
        if (cancelled) return;
        if (json.success) {
          setMapImages(current => ({ ...current, [variant]: json.imageDataUrl }));
          if (!locationLabel) setLocationLabel(json.location?.label || null);
        }
      } catch (err) {
        console.warn('[RunShareCard] Falha ao carregar mapa para o card:', err);
      }
    }
    fetchMap();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundMode, hasRoute, mapImages, trajectory, locationLabel]);

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
    const activitySummary = hasDistance ? `${distanceKm.toFixed(2)} km` : title;
    const statusText = validationState === 'approved' ? randomPhrase : validationState === 'pending' ? 'Atividade em análise' : 'Atividade registrada';
    const shareText = `${activitySummary} no INVICTUS. ${statusText}. #INVICTUS`;
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
            await navigator.share({ files: [file], title: 'Invictus Performance', text: `${hasDistance ? `${distanceKm.toFixed(2)} km` : title} no INVICTUS!` });
            return;
          }
        } catch (shareErr) {
          console.warn('[RunShareCard] Compartilhamento de imagem falhou, baixando arquivo:', shareErr);
        }
      }

      const link = document.createElement('a');
      link.download = `invictus-atividade-${session.id || 'compartilhamento'}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('[RunShareCard] Export Error:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const sharePace = String(pace)
    .replace('/km', '')
    .replace("'", ':')
    .replace('"', '')
    .trim();
  const distanceLabel = distanceKm.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const speedLabel = speedKmH
    ? Number(speedKmH).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : '—';
  // O selo aprovado usa a chama Invictus em todas as modalidades; o título e
  // a terceira métrica já fazem a diferenciação entre corrida, bike e indoor.
  const ActivityIcon = Flame;
  const currentMapImage = backgroundMode === 'photo' ? mapImages.roadmap : mapImages.satellite;
  const statusLabel = validationState === 'approved'
    ? 'ATIVIDADE VALIDADA'
    : validationState === 'pending'
      ? 'ATIVIDADE EM ANÁLISE'
      : 'ATIVIDADE NÃO PONTUOU';

  return (
    <div className="fixed inset-0 z-[300] bg-black/95 backdrop-blur-xl flex flex-col p-4 sm:p-6 animate-in fade-in duration-300 overflow-y-auto">
      <div className="flex items-center justify-between mb-6 shrink-0">
        <h2 className="text-lg sm:text-xl font-black text-white italic tracking-tighter uppercase">Compartilhar Atividade</h2>
        <button onClick={onClose} className="p-2 text-white/60 hover:text-white cursor-pointer"><X size={22} /></button>
      </div>

      <div className="flex-1 flex flex-col items-center gap-6 pb-6">
        <div className="w-full max-w-[380px] rounded-2xl border border-white/10 bg-white/[.04] p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[.18em] text-white/55">Visual do card</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => hasRoute && setBackgroundMode('map')}
              disabled={!hasRoute}
              className={cn(
                'flex min-h-11 items-center justify-center gap-1.5 rounded-xl border text-[10px] font-black uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-35',
                backgroundMode === 'map' ? 'border-primary bg-primary/15 text-primary' : 'border-white/10 bg-black/30 text-white/65'
              )}
            >
              <Map size={14} /> Mapa
            </button>
            <label className={cn(
              'flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl border text-[10px] font-black uppercase transition-colors',
              backgroundMode === 'photo' ? 'border-primary bg-primary/15 text-primary' : 'border-white/10 bg-black/30 text-white/65'
            )}>
              {selectedPhoto ? <ImageIcon size={14} /> : <Upload size={14} />}
              {selectedPhoto ? 'Foto' : 'Adicionar'}
              <input type="file" accept="image/*" className="hidden" onChange={handlePhotoSelection} />
            </label>
          </div>
          {selectedPhoto && backgroundMode !== 'photo' && (
            <button type="button" onClick={() => setBackgroundMode('photo')} className="mt-2 w-full text-center text-[10px] font-bold text-primary">
              Usar foto selecionada
            </button>
          )}
        </div>

        {/* Card exportavel 9:16 -- duas composicoes aprovadas: mapa e foto. */}
        <div
          ref={cardRef}
          className="relative aspect-[9/16] w-full max-w-[380px] overflow-hidden rounded-[22px] border border-white/25 bg-[#050505] shadow-[0_24px_80px_rgba(0,0,0,.7)]"
        >
          {backgroundMode === 'photo' && selectedPhoto ? (
            <img src={selectedPhoto} alt="Foto do atleta" className="absolute inset-0 h-full w-full object-cover" />
          ) : currentMapImage ? (
            <img src={currentMapImage} alt="Mapa da atividade" className="absolute inset-0 h-full w-full object-cover brightness-[.58] saturate-[.8] contrast-[1.15]" crossOrigin="anonymous" />
          ) : (
            <img src="/fundo-home.webp" alt="Fundo Invictus" className="absolute inset-0 h-full w-full object-cover object-center" />
          )}

          {backgroundMode === 'photo' && selectedPhoto && hasRoute && (
            <div
              className="absolute inset-y-0 right-0 w-[61%] opacity-80"
              style={{
                WebkitMaskImage: 'linear-gradient(to right, transparent 0%, rgba(0,0,0,.22) 18%, black 54%)',
                maskImage: 'linear-gradient(to right, transparent 0%, rgba(0,0,0,.22) 18%, black 54%)',
              }}
            >
              {currentMapImage && <img src={currentMapImage} alt="Rota sobre a foto" className="h-full w-full object-cover" crossOrigin="anonymous" />}
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black" />
          <div className="absolute inset-x-0 bottom-0 h-[49%] bg-gradient-to-b from-transparent via-black/88 to-black" />

          <div className="absolute left-5 top-5 flex items-center gap-2.5">
            <InvictusLogo size={34} />
            <div className="leading-none">
              <p className="font-headline text-[17px] font-black italic tracking-[.08em] text-white">INVICTUS</p>
              <p className="mt-1 text-[6px] font-black tracking-[.42em] text-[#f6aa16]">PERFORMANCE</p>
            </div>
          </div>

          <div className="absolute inset-x-5 bottom-7">
            <div className="flex items-center gap-3">
              <div className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#ffc041] to-[#ee8d05] shadow-[0_0_24px_rgba(255,169,14,.22)]">
                <ActivityIcon size={27} strokeWidth={2.4} className="text-black" />
              </div>
              <h3 className="min-w-0 font-headline text-[22px] font-black uppercase leading-none tracking-[.01em] text-white">
                {title}
              </h3>
              {validationState === 'approved'
                ? <ShieldCheck size={22} strokeWidth={2.2} className="shrink-0 text-emerald-400" />
                : validationState === 'pending'
                  ? <Clock size={21} className="shrink-0 text-amber-400" />
                  : <ShieldAlert size={21} className="shrink-0 text-rose-400" />}
            </div>

            <div className="my-4 h-px bg-gradient-to-r from-[#e89b12]/70 via-[#e89b12]/20 to-transparent" />

            <div className="grid grid-cols-3">
              <div className="border-r border-white/15 pr-3">
                <MapPin size={19} className="mb-2 text-[#f6a816]" />
                <p className="text-[10px] font-bold uppercase tracking-[.16em] text-white/55">Distância</p>
                <p className="mt-1 whitespace-nowrap font-headline text-[27px] font-black text-white">
                  {hasDistance ? distanceLabel : '—'} <span className="text-[11px] tracking-[.08em] text-[#f6a816]">KM</span>
                </p>
              </div>
              <div className="border-r border-white/15 px-3">
                <Timer size={19} className="mb-2 text-[#f6a816]" />
                <p className="text-[10px] font-bold uppercase tracking-[.16em] text-white/55">Tempo</p>
                <p className="mt-1 whitespace-nowrap font-headline text-[27px] font-black text-white">{duration}</p>
              </div>
              <div className="pl-3">
                <Gauge size={19} className="mb-2 text-[#f6a816]" />
                <p className="text-[10px] font-bold uppercase tracking-[.12em] text-white/55">{isBike ? 'Velocidade' : 'Ritmo médio'}</p>
                <p className="mt-1 whitespace-nowrap font-headline text-[27px] font-black text-white">
                  {isBike ? speedLabel : sharePace}{' '}
                  <span className="text-[10px] tracking-[.06em] text-[#f6a816]">{isBike ? 'KM/H' : '/KM'}</span>
                </p>
              </div>
            </div>

            <div className={cn(
              'mt-5 flex items-center gap-2 text-[11px] font-black uppercase tracking-[.19em]',
              validationState === 'approved' ? 'text-emerald-400' : validationState === 'pending' ? 'text-amber-400' : 'text-rose-400'
            )}>
              {validationState === 'approved'
                ? <ShieldCheck size={20} />
                : validationState === 'pending'
                  ? <Clock size={19} />
                  : <ShieldAlert size={19} />}
              <span>{statusLabel}</span>
            </div>
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
