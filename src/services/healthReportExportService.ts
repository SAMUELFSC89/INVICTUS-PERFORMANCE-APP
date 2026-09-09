import { Capacitor, registerPlugin } from '@capacitor/core';

interface InvictusPdfPlugin {
  export(options: { fileName: string }): Promise<void>;
}

const InvictusPdf = registerPlugin<InvictusPdfPlugin>('InvictusPdf');

function safePdfName(fileName: string) {
  const base = fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

export const healthReportExportService = {
  async export(fileName: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await InvictusPdf.export({ fileName: safePdfName(fileName) });
      return;
    }
    window.print();
  },
};
