import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Download,
  Image as ImageIcon,
  Layers3,
  Map as MapIcon,
  RefreshCw,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { toPng } from 'html-to-image';
import type { AdvancedRunStats, RunSession } from '../services/runningService';
import { auth } from '../firebase';
import { API_CONFIG } from '../config';
import { cn } from '../lib/utils';
import { resolveShareCardMetrics } from '../lib/shareCard';
import { shareCardExportService } from '../services/shareCardExportService';
import './RunShareCard.css';

export interface ShareableSession {
  id?: string;
  title?: string;
  activityType?: string;
  cardioType?: string;
  cardioTypeLabel?: string;
  km?: number;
  distanceKm?: number;
  totalDistance?: number;
  timeSeconds?: number;
  durationMins?: number;
  startTime?: string;
  endTime?: string;
  calories?: number;
  weightKg?: number;
  points?: number;
  rankingPointsEarned?: number;
  trajectory?: unknown[];
  checkpoints?: unknown[];
  photoProof?: string;
  photoUrl?: string;
}

interface RunShareCardProps {
  session: RunSession | AdvancedRunStats | ShareableSession;
  onClose: () => void;
}

type MapVariant = 'satellite' | 'outdoors' | 'roadmap';
type CompositionMode = 'map' | 'photo-map' | 'photo-route';
type Point = { lat: number; lng: number };
type LayerTransform = { x: number; y: number; scale: number; rotation: number };
type PointerPosition = { x: number; y: number };
type PhraseId = 'movement' | 'freedom' | 'journey' | 'choice' | 'discipline';
type SelectedElement = 'map' | 'route' | 'info' | PhraseId | null;
type PhraseLayer = {
  id: PhraseId;
  text: string;
  transform: LayerTransform;
  visible: boolean;
};

const MAP_OPACITY_KEY = 'invictus:share-card:map-opacity';
const DEFAULT_MAP_TRANSFORM: LayerTransform = { x: 0, y: 0, scale: 1, rotation: 0 };
const DEFAULT_ROUTE_TRANSFORM: LayerTransform = { x: 0, y: 0, scale: 1, rotation: 0 };
const DEFAULT_INFO_TRANSFORM: LayerTransform = { x: 0, y: 0, scale: 1, rotation: 0 };
const DEFAULT_PHRASES: PhraseLayer[] = [
  { id: 'movement', text: 'MAIS MOVIMENTO\nMAIS VIDA', transform: { x: 0, y: 0, scale: 1, rotation: 0 }, visible: true },
  { id: 'freedom', text: 'DISCIPLINA\nCONSTRÓI LIBERDADE', transform: { x: 0, y: 0, scale: 1, rotation: 0 }, visible: true },
  { id: 'journey', text: 'O\nMOVIMENTO\nTE LEVA\nMAIS LONGE', transform: { x: 0, y: 0, scale: 1, rotation: 0 }, visible: true },
  { id: 'choice', text: 'PERFORMANCE\nÉ UMA ESCOLHA\nDIÁRIA', transform: { x: 0, y: 0, scale: 1, rotation: 0 }, visible: true },
  { id: 'discipline', text: 'Disciplina\nTe Leva Mais Longe', transform: { x: 0, y: 0, scale: 1, rotation: -4 }, visible: true },
];

function extractPoint(value: unknown): Point | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const location = source.location && typeof source.location === 'object'
    ? source.location as Record<string, unknown>
    : undefined;
  const lat = Number(source.lat ?? source.latitude ?? location?.lat ?? location?.latitude);
  const lng = Number(source.lng ?? source.longitude ?? location?.lng ?? location?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function normalizedRoute(points: Point[]): Array<{ x: number; y: number }> {
  if (points.length < 2) return [];
  const middleLatitude = points.reduce((total, point) => total + point.lat, 0) / points.length;
  const longitudeFactor = Math.max(0.15, Math.cos((middleLatitude * Math.PI) / 180));
  const projected = points.map((point) => ({ x: point.lng * longitudeFactor, y: -point.lat }));
  const xs = projected.map((point) => point.x);
  const ys = projected.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(maxX - minX, 0.000001);
  const height = Math.max(maxY - minY, 0.000001);
  const scale = 820 / Math.max(width, height);
  const offsetX = (1000 - width * scale) / 2;
  const offsetY = (1000 - height * scale) / 2;
  return projected.map((point) => ({
    x: offsetX + (point.x - minX) * scale,
    y: offsetY + (point.y - minY) * scale,
  }));
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler a imagem.'));
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Imagem inválida.'));
    reader.readAsDataURL(file);
  });
}

