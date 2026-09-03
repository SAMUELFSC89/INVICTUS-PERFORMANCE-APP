import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Clock,
  Download,
  Flame,
  Gauge,
  Image as ImageIcon,
  Map,
  MapPin,
  RefreshCw,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Upload,
  X,
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { RunSession, AdvancedRunStats } from '../services/runningService';
import { formatDuration } from '../lib/runUtils';
import { cn } from '../lib/utils';
import { auth } from '../firebase';
import { API_CONFIG } from '../config';
import { InvictusLogo } from './InvictusLogo';
import './RunShareCard.css';

// Aceita tanto as sessoes do rastreador quanto itens do historico. O card nao
// deve depender de um unico formato porque tambem pode ser aberto depois, no
// historico de atividades.
export interface ShareableSession {
  id?: string;
  title?: string;
  cardioType?: string;
  cardioTypeLabel?: string;
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

type BackgroundMode = 'satellite' | 'roadmap' | 'photo' | 'solid';
type MapVariant = 'satellite' | 'roadmap';

function hasValidLatLng(point: any): boolean {
  if (!point) return false;
  const lat = Number(point.lat ?? point.latitude ?? point.location?.lat ?? point.location?.latitude);
  const lng = Number(point.lng ?? point.longitude ?? point.location?.lng ?? point.location?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function formatPaceForCard(value: unknown): string {
  return String(value || '—')
    .replace(/\/km/i, '')
    .replace("'", ':')
    .replace('"', '')
    .trim();
}

export function RunShareCard({ session: rawSession, onClose }: RunShareCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [mapImages, setMapImages] = useState<Record<MapVariant, string | null>>({
    satellite: null,
    roadmap: null,
  });
  const [mapError, setMapError] = useState(false);

  const session: any = rawSession;
  const distanceKm = Number(
    session.distanceKm ?? session.km ?? (session.totalDistance ? session.totalDistance / 1000 : 0),
  );
  const durationMins = Number(
    session.durationMins ??
      (session.timeSeconds
        ? Math.round(session.timeSeconds / 60)
        : session.startTime && session.endTime
          ? Math.round((new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 60000)
          : 0),
  );
  const durationSeconds = Number(
    session.timeSeconds ??
      (session.startTime && session.endTime
        ? Math.round((new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 1000)
        : durationMins * 60),
  );
  const duration = formatDuration(durationSeconds || 0);
  const pace =
    session.pace ||
    session.avgPace ||
    (distanceKm > 0 && durationMins > 0
      ? `${Math.floor(durationMins / distanceKm)}'${String(Math.round(((durationMins / distanceKm) % 1) * 60)).padStart(2, '0')}"/km`
      : null);
  const trajectory: Array<any> = Array.isArray(session.trajectory)
    ? session.trajectory
    : Array.isArray(session.checkpoints)
      ? session.checkpoints
      : [];
  const title = String(session.title || session.cardioTypeLabel || 'Corrida ao ar livre');
  const titleUpper = title.toUpperCase();
  const rawStatus = String(session.status || session.validationStatus || '').toLowerCase();
  const validationState: 'approved' | 'pending' | 'rejected' = ['validated', 'valid', 'approved', 'homologada'].includes(rawStatus)
    ? 'approved'
    : ['rejected', 'invalid', 'not_eligible', 'rejeitada', 'suspicious'].includes(rawStatus)
      ? 'rejected'
      : 'pending';
  const existingPhoto = session.photoProof || session.photoUrl || null;
  const hasRoute = trajectory.filter(hasValidLatLng).length >= 2;
  const hasDistance = distanceKm > 0.05;
  const isBike = title.toLowerCase().includes('bike') || session.cardioType === 'bike';
  const isSpeedActivity =
    isBike ||
    ['treadmill', 'stationary_bike', 'elliptical', 'rowing', 'stair_climber'].includes(String(session.cardioType || '').toLowerCase());
  const speedKmH = distanceKm > 0.01 && durationMins > 0 ? (distanceKm / (durationMins / 60)).toFixed(1) : undefined;
  const distanceLabel = distanceKm.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const speedLabel = speedKmH
    ? Number(speedKmH).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : '—';
  const sharePace = formatPaceForCard(pace);
  const statusLabel = validationState === 'approved'
    ? 'ATIVIDADE VALIDADA'
    : validationState === 'pending'
      ? 'ATIVIDADE EM ANÁLISE'
      : 'ATIVIDADE NÃO PONTUOU';
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(existingPhoto);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(() =>
    hasRoute ? 'satellite' : existingPhoto ? 'photo' : 'solid',
  );

  const handlePhotoSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setFeedback('Selecione uma imagem válida.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setSelectedPhoto(reader.result);
        setBackgroundMode('photo');
        setFeedback(null);
      }
    };
    reader.readAsDataURL(file);
  };

  // O mapa e gerado no formato vertical do banner. Assim a rota permanece
  // visivel no card 9:16 e nao fica cortada como acontecia com o mapa quadrado.
  useEffect(() => {
    let cancelled = false;
    let requestStarted = false;
    const points = trajectory.filter(hasValidLatLng);
    if (!hasRoute || backgroundMode === 'solid') return undefined;

    const variant: MapVariant = backgroundMode === 'satellite' ? 'satellite' : 'roadmap';
    if (mapImages[variant]) return undefined;

    const fetchMap = async (authUser: NonNullable<typeof auth.currentUser>) => {
      if (cancelled || requestStarted) return;
      requestStarted = true;
      try {
        const idToken = await authUser.getIdToken();
        const response = await fetch(`${API_CONFIG.baseUrl}/api/activity-map`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ trajectory: points, width: 720, height: 1280, mapType: variant }),
        });
        if (!response.ok) throw new Error(`activity-map respondeu ${response.status}`);
        const json = await response.json();
        if (cancelled) return;
        if (json.success && json.imageDataUrl) {
          setMapImages(current => ({ ...current, [variant]: json.imageDataUrl }));
        } else {
          setMapError(true);
        }
      } catch (error) {
        if (!cancelled) setMapError(true);
        console.warn('[RunShareCard] Falha ao carregar mapa para o card:', error);
      }
    };

    // O card pode montar antes da persistencia do Firebase restaurar o usuario.
    // O listener evita deixar o mapa preso em "carregando" no iPhone/Safari.
    const unsubscribe = auth.onAuthStateChanged((authUser) => {
      if (authUser) void fetchMap(authUser);
    });
    if (auth.currentUser) void fetchMap(auth.currentUser);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [backgroundMode, hasRoute, mapImages, trajectory]);

  const handleExport = async (mode: 'download' | 'share') => {
    if (!cardRef.current) return;
    setFeedback(null);
    setIsGenerating(true);
    try {
      // pixelRatio 1 evita estourar a memoria do Safari/iPhone. O arquivo final
      // continua sendo exportado no tamanho vertical oficial 1080x1920.
      await new Promise(resolve => setTimeout(resolve, 150));
      const dataUrl = await toPng(cardRef.current, {
        canvasWidth: 1080,
        canvasHeight: 1920,
        pixelRatio: 1,
        cacheBust: true,
        backgroundColor: '#050608',
      });

      if (mode === 'share' && navigator.share) {
        try {
          const blob = await (await fetch(dataUrl)).blob();
          const file = new File([blob], 'invictus-atividade.png', { type: 'image/png' });
          if ((navigator as any).canShare?.({ files: [file] })) {
            await navigator.share({
              files: [file],
              title: 'Invictus Performance',
              text: `${hasDistance ? `${distanceKm.toFixed(2)} km` : title} no INVICTUS!`,
            });
            setFeedback('Imagem compartilhada com sucesso.');
            return;
          }
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === 'AbortError') {
            setFeedback('Compartilhamento cancelado.');
            return;
          }
          console.warn('[RunShareCard] Compartilhamento de imagem falhou, baixando arquivo:', shareError);
        }
      }

      const link = document.createElement('a');
      link.download = `invictus-atividade-${session.id || 'compartilhamento'}.png`;
      link.href = dataUrl;
      link.click();
      setFeedback('Imagem baixada com sucesso.');
    } catch (error) {
      console.error('[RunShareCard] Export Error:', error);
      setFeedback('Não foi possível gerar a imagem. Tente novamente.');
    } finally {
      setIsGenerating(false);
    }
  };

