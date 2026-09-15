import { useEffect, useMemo, useRef, useState } from 'react';
import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../firebase';

export function getProfilePhotoCandidate(profile: unknown): string | null {
  if (!profile || typeof profile !== 'object') return null;
  const data = profile as Record<string, unknown>;
  const candidates = [data.photoURL, data.photoUrl, data.photo_url, data.avatarURL, data.avatarUrl];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

function isDirectBrowserUrl(value: string): boolean {
  return /^(https?:|data:|blob:)/i.test(value);
}

function isFirebaseStorageLike(value: string): boolean {
  return value.startsWith('gs://') ||
    value.startsWith('profiles/') ||
    /firebasestorage\.googleapis\.com|firebasestorage\.app/i.test(value);
}

async function resolveStorageUrl(value: string): Promise<string> {
  return getDownloadURL(ref(storage, value));
}

interface ProfilePhotoImageProps {
  source: string;
  alt?: string;
  className?: string;
}

/**
 * Avatar resiliente para perfis antigos e atuais.
 *
 * - URLs http/data/blob renderizam imediatamente.
 * - gs:// e paths profiles/... sao convertidos com getDownloadURL().
 * - URLs antigas do Firebase sao renovadas em background e novamente no onError.
 *
 * Isso evita que um avatar legado/stale deixe um <img> quebrado no perfil.
 */
export function ProfilePhotoImage({ source, alt = '', className }: ProfilePhotoImageProps) {
  const normalizedSource = useMemo(() => source.trim(), [source]);
  const initial = isDirectBrowserUrl(normalizedSource) ? normalizedSource : '';
  const [resolvedSrc, setResolvedSrc] = useState(initial);
  const [failed, setFailed] = useState(false);
  const recoveryAttempted = useRef(false);

  useEffect(() => {
    let active = true;
    recoveryAttempted.current = false;
    setFailed(false);
    setResolvedSrc(isDirectBrowserUrl(normalizedSource) ? normalizedSource : '');

    if (!normalizedSource || !isFirebaseStorageLike(normalizedSource)) return () => { active = false; };

    void resolveStorageUrl(normalizedSource)
      .then(url => {
        if (active && url) setResolvedSrc(url);
      })
      .catch(() => {
        // Se ja existe uma URL https, ainda tentamos renderiza-la. O onError
        // abaixo faz a ultima tentativa antes de assumir fallback.
        if (active && !isDirectBrowserUrl(normalizedSource)) setFailed(true);
      });

    return () => { active = false; };
  }, [normalizedSource]);

  const recover = async () => {
    if (recoveryAttempted.current) {
      setFailed(true);
      return;
    }
    recoveryAttempted.current = true;

    if (!isFirebaseStorageLike(normalizedSource)) {
      setFailed(true);
      return;
    }

    try {
      const freshUrl = await resolveStorageUrl(normalizedSource);
      if (!freshUrl || freshUrl === resolvedSrc) {
        setFailed(true);
        return;
      }
      setResolvedSrc(freshUrl);
    } catch {
      setFailed(true);
    }
  };

  if (!resolvedSrc || failed) return null;
  return <img src={resolvedSrc} alt={alt} className={className} onError={() => void recover()} referrerPolicy="no-referrer" />;
}