async function waitForCardAssets(node: HTMLElement): Promise<void> {
  try { await document.fonts?.ready; } catch { /* best effort */ }
  const images = Array.from(node.querySelectorAll('img'));
  await Promise.all(images.map(async (image) => {
    if (!image.complete) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        image.addEventListener('load', done, { once: true });
        image.addEventListener('error', done, { once: true });
      });
    }
    try { await image.decode?.(); } catch { /* already decoded */ }
  }));
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function pointerDistance(points: PointerPosition[]): number {
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

function pointerAngle(points: PointerPosition[]): number {
  return Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x) * (180 / Math.PI);
}

function clampScale(value: number, min = 0.55, max = 2.4): number {
  return Math.max(min, Math.min(max, value));
}

function layerStyle(transform: LayerTransform): CSSProperties {
  return {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale}) rotate(${transform.rotation}deg)`,
  };
}

function savedMapOpacity(): number {
  if (typeof window === 'undefined') return 0.5;
  const stored = Number(window.localStorage.getItem(MAP_OPACITY_KEY));
  return Number.isFinite(stored) ? Math.max(0.1, Math.min(1, stored)) : 0.5;
}

/**
 * #240 (decisão do usuário, 18/09/2026): a imagem do mapa que sai no card
 * compartilhado não deve expor nome de rua/bairro/POI, por privacidade --
 * quem vê o card não precisa saber onde o atleta mora ou treina. O backend
 * tem um estilo satélite sem rótulos (satellite-plain -> satellite-v9);
 * usamos ele sempre que o usuário escolhe "Satélite" no editor, mantendo o
 * mesmo estado/classe CSS 'satellite' (só o mapType real enviado ao backend
 * muda). "Navegação" e o padrão "roadmap" ainda não têm uma versão sem
 * rótulo publicada no Mapbox deste projeto -- ver nota para o usuário.
 */
function mapRequestType(variant: MapVariant): string {
  return variant === 'satellite' ? 'satellite-plain' : variant;
}

function isPhraseId(value: SelectedElement): value is PhraseId {
  return value === 'movement' || value === 'freedom' || value === 'journey' || value === 'choice' || value === 'discipline';
}

function RouteLayer({ points, transform }: { points: Array<{ x: number; y: number }>; transform: LayerTransform }) {
  if (points.length < 2) return null;
  const start = points[0];
  const finish = points[points.length - 1];
  return (
    <div className="share-card-route-layer" style={layerStyle(transform)} aria-hidden="true">
      <svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet">
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(' ')}
          fill="none"
          stroke="#f3b324"
          strokeWidth="13"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <g className="share-route-start-marker">
          <circle cx={start.x} cy={start.y} r="31" fill="#11100c" stroke="#f3b324" strokeWidth="8" />
          <circle cx={start.x} cy={start.y} r="15" fill="#fff9df" />
        </g>
        <g className="share-route-finish-marker">
          <circle cx={finish.x} cy={finish.y} r="38" fill="#080808" stroke="#f3b324" strokeWidth="7" />
          <image href="/capacete.webp" x={finish.x - 17} y={finish.y - 22} width="34" height="44" preserveAspectRatio="xMidYMid meet" />
        </g>
      </svg>
    </div>
  );
}

export function RunShareCard({ session: rawSession, onClose }: RunShareCardProps) {
  const session = rawSession as ShareableSession;
  const cardRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const contentPointersRef = useRef(new Map<number, PointerPosition>());
  const infoPointersRef = useRef(new Map<number, PointerPosition>());
  const phrasePointersRef = useRef(new Map<PhraseId, Map<number, PointerPosition>>());
  const phraseGestureRef = useRef(new Map<PhraseId, { transform: LayerTransform; startX: number; startY: number; distance?: number }>());
  const trashArmedRef = useRef<PhraseId | null>(null);
  const preferencesHydratedRef = useRef(false);
  const contentGestureRef = useRef<{
    transform: LayerTransform;
    startX: number;
    startY: number;
    distance?: number;
    angle?: number;
  } | null>(null);
  const infoGestureRef = useRef<{
    transform: LayerTransform;
    startX: number;
    startY: number;
    distance?: number;
  } | null>(null);

  const distanceKm = Math.max(0, Number(session.distanceKm ?? session.km ?? (session.totalDistance ? session.totalDistance / 1000 : 0)) || 0);
  const durationSeconds = Math.max(0, Math.round(Number(
    session.timeSeconds
      ?? (session.durationMins ? session.durationMins * 60 : undefined)
      ?? (session.startTime && session.endTime
        ? (new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 1000
        : 0),
  ) || 0));
  const title = String(session.title || session.cardioTypeLabel || 'Atividade').trim();
  const rawTrajectory = Array.isArray(session.trajectory)
    ? session.trajectory
    : Array.isArray(session.checkpoints) ? session.checkpoints : [];
  const routePoints = useMemo(
    () => rawTrajectory.map(extractPoint).filter((point): point is Point => Boolean(point)),
    [rawTrajectory],
  );
  const routeSvgPoints = useMemo(() => normalizedRoute(routePoints), [routePoints]);
  const hasRoute = routePoints.length >= 2;
  const existingPhoto = session.photoProof || session.photoUrl || null;
  const metrics = useMemo(() => resolveShareCardMetrics({
    distanceKm,
    durationSeconds,
    calories: session.calories,
    weightKg: session.weightKg,
    points: session.rankingPointsEarned ?? session.points,
    activityType: session.activityType,
  }), [distanceKm, durationSeconds, session.activityType, session.calories, session.points, session.rankingPointsEarned, session.weightKg]);

  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(existingPhoto);
  // Padrão (decisão do usuário, 18/09/2026): assim que há foto + rota, o card
  // já nasce em "foto + mapa" com o estilo "roadmap" (mapa meio transparente
  // por baixo, rota por cima, igual à referência aprovada). Sem foto, o modo
  // "Mapa" continua abrindo em satélite, como sempre foi.
  const [compositionMode, setCompositionMode] = useState<CompositionMode>(() => existingPhoto ? 'photo-map' : 'map');
  const [mapVariant, setMapVariant] = useState<MapVariant>(() => existingPhoto ? 'roadmap' : 'satellite');
  const [mapImages, setMapImages] = useState<Record<string, string | null>>({});
  const [mapError, setMapError] = useState(false);
  const [mapTransform, setMapTransform] = useState(DEFAULT_MAP_TRANSFORM);
  const [routeTransform, setRouteTransform] = useState(DEFAULT_ROUTE_TRANSFORM);
  const [infoTransform, setInfoTransform] = useState(DEFAULT_INFO_TRANSFORM);
  const [mapOpacity, setMapOpacity] = useState(savedMapOpacity);
  const [phrases, setPhrases] = useState<PhraseLayer[]>(() => DEFAULT_PHRASES.map((phrase) => ({ ...phrase, transform: { ...phrase.transform } })));
  const [selectedPhraseId, setSelectedPhraseId] = useState<PhraseId | null>(null);
  const [selectedElement, setSelectedElement] = useState<SelectedElement>(null);
  const [draggingPhraseId, setDraggingPhraseId] = useState<PhraseId | null>(null);
  const [trashArmedPhraseId, setTrashArmedPhraseId] = useState<PhraseId | null>(null);
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const mapCacheKey = mapVariant;
  const currentMapImage = mapImages[mapCacheKey] ?? null;
  const layoutVariant = compositionMode === 'map' ? `${compositionMode}-${mapVariant}` : compositionMode;
  const preferencesKey = `invictus:share-card-layout:v2:${auth.currentUser?.uid || 'local'}:${layoutVariant}`;

  useEffect(() => {
    preferencesHydratedRef.current = false;
    setInfoTransform(DEFAULT_INFO_TRANSFORM);
    setPhrases(DEFAULT_PHRASES.map((phrase) => ({ ...phrase, transform: { ...phrase.transform } })));
    try {
      const raw = localStorage.getItem(preferencesKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.infoTransform) setInfoTransform({ ...DEFAULT_INFO_TRANSFORM, ...parsed.infoTransform });
        if (Array.isArray(parsed?.phrases)) {
          setPhrases(DEFAULT_PHRASES.map((fallback) => {
            const saved = parsed.phrases.find((phrase: PhraseLayer) => phrase?.id === fallback.id);
            return saved
              ? { ...fallback, visible: saved.visible !== false, transform: { ...fallback.transform, ...saved.transform } }
              : { ...fallback, transform: { ...fallback.transform } };
          }));
        }
      }
    } catch {
      // Preferências são best effort; nunca bloqueiam o editor.
    } finally {
      queueMicrotask(() => { preferencesHydratedRef.current = true; });
    }
  }, [preferencesKey]);

  useEffect(() => {
    if (!preferencesHydratedRef.current) return;
    try {
      localStorage.setItem(preferencesKey, JSON.stringify({ infoTransform, phrases }));
    } catch {
      // Armazenamento indisponível não impede compartilhar.
    }
  }, [infoTransform, phrases, preferencesKey]);

  useEffect(() => {
    try { localStorage.setItem(MAP_OPACITY_KEY, String(mapOpacity)); } catch { /* best effort */ }
  }, [mapOpacity]);

  useEffect(() => {
    if (!hasRoute || compositionMode === 'photo-route' || mapImages[mapCacheKey]) return undefined;
    let cancelled = false;
    let started = false;

    const fetchMap = async (user: NonNullable<typeof auth.currentUser>) => {
      if (started || cancelled) return;
      started = true;
      try {
        const idToken = await user.getIdToken();
        const response = await fetch(`${API_CONFIG.baseUrl}/api/activity-map`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({
            trajectory: routePoints,
            width: 720,
            height: 1280,
            mapType: mapRequestType(mapVariant),
            zoomAdjust: -0.75,
          }),
        });
        if (!response.ok) throw new Error(`activity-map respondeu ${response.status}`);
        const json = await response.json();
        if (cancelled) return;
        if (json.success && json.imageDataUrl) {
          setMapImages((current) => ({ ...current, [mapCacheKey]: json.imageDataUrl }));
          setMapError(false);
        } else {
          setMapError(true);
        }
      } catch (error) {
        if (!cancelled) setMapError(true);
        console.warn('[RunShareCard] Falha ao carregar mapa:', error);
      }
    };

    const unsubscribe = auth.onAuthStateChanged((user) => { if (user) void fetchMap(user); });
    if (auth.currentUser) void fetchMap(auth.currentUser);
    return () => { cancelled = true; unsubscribe(); };
  }, [compositionMode, hasRoute, mapCacheKey, mapImages, mapVariant, routePoints]);

  const currentContentTransform = compositionMode === 'photo-route' ? routeTransform : mapTransform;
  const setCurrentContentTransform = useCallback((next: LayerTransform) => {
    if (compositionMode === 'photo-route') setRouteTransform(next);
    else setMapTransform(next);
  }, [compositionMode]);

  const startContentGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!hasRoute) return;
    setSelectedElement(compositionMode === 'photo-route' ? 'route' : 'map');
    setSelectedPhraseId(null);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    contentPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pointers = Array.from(contentPointersRef.current.values());
    contentGestureRef.current = {
      transform: currentContentTransform,
      startX: event.clientX,
      startY: event.clientY,
      ...(pointers.length === 2 ? { distance: pointerDistance(pointers), angle: pointerAngle(pointers) } : {}),
    };
  };

  const moveContentGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!contentPointersRef.current.has(event.pointerId) || !contentGestureRef.current) return;
    contentPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pointers = Array.from(contentPointersRef.current.values());
    const start = contentGestureRef.current;
    if (pointers.length === 1) {
      setCurrentContentTransform({
        ...start.transform,
        x: start.transform.x + event.clientX - start.startX,
        y: start.transform.y + event.clientY - start.startY,
      });
      return;
    }
    if (pointers.length === 2 && start.distance && start.angle !== undefined) {
      setCurrentContentTransform({
        ...start.transform,
        scale: clampScale(start.transform.scale * (pointerDistance(pointers) / start.distance), 0.7, 2.2),
        rotation: start.transform.rotation + pointerAngle(pointers) - start.angle,
      });
    }
  };

  const endContentGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    contentPointersRef.current.delete(event.pointerId);
    if (contentPointersRef.current.size === 0) {
      contentGestureRef.current = null;
      return;
    }
    const remaining = Array.from(contentPointersRef.current.values())[0];
    contentGestureRef.current = {
      transform: compositionMode === 'photo-route' ? routeTransform : mapTransform,
      startX: remaining.x,
      startY: remaining.y,
    };
  };

  const startInfoGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    setSelectedElement('info');
    setSelectedPhraseId(null);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    infoPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pointers = Array.from(infoPointersRef.current.values());
    infoGestureRef.current = {
      transform: infoTransform,
      startX: event.clientX,
      startY: event.clientY,
      ...(pointers.length === 2 ? { distance: pointerDistance(pointers) } : {}),
    };
  };

  const moveInfoGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!infoPointersRef.current.has(event.pointerId) || !infoGestureRef.current) return;
    infoPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pointers = Array.from(infoPointersRef.current.values());
    const start = infoGestureRef.current;
    if (pointers.length === 1) {
      setInfoTransform({
        ...start.transform,
        x: start.transform.x + event.clientX - start.startX,
        y: start.transform.y + event.clientY - start.startY,
      });
      return;
    }
    if (pointers.length === 2 && start.distance) {
      setInfoTransform({
        ...start.transform,
        scale: clampScale(start.transform.scale * (pointerDistance(pointers) / start.distance), 0.55, 1.4),
      });
    }
  };

  const endInfoGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    infoPointersRef.current.delete(event.pointerId);
    if (infoPointersRef.current.size === 0) {
      infoGestureRef.current = null;
      return;
    }
    const remaining = Array.from(infoPointersRef.current.values())[0];
    infoGestureRef.current = { transform: infoTransform, startX: remaining.x, startY: remaining.y };
  };

  const updatePhrase = useCallback((id: PhraseId, updater: (phrase: PhraseLayer) => PhraseLayer) => {
    setPhrases((current) => current.map((phrase) => phrase.id === id ? updater(phrase) : phrase));
  }, []);

  const setTrashArmed = useCallback((id: PhraseId | null) => {
    trashArmedRef.current = id;
    setTrashArmedPhraseId(id);
  }, []);

  const startPhraseGesture = (id: PhraseId, event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    setSelectedPhraseId(id);
    setSelectedElement(id);
    setDraggingPhraseId(id);
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const pointerMap = phrasePointersRef.current.get(id) || new Map<number, PointerPosition>();
    pointerMap.set(event.pointerId, { x: event.clientX, y: event.clientY });
    phrasePointersRef.current.set(id, pointerMap);

    const phrase = phrases.find((candidate) => candidate.id === id);
    if (!phrase) return;
    const pointers = Array.from(pointerMap.values());
    phraseGestureRef.current.set(id, {
      transform: phrase.transform,
      startX: event.clientX,
      startY: event.clientY,
      ...(pointers.length === 2 ? { distance: pointerDistance(pointers) } : {}),
    });
  };

  const movePhraseGesture = (id: PhraseId, event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const pointerMap = phrasePointersRef.current.get(id);
    const gesture = phraseGestureRef.current.get(id);
    if (!pointerMap?.has(event.pointerId) || !gesture) return;
    pointerMap.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pointers = Array.from(pointerMap.values());

    if (pointers.length === 1) {
      updatePhrase(id, (phrase) => ({
        ...phrase,
        transform: {
          ...gesture.transform,
          x: gesture.transform.x + event.clientX - gesture.startX,
          y: gesture.transform.y + event.clientY - gesture.startY,
        },
      }));
      const rect = cardRef.current?.getBoundingClientRect();
      setTrashArmed(rect && event.clientY >= rect.bottom - rect.height * 0.14 ? id : null);
      return;
    }

    if (pointers.length === 2 && gesture.distance) {
      updatePhrase(id, (phrase) => ({
        ...phrase,
        transform: {
          ...gesture.transform,
          scale: clampScale(gesture.transform.scale * (pointerDistance(pointers) / gesture.distance), 0.5, 1.7),
        },
      }));
      setTrashArmed(null);
    }
  };

  const endPhraseGesture = (id: PhraseId, event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const pointerMap = phrasePointersRef.current.get(id);
    pointerMap?.delete(event.pointerId);
    if (!pointerMap || pointerMap.size === 0) {
      if (trashArmedRef.current === id) {
        updatePhrase(id, (phrase) => ({ ...phrase, visible: false }));
        setSelectedElement(null);
        setSelectedPhraseId(null);
      }
      phrasePointersRef.current.delete(id);
      phraseGestureRef.current.delete(id);
      setDraggingPhraseId(null);
      setTrashArmed(null);
      return;
    }
    const remaining = Array.from(pointerMap.values())[0];
    const phrase = phrases.find((candidate) => candidate.id === id);
    if (phrase) phraseGestureRef.current.set(id, { transform: phrase.transform, startX: remaining.x, startY: remaining.y });
  };

  const restorePhrases = () => {
    setPhrases(DEFAULT_PHRASES.map((phrase) => ({ ...phrase, transform: { ...phrase.transform }, visible: true })));
    setSelectedPhraseId(null);
    setSelectedElement(null);
    setDraggingPhraseId(null);
    setTrashArmed(null);
  };

  const handlePhotoSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setFeedback('Selecione uma imagem válida.');
      return;
    }
    try {
      setSelectedPhoto(await fileToDataUrl(file));
      setCompositionMode('photo-map');
      setMapVariant('roadmap');
      setSelectedElement('map');
      setCustomizerOpen(false);
      setFeedback(null);
    } catch {
      setFeedback('Não foi possível carregar essa foto.');
    }
  };

  const usePhotoMap = () => {
    if (selectedPhoto) {
      setCompositionMode('photo-map');
      setMapVariant('roadmap');
      setSelectedElement('map');
      setCustomizerOpen(false);
      return;
    }
    photoInputRef.current?.click();
  };

  const removeMapFromPhoto = () => {
    if (!selectedPhoto) return;
    setCompositionMode('photo-route');
    setSelectedElement('route');
    setFeedback(null);
  };

  const removeSelectedPhrase = (id: PhraseId) => {
    updatePhrase(id, (phrase) => ({ ...phrase, visible: false }));
    setSelectedElement(null);
    setSelectedPhraseId(null);
  };

  const handleExport = async (mode: 'download' | 'share') => {
    if (!cardRef.current) return;
    setFeedback(null);
    setIsGenerating(true);
    try {
      await waitForCardAssets(cardRef.current);
      const rect = cardRef.current.getBoundingClientRect();
      if (!rect.width || !rect.height) throw new Error('Card sem dimensão para exportação.');
      const pixelRatio = Math.max(1, Math.min(6, 2160 / rect.width, 3840 / rect.height));
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio,
        cacheBust: true,
        backgroundColor: '#050608',
        skipAutoScale: true,
      });
      const fileName = `invictus-atividade-${session.id || 'card'}.png`;
      if (mode === 'share') {
        const result = await shareCardExportService.share(dataUrl, fileName);
        setFeedback(result === 'shared' ? 'Imagem pronta para compartilhar.' : 'Compartilhamento indisponível; imagem baixada.');
      } else {
        await shareCardExportService.save(dataUrl, fileName);
        setFeedback('Imagem salva em alta qualidade.');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('[RunShareCard] Falha ao exportar:', error);
      setFeedback('Não foi possível gerar a imagem. Tente novamente.');
    } finally {
      setIsGenerating(false);
    }
  };

  const resetContent = () => {
    if (compositionMode === 'photo-route') setRouteTransform(DEFAULT_ROUTE_TRANSFORM);
    else setMapTransform(DEFAULT_MAP_TRANSFORM);
  };

  const mapLayerClass = compositionMode === 'photo-map'
    ? 'share-card-map-layer share-card-map-layer--inset'
    : 'share-card-map-layer share-card-map-layer--full';
  const selectedPhrase = isPhraseId(selectedElement)
    ? phrases.find((phrase) => phrase.id === selectedElement) || null
    : null;

  return createPortal(
    <div className="share-screen" role="dialog" aria-modal="true" aria-label="Editor do card da atividade">
      <div className="share-screen-toolbar">
        <button type="button" onClick={onClose} className="share-icon-button" aria-label="Fechar editor"><X size={21} /></button>
        <button type="button" onClick={() => { setSelectedElement(null); setCustomizerOpen(true); }} className="share-icon-button" aria-label="Escolher composição"><Layers3 size={19} /></button>
        <div className="share-screen-actions">
          <button type="button" onClick={() => void handleExport('share')} className="share-icon-button share-icon-button--accent" disabled={isGenerating} aria-label="Compartilhar imagem">
            {isGenerating ? <RefreshCw size={19} className="share-spin" /> : <Share2 size={19} />}
          </button>
          <button type="button" onClick={() => void handleExport('download')} className="share-icon-button" disabled={isGenerating} aria-label="Salvar imagem">
            {isGenerating ? <RefreshCw size={19} className="share-spin" /> : <Download size={19} />}
          </button>
        </div>
      </div>

      <div className="share-card-stage" onPointerDown={startContentGesture} onPointerMove={moveContentGesture} onPointerUp={endContentGesture} onPointerCancel={endContentGesture}>
        <div ref={cardRef} className={cn('share-card-art', `share-card-art--${compositionMode}`, `share-card-art--${mapVariant}`, isGenerating && 'is-exporting')}>
          <div className="share-card-background" aria-hidden="true">
            {(compositionMode === 'photo-map' || compositionMode === 'photo-route') && selectedPhoto ? <img src={selectedPhoto} alt="" className="share-card-photo" /> : null}
            {compositionMode !== 'photo-route' && currentMapImage ? (
              <div
                className={cn(mapLayerClass, selectedElement === 'map' && 'is-selected')}
                style={{ ...layerStyle(mapTransform), opacity: compositionMode === 'photo-map' ? mapOpacity : 1 }}
              >
                <img src={currentMapImage} alt="" />
              </div>
            ) : null}
            {compositionMode === 'photo-route' ? <RouteLayer points={routeSvgPoints} transform={routeTransform} /> : null}
            {!currentMapImage && compositionMode !== 'photo-route' ? <div className="share-card-empty-state">{mapError ? 'Não foi possível carregar o mapa.' : hasRoute ? 'Preparando mapa…' : 'Esta atividade não possui rota GPS.'}</div> : null}
            {!selectedPhoto && compositionMode !== 'map' ? <div className="share-card-empty-state">Escolha uma foto para esta composição.</div> : null}
            <div className="share-card-vignette" />
          </div>

          <div
            className={cn('share-card-info-block', selectedElement === 'info' && 'is-selected')}
            style={layerStyle(infoTransform)}
            onPointerDown={startInfoGesture}
            onPointerMove={moveInfoGesture}
            onPointerUp={endInfoGesture}
            onPointerCancel={endInfoGesture}
          >
            <div className="share-card-brand">
              <strong>INVICTUS</strong>
              <span>PERFORMANCE</span>
            </div>
            <div className="share-card-activity-name"><small>{title.toUpperCase()}</small></div>
            <div className="share-card-metrics">
              {metrics.map((metric, index) => (
                <div className={cn('share-card-metric', `share-card-metric--${index}`)} key={metric.label}>
                  <div className="share-card-metric-icon" aria-hidden="true"><span /></div>
                  <div className="share-card-metric-copy">
                    <span>{metric.label}</span>
                    <strong>{metric.value}{metric.unit ? <small> {metric.unit}</small> : null}</strong>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {phrases.filter((phrase) => phrase.visible).map((phrase) => (
            <div
              key={phrase.id}
              className={cn('share-card-phrase', `share-card-phrase--${phrase.id}`, selectedPhraseId === phrase.id && 'is-selected')}
              style={layerStyle(phrase.transform)}
              onPointerDown={(event) => startPhraseGesture(phrase.id, event)}
              onPointerMove={(event) => movePhraseGesture(phrase.id, event)}
              onPointerUp={(event) => endPhraseGesture(phrase.id, event)}
              onPointerCancel={(event) => endPhraseGesture(phrase.id, event)}
              aria-label={`Editar frase: ${phrase.text.replace(/\n/g, ' ')}`}
            >
              {phrase.text}
            </div>
          ))}

          {draggingPhraseId ? (
            <div className={cn('share-card-trash-zone', trashArmedPhraseId === draggingPhraseId && 'is-armed')} aria-hidden="true">
              <Trash2 size={16} />
              <span>SOLTE PARA REMOVER</span>
            </div>
          ) : null}
        </div>

        {selectedElement && !customizerOpen ? (
          <div className="share-context-controls" onPointerDown={(event) => event.stopPropagation()}>
            {selectedElement === 'map' ? (
              <>
                {compositionMode === 'photo-map' ? (
                  <label className="share-context-slider">
                    <span>Opacidade do mapa <b>{Math.round(mapOpacity * 100)}%</b></span>
                    <input type="range" min="10" max="100" value={Math.round(mapOpacity * 100)} onChange={(event) => setMapOpacity(Number(event.target.value) / 100)} />
                  </label>
                ) : (
                  <button type="button" className="share-context-action" onClick={() => setMapTransform(DEFAULT_MAP_TRANSFORM)}>Recentrar mapa</button>
                )}
                {compositionMode === 'photo-map' && selectedPhoto ? (
                  <button type="button" className="share-context-icon share-context-icon--danger" onClick={removeMapFromPhoto} aria-label="Remover mapa e manter foto com rota"><X size={18} /></button>
                ) : null}
              </>
            ) : null}

            {selectedElement === 'route' ? (
              <>
                <label className="share-context-slider">
                  <span>Tamanho do traçado</span>
                  <input type="range" min="70" max="220" value={Math.round(routeTransform.scale * 100)} onChange={(event) => setRouteTransform((current) => ({ ...current, scale: Number(event.target.value) / 100 }))} />
                </label>
                <label className="share-context-slider">
                  <span>Ângulo do traçado</span>
                  <input type="range" min="-35" max="35" value={Math.round(routeTransform.rotation)} onChange={(event) => setRouteTransform((current) => ({ ...current, rotation: Number(event.target.value) }))} />
                </label>
                <button type="button" className="share-context-action" onClick={() => setRouteTransform(DEFAULT_ROUTE_TRANSFORM)}>Recentrar</button>
              </>
            ) : null}

            {selectedElement === 'info' ? (
              <>
                <label className="share-context-slider">
                  <span>Tamanho das informações</span>
                  <input type="range" min="55" max="140" value={Math.round(infoTransform.scale * 100)} onChange={(event) => setInfoTransform((current) => ({ ...current, scale: Number(event.target.value) / 100 }))} />
                </label>
                <button type="button" className="share-context-action" onClick={() => setInfoTransform(DEFAULT_INFO_TRANSFORM)}>Recentrar</button>
              </>
            ) : null}

            {selectedPhrase ? (
              <>
                <label className="share-context-slider">
                  <span>Tamanho da frase</span>
                  <input type="range" min="50" max="170" value={Math.round(selectedPhrase.transform.scale * 100)} onChange={(event) => updatePhrase(selectedPhrase.id, (phrase) => ({ ...phrase, transform: { ...phrase.transform, scale: Number(event.target.value) / 100 } }))} />
                </label>
                <button type="button" className="share-context-icon share-context-icon--danger" onClick={() => removeSelectedPhrase(selectedPhrase.id)} aria-label="Remover frase"><X size={18} /></button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="share-card-notices">
        <p className="share-card-gesture-hint">Toque no elemento para editar. Arraste para mover e use pinça para redimensionar.</p>
        {feedback ? <p className="share-card-feedback" role="status">{feedback}</p> : null}
      </div>

      {customizerOpen ? (
        <div className="share-customizer-backdrop" onClick={() => setCustomizerOpen(false)}>
          <section className="share-customizer share-customizer--compact" onClick={(event) => event.stopPropagation()} aria-label="Composição do card">
            <header><strong>COMPOSIÇÃO</strong><button type="button" onClick={() => setCustomizerOpen(false)} aria-label="Fechar opções"><X size={18} /></button></header>
            <div className="share-customizer-modes share-customizer-modes--two">
              <button type="button" className={compositionMode === 'map' ? 'is-active' : ''} onClick={() => { setCompositionMode('map'); setSelectedElement('map'); setCustomizerOpen(false); setMapVariant((current) => current === 'roadmap' ? 'satellite' : current); }}><MapIcon size={18} /><span>Mapa</span></button>
              <button type="button" className={compositionMode !== 'map' ? 'is-active' : ''} onClick={usePhotoMap}><ImageIcon size={18} /><span>Foto + mapa</span></button>
            </div>
            <input ref={photoInputRef} className="share-hidden-file-input" type="file" accept="image/*" onChange={(event) => void handlePhotoSelection(event)} />

            {compositionMode !== 'photo-route' ? (
              <div className="share-customizer-row">
                <span>Estilo do mapa</span>
                <div>
                  <button type="button" className={mapVariant === 'satellite' ? 'is-active' : ''} onClick={() => setMapVariant('satellite')}>Satélite</button>
                  <button type="button" className={mapVariant === 'outdoors' ? 'is-active' : ''} onClick={() => setMapVariant('outdoors')}>Navegação</button>
                </div>
              </div>
            ) : null}

            <div className="share-customizer-reset share-customizer-reset--single">
              <button type="button" onClick={restorePhrases}>Restaurar frases</button>
              <button type="button" onClick={resetContent}>Recentrar conteúdo</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