  const currentMapImage: string | null = backgroundMode === 'satellite'
    ? mapImages.satellite
    : mapImages.roadmap;
  const mapBackgroundAvailable = Boolean(currentMapImage);

  const selectBackground = (mode: BackgroundMode) => {
    if ((mode === 'satellite' || mode === 'roadmap') && !hasRoute) return;
    setFeedback(null);
    setMapError(false);
    setBackgroundMode(mode);
  };

  return createPortal(
    <div className="share-screen" role="dialog" aria-modal="true" aria-label="Compartilhar atividade">
      <div className="share-screen-toolbar">
        <button type="button" onClick={onClose} className="share-icon-button" aria-label="Fechar banner" title="Fechar">
          <X size={21} />
        </button>

        <div className="share-background-picker" aria-label="Escolha o plano de fundo">
          <button
            type="button"
            className={cn('share-background-option', backgroundMode === 'satellite' && 'is-selected', !hasRoute && 'is-disabled')}
            onClick={() => selectBackground('satellite')}
            disabled={!hasRoute}
            aria-pressed={backgroundMode === 'satellite'}
          >
            <Map size={14} />
            <span>MAPA</span>
          </button>
          <button
            type="button"
            className={cn('share-background-option', backgroundMode === 'roadmap' && 'is-selected', !hasRoute && 'is-disabled')}
            onClick={() => selectBackground('roadmap')}
            disabled={!hasRoute}
            aria-pressed={backgroundMode === 'roadmap'}
          >
            <MapPin size={14} />
            <span>MAPA ESCURO</span>
          </button>
          <label
            className={cn('share-background-option', backgroundMode === 'photo' && 'is-selected')}
            onClick={() => { setFeedback(null); setBackgroundMode('photo'); }}
          >
            {selectedPhoto ? <ImageIcon size={14} /> : <Upload size={14} />}
            <span>FOTO + MAPA</span>
            <input type="file" accept="image/*" className="sr-only" onChange={handlePhotoSelection} />
          </label>
          <button
            type="button"
            className={cn('share-background-option', backgroundMode === 'solid' && 'is-selected')}
            onClick={() => selectBackground('solid')}
            aria-pressed={backgroundMode === 'solid'}
          >
            <Flame size={14} />
            <span>SÓLIDO</span>
          </button>
        </div>

        <div className="share-screen-actions">
          <button
            type="button"
            className="share-icon-button share-icon-button--accent"
            onClick={() => void handleExport('share')}
            disabled={isGenerating}
            aria-label="Compartilhar imagem"
            title="Compartilhar imagem"
          >
            {isGenerating ? <RefreshCw size={20} className="share-spin" /> : <Share2 size={20} />}
          </button>
          <button
            type="button"
            className="share-icon-button"
            onClick={() => void handleExport('download')}
            disabled={isGenerating}
            aria-label="Baixar imagem"
            title="Baixar imagem"
          >
            {isGenerating ? <RefreshCw size={20} className="share-spin" /> : <Download size={20} />}
          </button>
        </div>
      </div>

      <div className="share-card-stage">
        <div ref={cardRef} className={cn('share-card-art', `share-card-art--${backgroundMode}`)}>
          <div className="share-card-background" aria-hidden="true">
            {backgroundMode === 'photo' && selectedPhoto ? (
              <img src={selectedPhoto} alt="" className="share-card-photo" />
            ) : null}

            {backgroundMode !== 'solid' && backgroundMode !== 'photo' && currentMapImage ? (
              <img src={currentMapImage} alt="" className="share-card-map" crossOrigin="anonymous" />
            ) : null}

            {backgroundMode === 'photo' && hasRoute && currentMapImage ? (
              <div className="share-card-route-overlay">
                <img src={currentMapImage} alt="" crossOrigin="anonymous" />
              </div>
            ) : null}

            <div className="share-card-vignette" />
            {!mapBackgroundAvailable && backgroundMode !== 'photo' && backgroundMode !== 'solid' ? (
              <div className="share-card-loading-map">{mapError ? 'MAPA INDISPONÍVEL' : 'CARREGANDO MAPA...'}</div>
            ) : null}
            {backgroundMode === 'photo' && !selectedPhoto ? (
              <div className="share-card-photo-empty">SELECIONE UMA FOTO ACIMA</div>
            ) : null}
          </div>

          <div className="share-card-brand">
            <InvictusLogo size={48} />
            <div className="share-card-brand-copy">
              <strong>INVICTUS</strong>
              <span>PERFORMANCE</span>
            </div>
          </div>

          <div className="share-card-content">
            <div className="share-card-activity-heading">
              <span className="share-card-activity-icon"><Flame size={31} strokeWidth={2.4} /></span>
              <h1>{titleUpper}</h1>
              {validationState === 'approved' ? (
                <ShieldCheck className="share-card-validation-icon is-approved" size={27} />
              ) : validationState === 'pending' ? (
                <Clock className="share-card-validation-icon is-pending" size={26} />
              ) : (
                <ShieldAlert className="share-card-validation-icon is-rejected" size={26} />
              )}
            </div>

            <div className="share-card-divider" />

            <div className="share-card-metrics">
              <div className="share-card-metric">
                <MapPin className="share-card-metric-icon" size={25} />
                <span className="share-card-metric-label">DISTÂNCIA</span>
                <strong>{hasDistance ? distanceLabel : '—'} <small>KM</small></strong>
              </div>
              <div className="share-card-metric">
                <Timer className="share-card-metric-icon" size={25} />
                <span className="share-card-metric-label">TEMPO</span>
                <strong>{duration}</strong>
              </div>
              <div className="share-card-metric">
                <Gauge className="share-card-metric-icon" size={25} />
                <span className="share-card-metric-label">{isSpeedActivity ? 'VELOCIDADE' : 'RITMO MÉDIO'}</span>
                <strong>{isSpeedActivity ? speedLabel : sharePace} <small>{isSpeedActivity ? 'KM/H' : '/KM'}</small></strong>
              </div>
            </div>

            <div className={cn('share-card-status', `is-${validationState}`)}>
              {validationState === 'approved' ? <ShieldCheck size={25} /> : validationState === 'pending' ? <Clock size={24} /> : <ShieldAlert size={24} />}
              <span>{statusLabel}</span>
            </div>
          </div>
        </div>
      </div>

      {feedback ? <div className="share-feedback" role="status" aria-live="polite">{feedback}</div> : null}
    </div>,
    document.body,
  );
}
