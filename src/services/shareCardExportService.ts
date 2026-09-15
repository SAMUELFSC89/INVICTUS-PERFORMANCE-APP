import { Capacitor, registerPlugin } from '@capacitor/core';
import { dataUrlToBlob } from '../lib/shareCard';

interface NativeShareCardPlugin {
  share(options: { base64: string; fileName: string; mimeType: string }): Promise<void>;
  save(options: { base64: string; fileName: string; mimeType: string }): Promise<void>;
}

const NativeShareCard = registerPlugin<NativeShareCardPlugin>('InvictusShareCard');

function base64Payload(dataUrl: string): string {
  return dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
}

function mimeTypeFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;,]+)[;,]/i.exec(dataUrl);
  return match?.[1] || 'image/jpeg';
}

async function shareOnWeb(dataUrl: string, fileName: string): Promise<'shared' | 'downloaded'> {
  const blob = dataUrlToBlob(dataUrl);
  const mimeType = blob.type || mimeTypeFromDataUrl(dataUrl);
  const file = new File([blob], fileName, { type: mimeType });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    try {
      await navigator.share({ files: [file], title: 'Invictus Performance' });
      return 'shared';
    } catch (error: any) {
      // Cancelamento voluntário não deve criar um download inesperado.
      if (error?.name === 'AbortError') throw error;
      // Alguns browsers anunciam suporte a arquivos e falham só no envio.
      // Nesse caso ainda entregamos a imagem ao usuário via download.
    }
  }
  downloadOnWeb(dataUrl, fileName);
  return 'downloaded';
}

function downloadOnWeb(dataUrl: string, fileName: string): void {
  const link = document.createElement('a');
  link.download = fileName;
  link.href = dataUrl;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export const shareCardExportService = {
  async share(dataUrl: string, fileName: string): Promise<'shared' | 'downloaded'> {
    if (Capacitor.isNativePlatform()) {
      await NativeShareCard.share({
        base64: base64Payload(dataUrl),
        fileName,
        mimeType: mimeTypeFromDataUrl(dataUrl),
      });
      return 'shared';
    }
    return shareOnWeb(dataUrl, fileName);
  },

  async save(dataUrl: string, fileName: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await NativeShareCard.save({
        base64: base64Payload(dataUrl),
        fileName,
        mimeType: mimeTypeFromDataUrl(dataUrl),
      });
      return;
    }
    downloadOnWeb(dataUrl, fileName);
  },
};
