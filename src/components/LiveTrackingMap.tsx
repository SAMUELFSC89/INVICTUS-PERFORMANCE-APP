import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MapboxMap, Marker as MapboxMarker } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Capacitor } from '@capacitor/core';
import { AlertCircle, Box, Compass, Crosshair, Layers3, MapPin, RefreshCw } from 'lucide-react';
import { auth } from '../firebase';
import { API_CONFIG } from '../config';

export interface LiveTrackingPoint { lat: number; lng: number; accuracy?: number; }

interface LiveTrackingMapProps {
  points: LiveTrackingPoint[];
  gpsAccuracy: number | null;
  gpsSignal: 'SEARCHING' | 'WEAK' | 'STRONG';
  permissionDenied?: boolean;
  /** #168: nenhum fix de GPS chegou dentro do tempo esperado -- mostra uma saída clara em vez de "buscando..." infinito. */
  stalled?: boolean;
  onRetry?: () => void;
  heightPx?: number;
}

function resolveMapboxToken(): string {
  const webToken = String(import.meta.env.VITE_MAPBOX_WEB_TOKEN || '').trim();
  const mobileToken = String(import.meta.env.VITE_MAPBOX_MOBILE_TOKEN || '').trim();
  return Capacitor.isNativePlatform() ? (mobileToken || webToken) : (webToken || mobileToken);
}

function routeGeoJson(points: LiveTrackingPoint[]) {
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: points.map(point => [point.lng, point.lat]) } };
}

function ensureInvictusLayers(map: MapboxMap, points: LiveTrackingPoint[]) {
  if (!map.isStyleLoaded()) return;
  for (const layer of map.getStyle().layers || []) {
    if (layer.type !== 'raster' || layer.id === 'mapbox-dem') continue;
    map.setPaintProperty(layer.id, 'raster-brightness-max', 0.58);
    map.setPaintProperty(layer.id, 'raster-saturation', -0.18);
    map.setPaintProperty(layer.id, 'raster-contrast', 0.18);
  }
  if (!map.getSource('mapbox-dem')) {
    map.addSource('mapbox-dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
  }
  map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.25 });
  const data = routeGeoJson(points);
  const source = map.getSource('invictus-route') as GeoJSONSource | undefined;
  if (source) source.setData(data);
  else map.addSource('invictus-route', { type: 'geojson', data });
  if (!map.getLayer('invictus-route-glow')) {
    map.addLayer({ id: 'invictus-route-glow', type: 'line', source: 'invictus-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ff9f00', 'line-width': 16, 'line-opacity': 0.28, 'line-blur': 7 } });
  }
  if (!map.getLayer('invictus-route-core')) {
    map.addLayer({ id: 'invictus-route-core', type: 'line', source: 'invictus-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffae13', 'line-width': 5, 'line-opacity': 1 } });
  }
}

function EmptyMapState({ permissionDenied, gpsAccuracy, gpsSignal, stalled, onRetry }: Pick<LiveTrackingMapProps, 'permissionDenied' | 'gpsAccuracy' | 'gpsSignal' | 'stalled' | 'onRetry'>) {
  // #168: sem esta ramificação, um GPS que nunca consegue um fix deixava o
  // atleta preso para sempre no ícone pulsante de "Buscando sinal...", sem
  // nenhuma explicação nem saída -- exatamente o "só fica essa bolinha"
  // reportado. Depois de ~20s sem resposta (ver Challenges.tsx), mostramos
  // uma mensagem clara com um botão para reiniciar o GPS sem perder a sessão.
  if (!permissionDenied && stalled) {
    return <div className="live-tracking-map-empty">
      <AlertCircle size={26} />
      <span>Não conseguimos obter sinal de GPS. Verifique se a localização do aparelho está ativada e você está em um local aberto.</span>
      {onRetry && <button type="button" className="live-tracking-map-retry" onClick={onRetry}><RefreshCw size={14} />Tentar novamente</button>}
    </div>;
  }
  return <div className="live-tracking-map-empty">{permissionDenied ? <><AlertCircle size={26} /><span>Permissão de GPS negada. Ative a localização para ver o mapa.</span></> : <><MapPin size={26} className={gpsAccuracy ? undefined : 'is-pulsing'} /><span>{gpsAccuracy === null ? 'Buscando sinal de GPS...' : gpsSignal === 'STRONG' ? 'Sinal ativo — aguardando primeiro ponto.' : 'Sinal instável. Vá para um local mais aberto.'}</span></>}</div>;
}

