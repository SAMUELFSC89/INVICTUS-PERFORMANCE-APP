import { useState } from 'react';
import { Package } from 'lucide-react';
import type { ProductImages, ProductImageStatus } from '../types';
import './ProductImage.css';

export function ProductImage({ images, imageStatus, name, variant = 'card' }: { images: ProductImages; imageStatus: ProductImageStatus; name: string; variant?: 'card' | 'detail' }) {
  const [failed, setFailed] = useState(false);
  const source = variant === 'card' ? (images.thumbnail || images.primary) : images.primary;
  if (imageStatus !== 'READY' || !source || failed) {
    return <div className={`product-image is-placeholder is-${variant}`} role="img" aria-label={`Imagem de ${name} em breve`}><Package /><span>IMAGEM EM BREVE</span></div>;
  }
  return <div className={`product-image is-${variant}`}><img src={source} alt={name} loading="lazy" onError={() => setFailed(true)} /></div>;
}
