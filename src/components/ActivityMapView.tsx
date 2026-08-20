import React, { useEffect, useState } from 'react';
import { MapPin, EyeOff } from 'lucide-react';
import { auth } from '../firebase';
import { API_CONFIG } from '../config';

// #202/#204: componente compartilhado que busca e exibe o mapa real da rota GPS
// (via /api/activity-map, que faz o proxy server-side do Google Static Maps --
// a chave nunca chega ao cliente) tanto na tela de detalhe do cardio quanto no
// card de compartilhamento. O proprio Google Static Maps enquadra automaticamente
// a rota inteira dentro da imagem quando center/zoom nao sao informados.

export interface ActivityMapPoint {
  lat: number;
  lng: number;
}

interface ActivityMapViewProps {
  trajectory?: ActivityMapPoint[] | null;
  heightPx?: number;
  className?: string;
  showPrivacyBadge?: boolean;
}

export function ActivityMapView({ trajectory, heightPx = 320, className = '', showPrivacyBadge = true }: ActivityMapViewProps) {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [failed, setFailed] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchMap() {
      const points = (trajectory || []).filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
      if (points.length < 2) {
        if (!cancelled) { setLoading(false); setFailed(true); }
        return;
      }
      const user = auth.currentUser;
      if (!user) {
        if (!cancelled) { setLoading(false); setFailed(true); }
        return;
      }
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(`${API_CONFIG.baseUrl}/api/activity-map`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
          body: JSON.stringify({ trajectory: points, width: 640, height: Math.round(heightPx) })
        });
        const json = await res.json();
        if (cancelled) return;
        if (json.success && json.imageDataUrl) {
          setImageDataUrl(json.imageDataUrl);
          setLocationLabel(json.location?.label || null);
        } else {
          setFailed(true);
        }
      } catch (err) {
        console.warn('[ActivityMapView] Falha ao carregar mapa da atividade:', err);
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchMap();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(trajectory?.slice(0, 2)), trajectory?.length, heightPx]);

  if (loading) {
    return (
      <div className={className} style={{ height: heightPx }}>
        <div className="w-full h-full rounded-2xl bg-surface-container-low/60 border border-white/10 flex items-center justify-center animate-pulse">
          <MapPin className="text-primary/40" size={26} />
        </div>
      </div>
    );
  }

  if (failed || !imageDataUrl) {
    return (
      <div className={className} style={{ height: heightPx }}>
        <div className="w-full h-full rounded-2xl bg-surface-container-low/60 border border-white/10 flex flex-col items-center justify-center gap-2 text-on-surface-variant">
          <MapPin size={22} />
          <span className="text-[10px] font-mono text-center px-4">Rota GPS indisponível para esta atividade</span>
        </div>
      </div>
    );
  }

  return (
    <div className={className} style={{ height: heightPx }}>
      <div className="relative w-full h-full rounded-2xl overflow-hidden border border-white/10 bg-black">
        <img src={imageDataUrl} alt="Rota percorrida" className="w-full h-full object-cover" />
        {showPrivacyBadge && (
          <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-sm border border-white/10 rounded-full px-3 py-1 text-[10px] font-mono text-white flex items-center gap-1.5">
            <EyeOff size={11} />
            <span>Início e fim ocultos</span>
          </div>
        )}
        {locationLabel && (
          <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-sm border border-white/10 rounded-full px-3 py-1 text-[10px] font-mono text-white">
            {locationLabel}
          </div>
        )}
      </div>
    </div>
  );
}
