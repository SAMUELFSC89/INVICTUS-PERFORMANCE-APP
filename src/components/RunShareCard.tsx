import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Download,
  Flame,
  Gauge,
  Image as ImageIcon,
  Instagram,
  Map,
  MapPin,
  RefreshCw,
  Share2,
  Timer,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { RunSession, AdvancedRunStats } from '../services/runningService';
import { formatDuration } from '../lib/runUtils';
import { cn } from '../lib/utils';
import { auth } from '../firebase';
import { API_CONFIG } from '../config';
import { InvictusLogo } from './InvictusLogo';
import { instagramStoriesShareService } from '../services/instagramStoriesShareService';
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

// #254: antes eram 6 variantes de mapa (#199) + fundo "Sólido" (#236) como
// modos de fundo separados. O usuário pediu para reduzir para só os 3
// estilos abaixo (removendo Satélite Puro/Mapa Escuro/Ruas/Sólido) e separar
// "que fundo mostrar" (mapa vs foto) de "qual estilo de mapa usar" -- assim
// o estilo pode ser trocado mesmo com uma foto selecionada (o mapa continua
// como overlay da rota por cima da foto).
type MapVariant = 'satellite' | 'outdoors' | 'navigation-night';
type BackgroundMode = 'map' | 'photo';

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

async function waitForCardAssets(node: HTMLElement): Promise<void> {
  if ('fonts' in document) await document.fonts.ready;
  const images = Array.from(node.querySelectorAll('img'));
  await Promise.all(images.map(async (image) => {
    if (image.complete && image.naturalWidth > 0) return;
    try {
      await image.decode();
    } catch {
      // A captura ainda pode continuar com o fallback visual do card.
    }
  }));
}

