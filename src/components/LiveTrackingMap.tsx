import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Polyline, useMap, Circle, Marker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { GeoJSONSource, Map as MapboxMap, Marker as MapboxMarker } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Capacitor } from '@capacitor/core';
import { AlertCircle, Box, Compass, Crosshair, Layers3, MapPin, RefreshCw } from 'lucide-react';
import L from 'leaflet';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

const defaultIcon = L.icon({ iconUrl: markerIcon, shadowUrl: markerShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
L.Marker.prototype.options.icon = defaultIcon;

const runnerIcon = L.divIcon({
  html: '<div class="invictus-map-position"><i></i></div>',
  className: '', iconSize: [34, 34], iconAnchor: [17, 17]
});
const routeStartIcon = L.divIcon({
  html: '<div class="invictus-map-route-start"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4m0 1h11l-2.5 3L16 11H5"/></svg></div>',
  className: '', iconSize: [30, 30], iconAnchor: [15, 15]
});

function ChangeView({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => { map.setView(center, map.getZoom()); }, [center, map]);
  return null;
}

export interface LiveTrackingPoint { lat: number; lng: number; accuracy?: number; }

interface LiveTrackingMapProps {
  points: LiveTrackingPoint[];
  gpsAccuracy: number | null;
  gpsSignal: 'SEARCHING' | 'WEAK' | 'STRONG';
  permissionDenied?: boolean;
  heightPx?: number;
}

function resolveMapboxToken(): string {
  const webToken = String(import.meta.env.VITE_MAPBOX_WEB_TOKEN || '').trim();
  const mobileToken = String(import.meta.env.VITE_MAPBOX_MOBILE_TOKEN || '').trim();
  return Capacitor.isNativePlatform() ? (mobileToken || webToken) : (webToken || mobileToken);
}

function routeGeoJson(points: LiveTrackingPoint[]): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.map(point => [point.lng, point.lat]) } };
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

function EmptyMapState({ permissionDenied, gpsAccuracy, gpsSignal }: Pick<LiveTrackingMapProps, 'permissionDenied' | 'gpsAccuracy' | 'gpsSignal'>) {
  return <div className="live-tracking-map-empty">{permissionDenied ? <><AlertCircle size={26} /><span>Permissão de GPS negada. Ative a localização para ver o mapa.</span></> : <><MapPin size={26} className={gpsAccuracy ? undefined : 'is-pulsing'} /><span>{gpsAccuracy === null ? 'Buscando sinal de GPS...' : gpsSignal === 'STRONG' ? 'Sinal ativo — aguardando primeiro ponto.' : 'Sinal instável. Vá para um local mais aberto.'}</span></>}</div>;
}

function LeafletFallback({ points, gpsAccuracy, gpsSignal, permissionDenied }: LiveTrackingMapProps) {
  const lastPoint = points.length > 0 ? points[points.length - 1] : null;
  const center: [number, number] = lastPoint ? [lastPoint.lat, lastPoint.lng] : [0, 0];
  return <>{lastPoint ? <MapContainer center={center} zoom={16} className="h-full w-full z-0" zoomControl={false}><TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution="&copy; OpenStreetMap contributors" />{points.length >= 2 && <><Polyline positions={points.map(p => [p.lat, p.lng])} color="#f5a000" weight={5} opacity={0.9} /><Marker position={[points[0].lat, points[0].lng]} icon={routeStartIcon} /></>}<Circle center={center} radius={lastPoint.accuracy || 10} pathOptions={{ color: '#f5a000', fillColor: '#f5a000', fillOpacity: 0.1 }} /><Marker position={center} icon={runnerIcon} /><ChangeView center={center} /></MapContainer> : <EmptyMapState permissionDenied={permissionDenied} gpsAccuracy={gpsAccuracy} gpsSignal={gpsSignal} />}</>;
}

/** Renderer visual apenas. Captura, persistencia e antifraude GPS continuam no activityService. */
export function LiveTrackingMap(props: LiveTrackingMapProps) {
  const { points, gpsAccuracy, gpsSignal, permissionDenied, heightPx = 360 } = props;
  const token = useMemo(resolveMapboxToken, []);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markerRef = useRef<MapboxMarker | null>(null);
  const startMarkerRef = useRef<MapboxMarker | null>(null);
  const mapboxModuleRef = useRef<typeof import('mapbox-gl').default | null>(null);
  const pointsRef = useRef(points);
  const [mapReady, setMapReady] = useState(false);
  const [satellite, setSatellite] = useState(true);
  const [is3d, setIs3d] = useState(true);
  const lastPoint = points.length > 0 ? points[points.length - 1] : null;
  pointsRef.current = points;

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
      map.on('error', event => console.warn('[LiveTrackingMap] Mapbox:', event.error?.message || event));
    })().catch(error => console.warn('[LiveTrackingMap] Falha ao carregar Mapbox:', error));
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
    {!lastPoint ? <EmptyMapState permissionDenied={permissionDenied} gpsAccuracy={gpsAccuracy} gpsSignal={gpsSignal} /> : token ? <>
      <div ref={containerRef} className="h-full w-full" />
      <div className="live-map-controls" aria-label="Controles do mapa">
        <button type="button" onClick={resetBearing} aria-label="Orientar mapa ao norte"><Compass /></button>
        <button type="button" onClick={toggleStyle} aria-label="Trocar camada do mapa"><Layers3 />{satellite && <small>1</small>}</button>
        <button type="button" onClick={toggle3d} aria-label="Alternar visualização 3D">{is3d ? <Box /> : <span>3D</span>}</button>
        <button type="button" onClick={recenter} aria-label="Centralizar na minha posição"><Crosshair /></button>
      </div>
      {!mapReady && <div className="live-map-loading"><RefreshCw /><span>Carregando mapa...</span></div>}
    </> : <LeafletFallback {...props} />}
  </div>;
}

export function GpsSignalIndicator({ accuracy, signal }: { accuracy: number | null; signal: 'SEARCHING' | 'WEAK' | 'STRONG' }) {
  const level = signal === 'STRONG' ? 5 : signal === 'WEAK' ? 3 : 1;
  return <div className="live-tracking-signal">{accuracy === null ? <RefreshCw size={11} className="is-spinning" /> : [1, 2, 3, 4, 5].map(i => <i key={i} className={i <= level ? 'is-active' : ''} />)}<span>{accuracy === null ? 'Buscando GPS...' : `Precisão: ${accuracy.toFixed(0)}m`}</span></div>;
}
