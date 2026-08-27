import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, useMap, Circle, Marker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, RefreshCw, AlertCircle } from 'lucide-react';
import L from 'leaflet';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// #44: mapa ao vivo do cardio ao ar livre em Challenges.tsx. Extraido de
// RunTracker.tsx (que ate 2026-08 ficava orfao, nunca importado em lugar
// nenhum) -- so a parte visual (mapa, marcador, sinal de GPS) foi reaproveitada
// aqui. A submissao continua 100% pelo activityService/endSession existente
// (ver auditoria da task #44): usar o envio proprio do RunTracker
// (runningService.addRun -> /api/running) criaria um segundo caminho de
// pontuacao paralelo ao ja usado pelo resto do app (/api/validate-activity),
// cada um com seu proprio limite semanal e sem a telemetria antifraude que o
// activityService ja coleta (sensor real, deteccao de mock location/root/
// emulador, geofence). Ver AUDITORIA-ANTIFRAUDE-CORE.md.

let DefaultIcon = L.icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

const runnerIcon = L.divIcon({
  html: `
    <div class="relative flex items-center justify-center">
      <div class="absolute w-10 h-10 bg-primary/30 rounded-full animate-ping"></div>
      <div class="relative w-8 h-8 bg-primary rounded-full flex items-center justify-center border-2 border-white shadow-lg">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
      </div>
    </div>
  `,
  className: '',
  iconSize: [32, 32],
  iconAnchor: [16, 16]
});

function ChangeView({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
}

export interface LiveTrackingPoint {
  lat: number;
  lng: number;
  accuracy?: number;
}

interface LiveTrackingMapProps {
  points: LiveTrackingPoint[];
  gpsAccuracy: number | null;
  gpsSignal: 'SEARCHING' | 'WEAK' | 'STRONG';
  permissionDenied?: boolean;
  heightPx?: number;
}

/** Mapa ao vivo com a rota percorrida ate agora. Puramente visual -- nao envia
 * nada, nao gerencia sessao. Alimentado pelos checkpoints que Challenges.tsx
 * ja coleta via activityService.addCheckpoint. */
export function LiveTrackingMap({ points, gpsAccuracy, gpsSignal, permissionDenied, heightPx = 220 }: LiveTrackingMapProps) {
  const lastPoint = points.length > 0 ? points[points.length - 1] : null;
  const center: [number, number] = lastPoint ? [lastPoint.lat, lastPoint.lng] : [0, 0];

  return (
    <div className="live-tracking-map" style={{ height: heightPx }}>
      {lastPoint && (
        <MapContainer center={center} zoom={16} className="w-full h-full z-0" zoomControl={false}>
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          {points.length >= 2 && (
            <Polyline positions={points.map(p => [p.lat, p.lng])} color="#f5a000" weight={5} opacity={0.85} />
          )}
          <Circle center={center} radius={lastPoint.accuracy || 10} pathOptions={{ color: '#f5a000', fillColor: '#f5a000', fillOpacity: 0.1 }} />
          <Marker position={center} icon={runnerIcon} />
          <ChangeView center={center} />
        </MapContainer>
      )}

      {!lastPoint && (
        <div className="live-tracking-map-empty">
          {permissionDenied ? (
            <>
              <AlertCircle size={26} />
              <span>Permissão de GPS negada. Ative a localização para ver o mapa.</span>
            </>
          ) : (
            <>
              <MapPin size={26} className={gpsAccuracy ? undefined : 'is-pulsing'} />
              <span>
                {gpsAccuracy === null
                  ? 'Buscando sinal de GPS...'
                  : gpsSignal === 'STRONG'
                    ? 'Sinal ativo — aguardando primeiro ponto.'
                    : 'Sinal instável. Vá para um local mais aberto.'}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function GpsSignalIndicator({ accuracy, signal }: { accuracy: number | null; signal: 'SEARCHING' | 'WEAK' | 'STRONG' }) {
  const level = signal === 'STRONG' ? 5 : signal === 'WEAK' ? 3 : 1;
  return (
    <div className="live-tracking-signal">
      {accuracy === null ? (
        <RefreshCw size={11} className="is-spinning" />
      ) : (
        [1, 2, 3, 4, 5].map(i => <i key={i} className={i <= level ? 'is-active' : ''} />)
      )}
      <span>{accuracy === null ? 'Buscando GPS...' : `Precisão: ${accuracy.toFixed(0)}m`}</span>
    </div>
  );
}
