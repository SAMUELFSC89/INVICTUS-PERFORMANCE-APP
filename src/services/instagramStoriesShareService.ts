import { Capacitor, registerPlugin } from '@capacitor/core';

// #202: fala com InstagramStoriesSharePlugin (iOS: InstagramStoriesSharePlugin.swift
// via UIPasteboard; Android: InstagramStoriesSharePlugin.java via Intent
// ADD_TO_STORY) -- ambos plugins Capacitor locais, vivem direto no alvo do
// app (não são pacotes npm), no mesmo padrão do InvictusActivityPlugin já
// usado pela Live Activity/notificação de atividade.
//
// Isto é o "modo 2" de compartilhamento (pedido explícito do usuário depois
// de perguntar como o Strava faz os "Stats Stickers"): em vez de gerar UMA
// imagem já fechada com mapa+stats (o que RunShareCard.handleExport já faz,
// via navigator.share/download), manda um STICKER TRANSPARENTE (só os
// números) direto pro editor de Stories do Instagram -- o usuário arrasta,
// redimensiona e escolhe a própria foto/vídeo de fundo lá dentro, exatamente
// como o Strava faz. Opcionalmente aceita também uma imagem de fundo (o mapa
// da rota) pra pré-preencher o Story.
//
// Só existe em iOS/Android nativos (Capacitor); no navegador `isAvailable()`
// sempre retorna false e a UI deve cair de volta pro compartilhamento padrão.

export interface InstagramStoriesShareOptions {
  /** PNG transparente em base64 (sem o prefixo data:image/...;base64,) — só os números. */
  stickerBase64?: string;
  /** PNG/JPEG em base64 opcional para pré-preencher o fundo do Story (ex: o mapa da rota). */
  backgroundBase64?: string;
  /** Cor hex opcional para o topo do gradiente de fundo, quando não há backgroundBase64. */
  topColor?: string;
  /** Cor hex opcional para a base do gradiente de fundo, quando não há backgroundBase64. */
  bottomColor?: string;
}

interface InstagramStoriesSharePlugin {
  isAvailable(): Promise<{ available: boolean }>;
  share(options: InstagramStoriesShareOptions & { appId?: string }): Promise<void>;
}

const InstagramStoriesShare = registerPlugin<InstagramStoriesSharePlugin>('InstagramStoriesShare');

function stripDataUrlPrefix(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(',');
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
}

export const instagramStoriesShareService = {
  /** true apenas em iOS/Android nativos com o Instagram instalado no aparelho. */
  async isAvailable(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    try {
      const { available } = await InstagramStoriesShare.isAvailable();
      return available;
    } catch (error) {
      console.warn('[instagramStoriesShareService] isAvailable falhou:', error);
      return false;
    }
  },

  /**
   * `stickerDataUrl`/`backgroundDataUrl` aceitam tanto data URLs completas
   * (`data:image/png;base64,...`, o formato que `html-to-image`/`toPng` já
   * devolve) quanto base64 puro -- o prefixo é removido automaticamente.
   */
  async share(options: {
    stickerDataUrl?: string;
    backgroundDataUrl?: string;
    topColor?: string;
    bottomColor?: string;
  }): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      throw new Error('Compartilhamento direto para o Instagram Stories só está disponível no aplicativo.');
    }
    const stickerBase64 = options.stickerDataUrl ? stripDataUrlPrefix(options.stickerDataUrl) : undefined;
    const backgroundBase64 = options.backgroundDataUrl ? stripDataUrlPrefix(options.backgroundDataUrl) : undefined;
    if (!stickerBase64 && !backgroundBase64) {
      throw new Error('Nenhuma imagem para compartilhar.');
    }
    await InstagramStoriesShare.share({
      stickerBase64,
      backgroundBase64,
      topColor: options.topColor,
      bottomColor: options.bottomColor
    });
  }
};
