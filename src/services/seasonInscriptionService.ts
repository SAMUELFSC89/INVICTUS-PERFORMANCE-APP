import { auth } from '../firebase';
import { API_CONFIG } from '../config';

/**
 * #109/#110: ate 2026-08 o backend de inscricao paga na Liga Invictus
 * (api/_handlers/season-inscription.ts, api/_lib/inscricao-service.ts) ja
 * existia -- cobranca PIX real via Asaas, idempotente, grava em
 * `season_inscriptions` -- mas nao tinha NENHUMA tela no app que o chamasse.
 * Este service conecta esse backend a UI (ver src/pages/league/SeasonInscription.tsx).
 */

export interface QrCodePix {
  encodedImage: string;
  payload: string;
  expirationDate?: string;
}

export interface SeasonInscriptionStatus {
  inscricoesAbertas: boolean;
  valor: number | null;
  seasonId: string;
  inicioDaTemporada: string;
  fimDaTemporada: string;
  minhaInscricao: { status: 'pendente' | 'paga' | 'cancelada'; valor: number; gymId: string } | null;
}

export interface CriarInscricaoResultado {
  seasonId: string;
  valor: number;
  jaExistia: boolean;
  qrCode: QrCodePix;
}

async function authHeaders(): Promise<Record<string, string>> {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Você precisa estar logado.');
  const idToken = await usuario.getIdToken();
  return { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };
}

export const seasonInscriptionService = {
  async getStatus(): Promise<SeasonInscriptionStatus> {
    const headers = await authHeaders();
    const resp = await fetch(`${API_CONFIG.baseUrl}/api/season-inscription`, { headers });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Falha ao consultar a inscrição da temporada.');
    return data as SeasonInscriptionStatus;
  },

  async criarInscricao(): Promise<CriarInscricaoResultado> {
    const headers = await authHeaders();
    const resp = await fetch(`${API_CONFIG.baseUrl}/api/season-inscription`, {
      method: 'POST',
      headers,
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Falha ao gerar a cobrança da inscrição.');
    return data as CriarInscricaoResultado;
  },
};
