import { Capacitor, registerPlugin } from '@capacitor/core';
import { dataUrlToBlob } from '../lib/shareCard';

interface NativeShareCardPlugin {
  share(options: { base64: string; fileName: string }): Promise<void>;
  save(options: { base64: string; fileName: string }): Promise<void>;
}

const NativeShareCard = registerPlugin<NativeShareCardPlugin>('InvictusShareCard');

function base64Payload(dataUrl: string): string {
  return dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
}

async function shareOnWeb(dataUrl: string, fileName: string): Promise<'shared' | 'downloaded'> {
  const blob = dataUrlToBlob(dataUrl);
  const file = new File([blob], fileName, { type: 'image/png' });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({ files: [file], title: 'Invictus Performance' });
    return 'shared';
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
      await NativeShareCard.share({ base64: base64Payload(dataUrl), fileName });
      return 'shared';
    }
    return shareOnWeb(dataUrl, fileName);
  },

  async save(dataUrl: string, fileName: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await NativeShareCard.save({ base64: base64Payload(dataUrl), fileName });
      return;
    }
    downloadOnWeb(dataUrl, fileName);
  },
};

