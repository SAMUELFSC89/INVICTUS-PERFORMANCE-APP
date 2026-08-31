import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import type { ProductImages, ProductImageStatus } from '../types';
import './ProductImage.css';

const normalizedImageCache = new Map<string, Promise<string>>();

// Removes only light pixels connected to the outer border. White typography
// and labels inside a package are preserved, while studio canvases disappear.
function normalizeLightBackdrop(source: string): Promise<string> {
  const cached = normalizedImageCache.get(source);
  if (cached) return cached;
  const task = new Promise<string>((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return resolve(source);
        context.drawImage(image, 0, 0, width, height);
        const frame = context.getImageData(0, 0, width, height);
        const pixels = frame.data;
        let lightBorderPixels = 0;
        let transparentBorderPixels = 0;
        let borderPixels = 0;
        const inspectBorder = (index: number) => {
          const offset = index * 4;
          const r = pixels[offset];
          const g = pixels[offset + 1];
          const b = pixels[offset + 2];
          const alpha = pixels[offset + 3];
          borderPixels += 1;
          if (alpha < 16) transparentBorderPixels += 1;
          else if (r > 226 && g > 226 && b > 226 && Math.max(r, g, b) - Math.min(r, g, b) < 28) lightBorderPixels += 1;
        };
        for (let x = 0; x < width; x += 1) {
          inspectBorder(x);
          inspectBorder((height - 1) * width + x);
        }
        for (let y = 1; y < height - 1; y += 1) {
          inspectBorder(y * width);
          inspectBorder(y * width + width - 1);
        }
        // Transparent cutouts and dark studio photos already work correctly on
        // the approved black surface; processing them could erase white packs.
        if (transparentBorderPixels > borderPixels * 0.25 || lightBorderPixels < borderPixels * 0.35) {
          resolve(source);
          return;
        }
        const visited = new Uint8Array(width * height);
        const queue = new Int32Array(width * height);
        let head = 0;
        let tail = 0;
        const isBackdrop = (index: number) => {
          const offset = index * 4;
          const r = pixels[offset];
          const g = pixels[offset + 1];
          const b = pixels[offset + 2];
          return pixels[offset + 3] < 16 || (r > 226 && g > 226 && b > 226 && Math.max(r, g, b) - Math.min(r, g, b) < 28);
        };
        const enqueue = (index: number) => {
          if (!visited[index] && isBackdrop(index)) {
            visited[index] = 1;
            queue[tail++] = index;
          }
        };
        for (let x = 0; x < width; x += 1) {
          enqueue(x);
          enqueue((height - 1) * width + x);
        }
        for (let y = 1; y < height - 1; y += 1) {
          enqueue(y * width);
          enqueue(y * width + width - 1);
        }
        while (head < tail) {
          const index = queue[head++];
          pixels[index * 4 + 3] = 0;
          const x = index % width;
          const y = Math.floor(index / width);
          if (x > 0) enqueue(index - 1);
          if (x + 1 < width) enqueue(index + 1);
          if (y > 0) enqueue(index - width);
          if (y + 1 < height) enqueue(index + width);
        }
        context.putImageData(frame, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(source);
      }
    };
    image.onerror = () => resolve(source);
    image.src = source;
  });
  normalizedImageCache.set(source, task);
  return task;
}

export function ProductImage({ images, imageStatus, name, variant = 'card' }: { images: ProductImages; imageStatus: ProductImageStatus; name: string; variant?: 'card' | 'detail' }) {
  const [failed, setFailed] = useState(false);
  const source = variant === 'card' ? (images.thumbnail || images.primary) : images.primary;
  const [displaySource, setDisplaySource] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setDisplaySource(null);
    if (source && imageStatus === 'READY') {
      void normalizeLightBackdrop(source).then(normalized => {
        if (active) setDisplaySource(normalized);
      });
    }
    return () => { active = false; };
  }, [source, imageStatus]);

  if (imageStatus !== 'READY' || !source || failed) {
    return <div className={`product-image is-placeholder is-${variant}`} role="img" aria-label={`Imagem de ${name} em breve`}><Package /><span>IMAGEM EM BREVE</span></div>;
  }
  return <div className={`product-image is-${variant} ${displaySource ? 'is-ready' : 'is-processing'}`}>{displaySource ? <img src={displaySource} alt={name} loading="lazy" onError={() => setFailed(true)} /> : null}</div>;
}