/** Renderer visual apenas. Captura, persistencia e antifraude GPS continuam no activityService. */
export function LiveTrackingMap(props: LiveTrackingMapProps) {
  const { points, gpsAccuracy, gpsSignal, permissionDenied, stalled, onRetry, heightPx = 360 } = props;
  const bundledToken = useMemo(resolveMapboxToken, []);
  const [token, setToken] = useState(bundledToken);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markerRef = useRef<MapboxMarker | null>(null);
  const startMarkerRef = useRef<MapboxMarker | null>(null);
  const mapboxModuleRef = useRef<typeof import('mapbox-gl').default | null>(null);
  const pointsRef = useRef(points);
  const [mapReady, setMapReady] = useState(false);
  const [satellite, setSatellite] = useState(true);
  const [is3d, setIs3d] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const lastPoint = points.length > 0 ? points[points.length - 1] : null;
  pointsRef.current = points;

  useEffect(() => {
    if (token || !auth.currentUser) return;
    let cancelled = false;
    void auth.currentUser.getIdToken().then((idToken) => fetch(`${API_CONFIG.baseUrl}/api/mapbox-config`, {
      headers: { Authorization: `Bearer ${idToken}` }
    })).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!cancelled && response.ok && typeof payload.token === 'string') setToken(payload.token);
    }).catch((error) => console.warn('[LiveTrackingMap] Token Mapbox indisponível:', error));
    return () => { cancelled = true; };
  }, [token]);

  const addOrUpdateMarker = useCallback((map: MapboxMap, point: LiveTrackingPoint) => {
    if (!markerRef.current) {
      const mapboxModule = mapboxModuleRef.current;
      if (!mapboxModule) return;
      const element = document.createElement('div');
      element.className = 'invictus-map-position';
      element.innerHTML = '<i></i>';
      markerRef.current = new mapboxModule.Marker({ element, anchor: 'center' }).setLngLat([point.lng, point.lat]).addTo(map);
    } else markerRef.current.setLngLat([point.lng, point.lat]);
  }, []);

  const addStartMarker = useCallback((map: MapboxMap, point: LiveTrackingPoint) => {
    if (startMarkerRef.current) return;
    const mapboxModule = mapboxModuleRef.current;
    if (!mapboxModule) return;
    const element = document.createElement('div');
    element.className = 'invictus-map-route-start';
    element.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4m0 1h11l-2.5 3L16 11H5"/></svg>';
    startMarkerRef.current = new mapboxModule.Marker({ element, anchor: 'center' }).setLngLat([point.lng, point.lat]).addTo(map);
  }, []);

  useEffect(() => {
    if (!token || !containerRef.current || !lastPoint || mapRef.current) return;
    let cancelled = false;
    void (async () => {
      const module = await import('mapbox-gl');
      if (cancelled || !containerRef.current) return;
      const mapboxModule = module.default;
      mapboxModuleRef.current = mapboxModule;
      const map = new mapboxModule.Map({ accessToken: token, container: containerRef.current, style: 'mapbox://styles/mapbox/satellite-streets-v12', center: [lastPoint.lng, lastPoint.lat], zoom: 16.2, pitch: 55, bearing: 0, attributionControl: true, antialias: true });
      mapRef.current = map;
      map.dragRotate.enable();
      map.touchZoomRotate.enableRotation();
      map.on('style.load', () => { ensureInvictusLayers(map, pointsRef.current); const first = pointsRef.current[0]; const latest = pointsRef.current.at(-1); if (first) addStartMarker(map, first); if (latest) addOrUpdateMarker(map, latest); setMapReady(true); });
      map.on('error', event => { console.warn('[LiveTrackingMap] Mapbox:', event.error?.message || event); setMapError('O mapa Mapbox não pôde ser carregado agora.'); });
    })().catch(error => { console.warn('[LiveTrackingMap] Falha ao carregar Mapbox:', error); setMapError('O mapa Mapbox não pôde ser carregado agora.'); });
    return () => {
      cancelled = true;
      markerRef.current?.remove();
      markerRef.current = null;
      startMarkerRef.current?.remove();
      startMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      mapboxModuleRef.current = null;
      setMapReady(false);
    };
  }, [token, Boolean(lastPoint), addOrUpdateMarker, addStartMarker]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !lastPoint || !mapReady) return;
    ensureInvictusLayers(map, points);
    addOrUpdateMarker(map, lastPoint);
    map.easeTo({ center: [lastPoint.lng, lastPoint.lat], duration: 700, essential: true });
  }, [points, lastPoint, mapReady, addOrUpdateMarker]);

  const recenter = () => { if (mapRef.current && lastPoint) mapRef.current.easeTo({ center: [lastPoint.lng, lastPoint.lat], zoom: Math.max(mapRef.current.getZoom(), 16), duration: 650, essential: true }); };
  const toggle3d = () => { if (!mapRef.current) return; const next = !is3d; setIs3d(next); mapRef.current.easeTo({ pitch: next ? 55 : 0, duration: 500 }); };
  const toggleStyle = () => { if (!mapRef.current) return; const next = !satellite; setSatellite(next); setMapReady(false); mapRef.current.setStyle(next ? 'mapbox://styles/mapbox/satellite-streets-v12' : 'mapbox://styles/mapbox/dark-v11'); };
  const resetBearing = () => mapRef.current?.easeTo({ bearing: 0, duration: 400 });

  return <div className="live-tracking-map live-tracking-map-mapbox" style={{ height: heightPx }}>
    {!lastPoint ? <EmptyMapState permissionDenied={permissionDenied} gpsAccuracy={gpsAccuracy} gpsSignal={gpsSignal} stalled={stalled} onRetry={onRetry} /> : token && !mapError ? <>
      <div ref={containerRef} className="h-full w-full" />
      <div className="live-map-controls" aria-label="Controles do mapa">
        <button type="button" onClick={resetBearing} aria-label="Orientar mapa ao norte"><Compass /></button>
        <button type="button" onClick={toggleStyle} aria-label="Trocar camada do mapa"><Layers3 />{satellite && <small>1</small>}</button>
        <button type="button" onClick={toggle3d} aria-label="Alternar visualização 3D">{is3d ? <Box /> : <span>3D</span>}</button>
        <button type="button" onClick={recenter} aria-label="Centralizar na minha posição"><Crosshair /></button>
      </div>
      {!mapReady && <div className="live-map-loading"><RefreshCw /><span>Carregando mapa...</span></div>}
    </> : <div className="live-tracking-map-empty"><AlertCircle size={26} /><span>{mapError || 'Mapbox não configurado nesta versão. A rota continua sendo registrada com segurança.'}</span></div>}
  </div>;
}

export function GpsSignalIndicator({ accuracy, signal }: { accuracy: number | null; signal: 'SEARCHING' | 'WEAK' | 'STRONG' }) {
  const level = signal === 'STRONG' ? 5 : signal === 'WEAK' ? 3 : 1;
  return <div className="live-tracking-signal">{accuracy === null ? <RefreshCw size={11} className="is-spinning" /> : [1, 2, 3, 4, 5].map(i => <i key={i} className={i <= level ? 'is-active' : ''} />)}<span>{accuracy === null ? 'Buscando GPS...' : `Precisão: ${accuracy.toFixed(0)}m`}</span></div>;
}