export function RunShareCard({ session: rawSession, onClose }: RunShareCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const stickerRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  // #202: "modo 2" (Stats Stickers do Strava) -- so aparece em iOS/Android
  // nativos com o Instagram instalado (ver instagramStoriesShareService).
  const [igAvailable, setIgAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    instagramStoriesShareService.isAvailable().then((available) => {
      if (!cancelled) setIgAvailable(available);
    });
    return () => { cancelled = true; };
  }, []);
  // #251: chave por variante+zoom (nao so variante) pra poder cachear mais de
  // um nivel de zoom da mesma variante sem descartar o anterior a cada ajuste.
  const [mapImages, setMapImages] = useState<Record<string, string | null>>({});
  const [mapError, setMapError] = useState(false);
  // #251: ajuste manual de zoom do mapa do card, pedido explicito do usuario
  // ("a pessoa poder controlar o zoom assim como no mapa ao vivo"). O backend
  // (api/activity-map.ts) calcula um zoom de enquadramento da rota inteira e
  // soma este ajuste, sempre dentro de limites seguros -- nunca deixa a pessoa
  // aproximar tanto que a rota saia do card, nem afastar tanto que vire so um
  // pontinho.
  const [zoomAdjust, setZoomAdjust] = useState(0);
  const ZOOM_ADJUST_MIN = -3;
  const ZOOM_ADJUST_MAX = 3;

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
  // #199: com distanceKm minusculo (ruido de GPS, ex: 0.006km), a formula de
  // ritmo dividia por um numero quase zero e virava um valor absurdo tipo
  // "1651'xx"/km" -- estourava a largura fixa do card e aparecia cortado
  // ("1651...") no compartilhamento real. distanceKm > 0 nao e suficiente
  // como guarda; usa o mesmo limiar de 0.05km (50m) que ja define hasDistance
  // logo abaixo, pra manter TEMPO/RITMO consistentes com o "-" de DISTÂNCIA
  // quando o GPS nao captou deslocamento real.
  const pace =
    session.pace ||
    session.avgPace ||
    (distanceKm > 0.05 && durationMins > 0
      ? `${Math.floor(durationMins / distanceKm)}'${String(Math.round(((durationMins / distanceKm) % 1) * 60)).padStart(2, '0')}"/km`
      : null);
  const trajectory: Array<any> = Array.isArray(session.trajectory)
    ? session.trajectory
    : Array.isArray(session.checkpoints)
      ? session.checkpoints
      : [];
  const title = String(session.title || session.cardioTypeLabel || 'Corrida ao ar livre');
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
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(existingPhoto);
  const [selectedMapVariant, setSelectedMapVariant] = useState<MapVariant>('satellite');
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(() =>
    hasRoute ? 'map' : 'photo',
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
    // O mesmo mapa é usado em tela cheia ou integrado à foto, por isso o
    // carregamento depende do estilo selecionado e não do tipo de fundo.
    if (!hasRoute) return undefined;
    const variant = selectedMapVariant;
    const cacheKey = `${variant}:${zoomAdjust}`;
    if (mapImages[cacheKey]) return undefined;

    const fetchMap = async (authUser: NonNullable<typeof auth.currentUser>) => {
      if (cancelled || requestStarted) return;
      requestStarted = true;
      try {
        const idToken = await authUser.getIdToken();
        const response = await fetch(`${API_CONFIG.baseUrl}/api/activity-map`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          // O endpoint usa @2x no provedor principal: 720x1280 resulta em
          // 1440x2560, acima do PNG final e sem ultrapassar o limite da API.
          body: JSON.stringify({ trajectory: points, width: 720, height: 1280, mapType: variant, zoomAdjust }),
        });
        if (!response.ok) throw new Error(`activity-map respondeu ${response.status}`);
        const json = await response.json();
        if (cancelled) return;
        if (json.success && json.imageDataUrl) {
          console.info('[RunShareCard] Mapa carregado via:', json.mapProvider || 'provedor nao informado');
          setMapImages(current => ({ ...current, [cacheKey]: json.imageDataUrl }));
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
  }, [hasRoute, mapImages, selectedMapVariant, trajectory, zoomAdjust]);

  const handleExport = async (mode: 'download' | 'share') => {
    if (!cardRef.current) return;
    setFeedback(null);
    setIsGenerating(true);
    try {
      // Fontes e imagens precisam estar decodificadas antes de serializar o
      // DOM. A biblioteca rasteriza o SVG diretamente no canvas final, então
      // texto e vetores continuam nítidos mesmo quando o preview é pequeno.
      await new Promise(resolve => setTimeout(resolve, 150));
      await waitForCardAssets(cardRef.current);
      const dataUrl = await toPng(cardRef.current, {
        canvasWidth: 1080,
        canvasHeight: 1920,
        // canvasWidth/Height ja definem a resolucao final. Somar pixelRatio 2
        // gerava um arquivo 2160x3840, pesado e depois recomprimido pelos apps.
        pixelRatio: 1,
        skipAutoScale: true,
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

  // #202/#238: "modo 2" -- em vez de exportar 1 PNG fechado (handleExport
  // acima), captura só o bloco de estatísticas (stickerRef, fora da tela,
  // fundo transparente) e manda direto pro editor de Stories do Instagram
  // via plugin nativo, pro usuario escolher a PROPRIA foto/video de fundo la
  // dentro e arrastar o sticker por cima -- exatamente como o Strava faz.
  //
  // #238: a versao anterior TAMBEM mandava o mapa da rota como
  // "backgroundImage"/"background_asset_uri" simultaneo ao sticker. O
  // proprio comentario do plugin Android (InstagramStoriesSharePlugin.java)
  // ja registrava que essa combinacao "fundo + sticker ao mesmo tempo" tem
  // muito menos exemplos confirmados que os dois caminhos isolados
  // (so-sticker ou so-fundo) -- e foi exatamente isso que o usuario reportou
  // ao vivo: abria o Instagram Stories só com o mapa, sem nenhum dado da
  // atividade nem a logo (ou seja, o sticker "sumia" quando ia junto com uma
  // imagem de fundo). Trocado para NUNCA mandar o mapa como imagem de fundo
  // -- só o sticker (transparente, sempre confirmado) + uma cor de fundo
  // solida/gradiente da marca (tambem documentada oficialmente junto com
  // stickerImage), que e só um pano de fundo enquanto o usuario nao escolhe
  // a propria foto/video dentro do Instagram.
  const handleShareToInstagramStories = async () => {
    if (!stickerRef.current) return;
    setFeedback(null);
    setIsGenerating(true);
    try {
      // Mesma espera defensiva que handleExport ja usa antes de capturar o
      // card principal -- da tempo da logo (img) e do layout cqw assentarem
      // antes do toPng serializar o DOM, evitando uma captura parcial/em
      // branco por corrida com o paint do navegador.
      await new Promise(resolve => setTimeout(resolve, 150));
      const stickerDataUrl = await toPng(stickerRef.current, { pixelRatio: 2, cacheBust: true });
      await instagramStoriesShareService.share({
        stickerDataUrl,
        topColor: '#11151a',
        bottomColor: '#050608',
      });
      setFeedback('Aberto no Instagram Stories.');
    } catch (error) {
      console.error('[RunShareCard] Instagram Stories share error:', error);
      setFeedback(error instanceof Error ? error.message : 'Não foi possível abrir o Instagram Stories.');
    } finally {
      setIsGenerating(false);
    }
  };

  // O estilo escolhido também vale para a sobreposição sobre a foto.
  const currentMapImage: string | null = mapImages[`${selectedMapVariant}:${zoomAdjust}`] ?? null;
  const mapBackgroundAvailable = Boolean(currentMapImage);

  const adjustZoom = (delta: number) => {
    setZoomAdjust((current) => Math.max(ZOOM_ADJUST_MIN, Math.min(ZOOM_ADJUST_MAX, current + delta)));
  };

  const selectBackground = (mode: BackgroundMode) => {
    if (mode === 'map' && !hasRoute) return;
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

        <div className="share-background-picker" aria-label="Personalizar card">
          <button
            type="button"
            className={cn('share-background-option', backgroundMode === 'map' && 'is-selected', !hasRoute && 'is-disabled')}
            onClick={() => selectBackground('map')}
            disabled={!hasRoute}
            aria-pressed={backgroundMode === 'map'}
          >
            <Map size={14} />
            <span>MAPA</span>
          </button>
          <label className="share-map-style">
            <span className="sr-only">Estilo do mapa</span>
            <select
              value={selectedMapVariant}
              onChange={(event) => {
                setFeedback(null);
                setMapError(false);
                setSelectedMapVariant(event.target.value as MapVariant);
              }}
              disabled={!hasRoute}
              aria-label="Estilo do mapa"
            >
              <option value="satellite">Satélite</option>
              <option value="outdoors">Trilha</option>
              <option value="navigation-night">GPS noite</option>
            </select>
          </label>
          <label
            className={cn('share-background-option', backgroundMode === 'photo' && 'is-selected')}
            onClick={() => { setFeedback(null); setBackgroundMode('photo'); }}
          >
            {selectedPhoto ? <ImageIcon size={14} /> : <Upload size={14} />}
            <span>FOTO</span>
            <input type="file" accept="image/*" className="sr-only" onChange={handlePhotoSelection} />
          </label>
        </div>

        {hasRoute ? (
          // #234: controle manual de zoom do mapa do card, no mesmo espirito do
          // mapa ao vivo (que deixa o usuario reenquadrar). O valor eh enviado
          // pro backend (api/activity-map.ts) como zoomAdjust e cacheado por
          // variante+zoom em mapImages. Posicionado absoluto (ver CSS) pra nao
          // entrar no fluxo flex do .share-screen-toolbar (que usa
          // space-between entre o botao fechar e as acoes da direita).
          <div className="share-zoom-control">
            <button
              type="button"
              className="share-zoom-button"
              onClick={() => adjustZoom(-1)}
              disabled={zoomAdjust <= ZOOM_ADJUST_MIN}
              aria-label="Diminuir zoom do mapa"
              title="Diminuir zoom do mapa"
            >
              <ZoomOut size={16} />
            </button>
            <span className="share-zoom-value">Zoom {zoomAdjust > 0 ? `+${zoomAdjust}` : zoomAdjust}</span>
            <button
              type="button"
              className="share-zoom-button"
              onClick={() => adjustZoom(1)}
              disabled={zoomAdjust >= ZOOM_ADJUST_MAX}
              aria-label="Aumentar zoom do mapa"
              title="Aumentar zoom do mapa"
            >
              <ZoomIn size={16} />
            </button>
          </div>
        ) : null}

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
          {igAvailable ? (
            <button
              type="button"
              className="share-icon-button share-icon-button--instagram"
              onClick={() => void handleShareToInstagramStories()}
              disabled={isGenerating}
              aria-label="Enviar sticker para o Instagram Stories"
              title="Enviar sticker para o Instagram Stories"
            >
              {isGenerating ? <RefreshCw size={20} className="share-spin" /> : <Instagram size={20} />}
            </button>
          ) : null}
        </div>
      </div>

      <div className="share-card-stage">
        <div ref={cardRef} className={cn('share-card-art', `share-card-art--${backgroundMode}`)}>
          <div className="share-card-background" aria-hidden="true">
            {backgroundMode === 'photo' && selectedPhoto ? (
              <img src={selectedPhoto} alt="" className="share-card-photo" />
            ) : null}

            {backgroundMode === 'map' && currentMapImage ? (
              <img src={currentMapImage} alt="" className="share-card-map" crossOrigin="anonymous" />
            ) : null}

            {backgroundMode === 'photo' && hasRoute && currentMapImage ? (
              <div className="share-card-route-overlay">
                <img src={currentMapImage} alt="" crossOrigin="anonymous" />
              </div>
            ) : null}

            <div className="share-card-vignette" />
            {!mapBackgroundAvailable && backgroundMode === 'map' ? (
              <div className="share-card-loading-map">{mapError ? 'MAPA INDISPONÍVEL' : 'CARREGANDO MAPA...'}</div>
            ) : null}
            {backgroundMode === 'photo' && !selectedPhoto ? (
              <div className="share-card-photo-empty">SELECIONE UMA FOTO ACIMA</div>
            ) : null}
          </div>

          <div className="share-card-brand">
            <InvictusLogo size={64} />
            <div className="share-card-brand-copy">
              <strong>INVICTUS</strong>
              <span>PERFORMANCE</span>
            </div>
          </div>

          <div className="share-card-content">
            <div className="share-card-activity-heading">
              <span className="share-card-activity-icon"><Flame size={31} strokeWidth={2.4} /></span>
              <div className="share-card-activity-copy">
                <h1>{title}</h1>
              </div>
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

          </div>
        </div>
      </div>

      {/* #202: sticker de estatísticas capturado à parte (transparente, fora
          da tela) -- é o que vai pro Instagram Stories no "modo 2". Reusa as
          mesmas classes/estilos do bloco de estatísticas do card principal
          (inclusive as unidades cqw, via container-type próprio em
          .share-sticker no CSS) pra manter a MESMA aparência, só sem o mapa
          de fundo. */}
      {igAvailable ? (
        <div ref={stickerRef} className="share-sticker" aria-hidden="true">
          <div className="share-card-brand">
            <InvictusLogo size={64} />
            <div className="share-card-brand-copy">
              <strong>INVICTUS</strong>
              <span>PERFORMANCE</span>
            </div>
          </div>
          <div className="share-card-content">
            <div className="share-card-activity-heading">
              <span className="share-card-activity-icon"><Flame size={31} strokeWidth={2.4} /></span>
              <div className="share-card-activity-copy">
                <h1>{title}</h1>
              </div>
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

          </div>
        </div>
      ) : null}

      {feedback ? <div className="share-feedback" role="status" aria-live="polite">{feedback}</div> : null}
    </div>,
    document.body,
  );
}
