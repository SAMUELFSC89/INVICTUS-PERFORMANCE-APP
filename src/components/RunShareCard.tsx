import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock, Download, Flame, Gauge, Image as ImageIcon, Layers3, Map, MapPin, Mountain, RefreshCw, Share2, ShieldAlert, ShieldCheck, Timer, Upload, X } from 'lucide-react';
import { toPng } from 'html-to-image';
import type { RunSession, AdvancedRunStats } from '../services/runningService';
import { formatDuration } from '../lib/runUtils';
import { cn } from '../lib/utils';
import { resolveActivityState } from '../lib/workoutData';
import { auth } from '../firebase';
import { API_CONFIG } from '../config';
import { InvictusLogo } from './InvictusLogo';
import './RunShareCard.css';

export interface ShareableSession {
  id?: string; title?: string; cardioType?: string; cardioTypeLabel?: string; km?: number; distanceKm?: number; totalDistance?: number;
  timeSeconds?: number; durationMins?: number; startTime?: string; endTime?: string; pace?: string; avgPace?: string; calories?: number;
  avgHeartRate?: number; elevationGain?: number; steps?: number; trajectory?: Array<any>; checkpoints?: Array<any>; date?: string; timestamp?: string;
  locationLabel?: string; points?: number; rankingPointsEarned?: number; photoProof?: string; photoUrl?: string; status?: string; validationStatus?: string;
  recordStatus?: string; activityMode?: 'personal' | 'competitive' | 'unresolved'; competitionReviewStatus?: string; competitionStatus?: string;
}
interface RunShareCardProps { session: RunSession | AdvancedRunStats | ShareableSession; onClose: () => void; }
type MapVariant = 'satellite' | 'outdoors';
type CompositionMode = 'map' | 'photo-map';
function hasValidLatLng(point: any): boolean { if (!point) return false; const lat = Number(point.lat ?? point.latitude ?? point.location?.lat ?? point.location?.latitude); const lng = Number(point.lng ?? point.longitude ?? point.location?.lng ?? point.location?.longitude); return Number.isFinite(lat) && Number.isFinite(lng); }
function formatPaceForCard(value: unknown): string { return String(value || '—').replace(/\/km/i, '').replace("'", ':').replace('"', '').trim(); }
function fileToDataUrl(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error || new Error('Falha ao ler a imagem.')); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Imagem inválida.')); reader.readAsDataURL(file); }); }
function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number { return Math.hypot(a.x - b.x, a.y - b.y); }

