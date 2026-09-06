export type ClipboardWriter = { writeText(value: string): Promise<void> };

export type ClipboardResult =
  | { ok: true }
  | { ok: false; message: string };

export async function copyTextToClipboard(value: string, clipboard?: ClipboardWriter | null): Promise<ClipboardResult> {
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    return { ok: false, message: 'A cópia automática não está disponível neste dispositivo. Selecione o código e copie manualmente.' };
  }

  try {
    await clipboard.writeText(value);
    return { ok: true };
  } catch {
    return { ok: false, message: 'Não foi possível copiar automaticamente. Selecione o código e copie manualmente.' };
  }
}

