import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { OfficialExercise } from '../data/exerciseCatalog';
import './OfficialExerciseMedia.css';


export interface ResolvedExerciseMedia {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  thumbnailFallbackUrl: string | null;
  demoUrl: string | null;
  demoLoop: boolean;
}

function safeMediaUrl(value: string | undefined): string | null {
  if (!value || value.trim() !== value || /[\\<>\r\n\t]/.test(value)) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? value : null;
  } catch { return null; }
}

/** Status and URLs come only from the official catalogue; unknown IDs have no media. */
export function resolveOfficialExerciseMedia(exercise?: OfficialExercise, label = 'exercício'): ResolvedExerciseMedia {
  return {
    id: exercise?.id ?? '',
    name: exercise?.name ?? label,
    thumbnailUrl: exercise?.thumbStatus === 'ready' ? safeMediaUrl(exercise.thumbUrl) : null,
    thumbnailFallbackUrl: exercise?.thumbStatus === 'ready' ? safeMediaUrl(exercise.thumbFallbackUrl) : null,
    demoUrl: exercise?.demoStatus === 'ready' ? safeMediaUrl(exercise.demoUrl) : null,
    demoLoop: exercise?.demoLoop === true,
  };
}

export function selectOfficialExerciseThumbnail(source: ResolvedExerciseMedia, failedUrls: Set<string> = new Set()): string | null {
  return [source.thumbnailUrl, source.thumbnailFallbackUrl].find((url) => url && !failedUrls.has(url)) ?? null;
}

export type OfficialExerciseMediaProps = {
  exercise?: OfficialExercise;
  label?: string;
  /** Use eager only for the exercise currently visible during an active workout. */
  priority?: boolean;
  className?: string;
  onImageError?: (exerciseId: string, failedUrl: string) => void;
};

export function OfficialExerciseMedia({
  exercise,
  label = 'exercício',
  priority = false,
  className = '',
  onImageError,
}: OfficialExerciseMediaProps) {
  const source = resolveOfficialExerciseMedia(exercise, label);
  const [failedUrls, setFailedUrls] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setFailedUrls(new Set());
  }, [source.id, source.thumbnailUrl, source.thumbnailFallbackUrl]);
  const url = selectOfficialExerciseThumbnail(source, failedUrls);

  return (
    <div className={`official-exercise-media ${className}`.trim()}>
      {url ? (
        <img
          src={url}
          alt={`Ilustração de ${source.name}`}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onError={() => {
            setFailedUrls((previous) => new Set(previous).add(url));
            onImageError?.(source.id, url);
          }}
        />
      ) : (
        <div className="official-exercise-media__unavailable" role="img" aria-label={`Imagem indisponível para ${source.name}`}>
          <svg viewBox="0 0 48 48" width="40" height="40" fill="none" aria-hidden="true">
            <path d="M8 17v14m6-18v22m20-22v22m6-18v14M14 24h20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span aria-hidden="true">Imagem indisponível</span>
        </div>
      )}
    </div>
  );
}

type Props = {
  exercise?: OfficialExercise;
  open: boolean;
  onClose: () => void;
};

const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';

/** Mount this once for the selected exercise, outside clickable cards. */
export function ExerciseDemoDialog({ exercise, open, onClose }: Props) {
  const source = resolveOfficialExerciseMedia(exercise);
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeHandlerRef = useRef(onClose);
  const [videoFailed, setVideoFailed] = useState(false);
  closeHandlerRef.current = onClose;

  useEffect(() => setVideoFailed(false), [source.id, source.demoUrl, open]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();

    function focusableElements() {
      return Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
        .filter((element) => !element.hidden && element.getClientRects().length > 0);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeHandlerRef.current();
      }
      if (event.key !== 'Tab') return;
      const elements = focusableElements();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    function keepFocusInside(event: FocusEvent) {
      if (event.target instanceof Node && !dialogRef.current?.contains(event.target)) closeRef.current?.focus();
    }

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', keepFocusInside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', keepFocusInside);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;
  const videoUrl = videoFailed ? null : source.demoUrl;
  return createPortal(
    <div className="official-exercise-dialog__backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div
        className="official-exercise-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <div className="official-exercise-dialog__heading">
          <h2 id={titleId}>{source.name}</h2>
          <button ref={closeRef} type="button" className="official-exercise-dialog__close" onClick={onClose} aria-label="Fechar execução do exercício">×</button>
        </div>
        {videoUrl ? (
          <video
            key={videoUrl}
            className="official-exercise-dialog__video"
            src={videoUrl}
            controls
            playsInline
            muted
            preload="none"
            loop={source.demoLoop === true}
            onError={() => setVideoFailed(true)}
            aria-label={`Vídeo de execução de ${source.name}`}
          >Seu navegador não conseguiu reproduzir este vídeo.</video>
        ) : (
          <OfficialExerciseMedia exercise={exercise} priority />
        )}
        <p id={descriptionId} className="official-exercise-dialog__description">
          {videoUrl
            ? 'Use os controles para iniciar e pausar a demonstração.'
            : videoFailed
              ? 'Não foi possível carregar o vídeo. A imagem continua disponível quando houver uma ilustração cadastrada.'
              : 'Demonstração em vídeo ainda não disponível. A ilustração identifica o exercício e não mostra o movimento completo.'}
        </p>
      </div>
    </div>,
    document.body,
  );
}