export function RunShareCard({ session: rawSession, onClose }: RunShareCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchDistanceRef = useRef<number | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [mapImages, setMapImages] = useState<Record<string, string | null>>({});
  const [mapError, setMapError] = useState(false);
  const [zoomAdjust, setZoomAdjust] = useState(0);
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const ZOOM_ADJUST_MIN = -3, ZOOM_ADJUST_MAX = 3;
  const session: any = rawSession;
  const distanceKm = Number(session.distanceKm ?? session.km ?? (session.totalDistance ? session.totalDistance / 1000 : 0));
  const durationMins = Number(session.durationMins ?? (session.timeSeconds ? session.timeSeconds / 60 : session.startTime && session.endTime ? (new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 60000 : 0));
  const durationSeconds = Number(session.timeSeconds ?? (session.startTime && session.endTime ? Math.round((new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 1000) : Math.round(durationMins * 60)));
  const duration = formatDuration(Math.max(0, durationSeconds || 0));
  const pace = session.pace || session.avgPace || (distanceKm > 0.05 && durationMins > 0 ? `${Math.floor(durationMins / distanceKm)}'${String(Math.round(((durationMins / distanceKm) % 1) * 60)).padStart(2, '0')}"/km` : null);
  const trajectory: Array<any> = Array.isArray(session.trajectory) ? session.trajectory : Array.isArray(session.checkpoints) ? session.checkpoints : [];
  const title = String(session.title || session.cardioTypeLabel || 'Corrida ao ar livre');
  const activityState = resolveActivityState(session);
  const validationState: 'completed' | 'approved' | 'pending' | 'rejected' = activityState.competitionStatus === 'approved' ? 'approved' : activityState.competitionStatus === 'pending' || activityState.competitionStatus === 'resolution_pending' ? 'pending' : activityState.competitionStatus === 'rejected' || activityState.competitionStatus === 'ineligible' ? 'rejected' : 'completed';
  const existingPhoto = session.photoProof || session.photoUrl || null;
  const hasRoute = trajectory.filter(hasValidLatLng).length >= 2;
  const hasDistance = distanceKm > 0.05;
  const isBike = title.toLowerCase().includes('bike') || session.cardioType === 'bike';
  const isSpeedActivity = isBike || ['treadmill', 'stationary_bike', 'elliptical', 'rowing', 'stair_climber'].includes(String(session.cardioType || '').toLowerCase());
  const speedKmH = distanceKm > 0.01 && durationMins > 0 ? distanceKm / (durationMins / 60) : 0;
  const distanceLabel = distanceKm.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const speedLabel = speedKmH > 0 ? speedKmH.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';
  const sharePace = formatPaceForCard(pace);
  const statusLabel = validationState === 'approved' ? 'ATIVIDADE VALIDADA' : validationState === 'pending' ? 'CONCLUÍDA · COMPETIÇÃO EM ANÁLISE' : validationState === 'rejected' ? 'CONCLUÍDA · FORA DA COMPETIÇÃO' : 'ATIVIDADE CONCLUÍDA';
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(existingPhoto);
  const [compositionMode, setCompositionMode] = useState<CompositionMode>(() => hasRoute ? 'map' : 'photo-map');
  const [mapVariant, setMapVariant] = useState<MapVariant>('satellite');
  const cacheKey = `${mapVariant}:${zoomAdjust}`;
  const currentMapImage = mapImages[cacheKey] ?? null;

  useEffect(() => {
    if (!hasRoute) return undefined;
    let cancelled = false, started = false;
    const points = trajectory.filter(hasValidLatLng);
    if (mapImages[cacheKey]) return undefined;
    const fetchMap = async (user: NonNullable<typeof auth.currentUser>) => {
      if (started || cancelled) return; started = true;
      try {
        const idToken = await user.getIdToken();
        const response = await fetch(`${API_CONFIG.baseUrl}/api/activity-map`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ trajectory: points, width: 720, height: 1280, mapType: mapVariant, zoomAdjust }) });
        if (!response.ok) throw new Error(`activity-map respondeu ${response.status}`);
        const json = await response.json(); if (cancelled) return;
        if (json.success && json.imageDataUrl) { setMapImages(current => ({ ...current, [cacheKey]: json.imageDataUrl })); setMapError(false); } else setMapError(true);
      } catch (error) { if (!cancelled) setMapError(true); console.warn('[RunShareCard] Falha ao carregar mapa:', error); }
    };
    const unsubscribe = auth.onAuthStateChanged(user => { if (user) void fetchMap(user); }); if (auth.currentUser) void fetchMap(auth.currentUser);
    return () => { cancelled = true; unsubscribe(); };
  }, [cacheKey, hasRoute, mapImages, mapVariant, trajectory, zoomAdjust]);

  const handlePhotoSelection = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return; if (!file.type.startsWith('image/')) { setFeedback('Selecione uma imagem válida.'); return; }
    try { setSelectedPhoto(await fileToDataUrl(file)); setCompositionMode('photo-map'); setCustomizerOpen(false); setFeedback(null); } catch { setFeedback('Não foi possível carregar essa foto.'); }
  };

  const handleExport = async (mode: 'download' | 'share') => {
    if (!cardRef.current) return; setFeedback(null); setIsGenerating(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 120)); const rect = cardRef.current.getBoundingClientRect(); const pixelRatio = rect.width > 0 ? Math.min(3, 1080 / rect.width) : 2;
      const dataUrl = await toPng(cardRef.current, { canvasWidth: 1080, canvasHeight: 1920, pixelRatio, cacheBust: true, backgroundColor: '#050608' });
      if (mode === 'share' && navigator.share) { try { const blob = await (await fetch(dataUrl)).blob(); const file = new File([blob], 'invictus-atividade.png', { type: 'image/png' }); if ((navigator as any).canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Invictus Performance' }); setFeedback('Imagem compartilhada com sucesso.'); return; } } catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; console.warn('[RunShareCard] Compartilhamento nativo falhou:', error); } }
      const link = document.createElement('a'); link.download = `invictus-atividade-${session.id || 'card'}.png`; link.href = dataUrl; link.click(); setFeedback('Imagem baixada com sucesso.');
    } catch (error) { console.error('[RunShareCard] Falha ao exportar:', error); setFeedback('Não foi possível gerar a imagem.'); } finally { setIsGenerating(false); }
  };

  const activePinch = () => { const points = Array.from(pointersRef.current.values()); return points.length === 2 ? distanceBetween(points[0], points[1]) : null; };
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => { if (event.pointerType !== 'touch' || !hasRoute) return; pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (pointersRef.current.size === 2) pinchDistanceRef.current = activePinch(); };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => { if (!pointersRef.current.has(event.pointerId) || !hasRoute) return; pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (pointersRef.current.size !== 2) return; const distance = activePinch(), base = pinchDistanceRef.current; if (!distance || !base) { pinchDistanceRef.current = distance; return; } const ratio = distance / base; if (ratio > 1.16) { setZoomAdjust(value => Math.min(ZOOM_ADJUST_MAX, value + 1)); pinchDistanceRef.current = distance; } else if (ratio < 0.86) { setZoomAdjust(value => Math.max(ZOOM_ADJUST_MIN, value - 1)); pinchDistanceRef.current = distance; } };
  const endPointer = (event: React.PointerEvent<HTMLDivElement>) => { pointersRef.current.delete(event.pointerId); if (pointersRef.current.size < 2) pinchDistanceRef.current = null; };

  const statMarkup = useMemo(() => <>
    <div className="share-card-activity-heading"><span className="share-card-activity-icon"><Flame size={31} strokeWidth={2.4} /></span><h1>{title.toUpperCase()}</h1><span className={cn('share-card-validation-icon', `is-${validationState}`)}>{validationState === 'approved' || validationState === 'completed' ? <ShieldCheck size={28} /> : validationState === 'pending' ? <Clock size={26} /> : <ShieldAlert size={26} />}</span></div>
    <div className="share-card-divider" /><div className="share-card-metrics"><div className="share-card-metric"><MapPin className="share-card-metric-icon" size={25} /><span className="share-card-metric-label">DISTÂNCIA</span><strong>{hasDistance ? distanceLabel : '—'} <small>KM</small></strong></div><div className="share-card-metric"><Timer className="share-card-metric-icon" size={25} /><span className="share-card-metric-label">TEMPO</span><strong>{duration}</strong></div><div className="share-card-metric"><Gauge className="share-card-metric-icon" size={25} /><span className="share-card-metric-label">{isSpeedActivity ? 'VELOCIDADE' : 'RITMO MÉDIO'}</span><strong>{isSpeedActivity ? speedLabel : sharePace} <small>{isSpeedActivity ? 'KM/H' : '/KM'}</small></strong></div></div>
    <div className={cn('share-card-status', `is-${validationState}`)}>{validationState === 'approved' || validationState === 'completed' ? <ShieldCheck size={25} /> : validationState === 'pending' ? <Clock size={24} /> : <ShieldAlert size={24} />}<span>{statusLabel}</span></div>
  </>, [distanceLabel, duration, hasDistance, isSpeedActivity, sharePace, speedLabel, statusLabel, title, validationState]);

  const sheetStyle: React.CSSProperties = { position: 'fixed', zIndex: 20, left: 10, right: 10, bottom: 'max(12px, env(safe-area-inset-bottom))', margin: '0 auto', maxWidth: 520, padding: 14, border: '1px solid rgba(255,181,37,.35)', borderRadius: 20, background: 'rgba(8,9,11,.96)', boxShadow: '0 22px 70px rgba(0,0,0,.55)', backdropFilter: 'blur(18px)' };
  const rowStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 };
  const optionStyle: React.CSSProperties = { minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 13, border: '1px solid rgba(255,255,255,.12)', background: '#111316', color: '#f4f4f4', fontSize: 12, fontWeight: 800 };

  return createPortal(<div className="share-screen" role="dialog" aria-modal="true" aria-label="Compartilhar atividade">
    <div className="share-screen-toolbar"><button type="button" onClick={onClose} className="share-icon-button" aria-label="Fechar"><X size={21} /></button><button type="button" className="share-icon-button" style={{ position: 'fixed', top: 'max(82px, calc(env(safe-area-inset-top) + 68px))', left: 12, width: 36, height: 36 }} onClick={() => setCustomizerOpen(true)} aria-label="Personalizar card"><Layers3 size={17} /></button><div className="share-screen-actions" style={{ position: 'fixed', top: 'max(82px, calc(env(safe-area-inset-top) + 68px))', right: 12, flexDirection: 'column', alignItems: 'center', gap: 7 }}><button type="button" className="share-icon-button share-icon-button--accent" style={{ width: 36, height: 36 }} onClick={() => void handleExport('share')} disabled={isGenerating} aria-label="Compartilhar imagem">{isGenerating ? <RefreshCw size={17} className="share-spin" /> : <Share2 size={17} />}</button><button type="button" className="share-icon-button" style={{ width: 36, height: 36 }} onClick={() => void handleExport('download')} disabled={isGenerating} aria-label="Baixar imagem">{isGenerating ? <RefreshCw size={17} className="share-spin" /> : <Download size={17} />}</button></div></div>
    <div className="share-card-stage" style={{ touchAction: 'none' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPointer} onPointerCancel={endPointer}><div ref={cardRef} className={cn('share-card-art', `share-card-art--${compositionMode}`)}><div className="share-card-background" aria-hidden="true">{compositionMode === 'photo-map' && selectedPhoto ? <img src={selectedPhoto} alt="" className="share-card-photo" /> : null}{compositionMode === 'map' && currentMapImage ? <img src={currentMapImage} alt="" className="share-card-map" /> : null}{compositionMode === 'photo-map' && hasRoute && currentMapImage ? <div className="share-card-route-overlay"><img src={currentMapImage} alt="" /></div> : null}<div className="share-card-vignette" />{!currentMapImage && hasRoute && compositionMode === 'map' ? <div className="share-card-loading-map">{mapError ? 'MAPA INDISPONÍVEL' : 'CARREGANDO MAPA...'}</div> : null}{compositionMode === 'photo-map' && !selectedPhoto ? <div className="share-card-photo-empty">SELECIONE UMA FOTO</div> : null}</div><div className="share-card-brand"><InvictusLogo size={64} /><div className="share-card-brand-copy"><strong>INVICTUS</strong><span>PERFORMANCE</span></div></div><div className="share-card-content">{statMarkup}</div></div></div>
    {customizerOpen ? <div style={sheetStyle} role="dialog" aria-label="Personalizar compartilhamento"><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}><div><div style={{ color: '#f6a916', fontSize: 10, fontWeight: 900, letterSpacing: '.16em' }}>PERSONALIZAR</div><strong style={{ fontSize: 16 }}>Escolha a composição</strong></div><button className="share-icon-button" style={{ width: 34, height: 34 }} onClick={() => setCustomizerOpen(false)} aria-label="Fechar opções"><X size={16} /></button></div><div style={rowStyle}><button style={{ ...optionStyle, borderColor: compositionMode === 'map' ? '#f6a916' : 'rgba(255,255,255,.12)' }} onClick={() => { if (hasRoute) { setCompositionMode('map'); setCustomizerOpen(false); } }} disabled={!hasRoute}><Map size={16} />Mapa</button><label style={{ ...optionStyle, borderColor: compositionMode === 'photo-map' ? '#f6a916' : 'rgba(255,255,255,.12)', cursor: 'pointer' }}>{selectedPhoto ? <ImageIcon size={16} /> : <Upload size={16} />}Foto + mapa<input type="file" accept="image/*" className="sr-only" onChange={handlePhotoSelection} /></label></div>{hasRoute ? <><div style={{ margin: '14px 0 8px', color: '#9d9d9d', fontSize: 10, fontWeight: 800, letterSpacing: '.12em' }}>ESTILO DO MAPA</div><div style={rowStyle}><button style={{ ...optionStyle, borderColor: mapVariant === 'satellite' ? '#f6a916' : 'rgba(255,255,255,.12)' }} onClick={() => setMapVariant('satellite')}><Map size={16} />Satélite</button><button style={{ ...optionStyle, borderColor: mapVariant === 'outdoors' ? '#f6a916' : 'rgba(255,255,255,.12)' }} onClick={() => setMapVariant('outdoors')}><Mountain size={16} />Terreno</button></div></> : null}</div> : null}
    {feedback ? <div className="share-feedback" role="status" aria-live="polite">{feedback}</div> : null}
  </div>, document.body);
}
