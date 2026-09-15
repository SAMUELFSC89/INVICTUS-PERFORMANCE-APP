import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export async function compressImage(file: File, maxWidth = 800, quality = 0.5): Promise<Blob> {
  if (!file || file.size <= 0) {
    throw new Error('O arquivo selecionado está vazio.');
  }

  const PROCESSING_TIMEOUT_MS = 15_000;
  const objectUrl = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const img = new Image();
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      img.onload = null;
      img.onerror = null;
      URL.revokeObjectURL(objectUrl);
    };
    const finish = (blob: Blob) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(blob);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const timeout = setTimeout(() => {
      fail(new Error('IMAGE_PROCESSING_TIMEOUT'));
    }, PROCESSING_TIMEOUT_MS);

    img.onload = () => {
      try {
        const sourceWidth = img.naturalWidth || img.width;
        const sourceHeight = img.naturalHeight || img.height;
        if (!sourceWidth || !sourceHeight) {
          fail(new Error('A imagem selecionada não possui dimensões válidas.'));
          return;
        }

        const scale = sourceWidth > maxWidth ? maxWidth / sourceWidth : 1;
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          fail(new Error('Não foi possível preparar a foto neste dispositivo.'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) finish(blob);
            else fail(new Error('Não foi possível converter a foto para envio.'));
          },
          'image/jpeg',
          quality
        );
      } catch (error: any) {
        fail(error instanceof Error ? error : new Error('Não foi possível preparar a foto.'));
      }
    };

    img.onerror = () => fail(new Error('O formato desta imagem não pôde ser lido. Escolha uma foto em JPG, PNG ou WEBP.'));
    img.src = objectUrl;
  });
}
