import { auth } from '../firebase';
import { API_CONFIG } from '../config';
import type { CompetitiveHrAcknowledgementInput } from '../lib/competitiveHeartRateAcknowledgement';
import {
  Championship,
  ChampionshipRegistration,
  RegistrationStatus,
  UserChampionshipProgress,
  ChampionshipResult
} from '../types/championships';
import {
  PAID_CHAMPIONSHIP_OFFERS,
  getPaidChampionshipRuleSections,
  type ChampionshipRuleSection,
} from '../../shared/paidChampionshipPolicy';

export interface RegulationSection {
  id: string;
  title: string;
  content: string;
}

export interface PaidChampionshipLeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  gym: string;
  score: number;
  photoURL?: string;
  isUser?: boolean;
}

export function getRegulationSections(championshipId: string): RegulationSection[] {
  const offer = PAID_CHAMPIONSHIP_OFFERS[championshipId as keyof typeof PAID_CHAMPIONSHIP_OFFERS];
  if (!offer) return [];
  return getPaidChampionshipRuleSections(offer).map((section: ChampionshipRuleSection) => ({
    id: section.id,
    title: section.title,
    content: section.body,
  }));
}

export const REGULATION_SECTIONS = getRegulationSections('invictus_strength_v1');

async function authHeaders(): Promise<Record<string, string>> {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Você precisa estar logado.');
  const idToken = await usuario.getIdToken();
  return { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };
}

function mapStatus(statusServidor: string): RegistrationStatus {
  switch (statusServidor) {
    case 'paga': return 'ACTIVE';
    case 'cancelada': return 'CANCELLED';
    case 'reembolsada': return 'REFUNDED';
    case 'contestada': return 'REJECTED';
    case 'pendente':
    default: return 'PENDING_PAYMENT';
  }
}

function mapRegistration(dados: any): ChampionshipRegistration {
  const editionId = String(dados.editionId || '');
  return {
    id: String(dados.externalPaymentReference || `${dados.userId}_${editionId || dados.championshipId}`),
    championshipId: dados.championshipId,
    editionId,
    championshipTitle: dados.championshipTitle,
    userId: dados.userId,
    status: mapStatus(dados.status),
    paymentStatus: dados.paymentStatus,
    amount: dados.valor,
    regulationVersion: dados.regulationVersion,
    regulationHash: dados.regulationHash,
    regulationAcceptedAt: dados.regulationAcceptedAt,
    externalPaymentReference: dados.externalPaymentReference,
    asaasPaymentId: dados.asaasPaymentId,
    asaasCheckoutId: dados.asaasCheckoutId,
    asaasCheckoutUrl: dados.asaasCheckoutUrl,
    checkoutSurface: dados.checkoutSurface,
    paymentMethod: dados.paymentMethod,
    createdAt: dados.criadaEm,
    paidAt: dados.pagaEm,
  };
}

class ChampionshipService {
  private catalogPromise: Promise<Championship[]> | null = null;

  async getChampionships(force = false): Promise<Championship[]> {
    if (force) this.catalogPromise = null;
    if (!this.catalogPromise) {
      this.catalogPromise = fetch(`${API_CONFIG.baseUrl}/api/championships`)
        .then(async (resp) => {
          if (!resp.ok) throw new Error('Falha ao carregar campeonatos.');
          const data = await resp.json();
          return (data.championships || []) as Championship[];
        })
        .catch((erro) => {
          console.warn('[championshipService] falha ao buscar catalogo:', erro);
          this.catalogPromise = null;
          return [] as Championship[];
        });
    }
    return this.catalogPromise;
  }

  async getChampionshipById(id: string, force = false): Promise<Championship | undefined> {
    const lista = await this.getChampionships(force);
    return lista.find((c) => c.id === id);
  }

  async getUserRegistrations(): Promise<ChampionshipRegistration[]> {
    try {
      if (!auth.currentUser) return [];
      const headers = await authHeaders();
      const resp = await fetch(`${API_CONFIG.baseUrl}/api/championships/my-registrations`, { headers });
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.registrations || []).map(mapRegistration);
    } catch (erro) {
      console.warn('[championshipService] falha ao buscar inscricoes:', erro);
      return [];
    }
  }

  async isUserRegistered(championshipId: string): Promise<boolean> {
    const [regs, championship] = await Promise.all([
      this.getUserRegistrations(),
      this.getChampionshipById(championshipId),
    ]);
    if (!championship?.editionId) return false;
    return regs.some((registration) => registration.championshipId === championshipId
      && registration.editionId === championship.editionId
      && registration.status === 'ACTIVE');
  }

  async getRegistration(championshipId: string): Promise<ChampionshipRegistration | undefined> {
    const [regs, championship] = await Promise.all([
      this.getUserRegistrations(),
      this.getChampionshipById(championshipId),
    ]);
    if (!championship?.editionId) return undefined;
    return regs.find((registration) => registration.championshipId === championshipId
      && registration.editionId === championship.editionId);
  }

  async acceptRegulation(
    championshipId: string,
    regulationVersion: string,
    regulationHash: string,
    hrAcknowledgement: CompetitiveHrAcknowledgementInput,
  ): Promise<{ acceptanceId: string }> {
    const headers = await authHeaders();
    const resp = await fetch(`${API_CONFIG.baseUrl}/api/championships/accept-regulation`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        championshipId,
        regulationVersion,
        regulationHash,
        locale: 'pt-BR',
        platform: hrAcknowledgement.platform,
        hrAcknowledgement,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Falha ao registrar aceite do regulamento.');
    return data;
  }

  async createPayment(
    championshipId: string,
    acceptanceId: string,
    checkoutSurface: 'ios_native' | 'web',
  ): Promise<{
    success: true;
    championshipId: string;
    editionId: string;
    valor: number;
    jaExistia: boolean;
    checkoutId: string;
    checkoutUrl: string;
  }> {
    const headers = await authHeaders();
    const resp = await fetch(`${API_CONFIG.baseUrl}/api/championships/payment`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ championshipId, acceptanceId, checkoutSurface }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Falha ao criar o checkout da inscrição.');
    return data;
  }

  async getUserProgress(championshipId: string): Promise<UserChampionshipProgress | null> {
    try {
      const headers = await authHeaders();
      const resp = await fetch(`${API_CONFIG.baseUrl}/api/championships/progress?championshipId=${encodeURIComponent(championshipId)}`, { headers });
      if (!resp.ok) return null;
      return (await resp.json()) as UserChampionshipProgress;
    } catch (erro) {
      console.warn('[championshipService] falha ao buscar progresso:', erro);
      return null;
    }
  }

  async getMyActivities(championshipId: string): Promise<Array<{ activityId: string; activityType: string; score: number; validationStatus: string; durationMinutes: number; distanceKm: number; createdAt: string }>> {
    try {
      const headers = await authHeaders();
      const resp = await fetch(`${API_CONFIG.baseUrl}/api/championships/my-activities?championshipId=${encodeURIComponent(championshipId)}`, { headers });
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.activities || [];
    } catch (erro) {
      console.warn('[championshipService] falha ao buscar atividades do campeonato:', erro);
      return [];
    }
  }

  async getLeaderboard(championshipId: string): Promise<PaidChampionshipLeaderboardEntry[]> {
    try {
      const headers = await authHeaders();
      const resp = await fetch(`${API_CONFIG.baseUrl}/api/championships/leaderboard?championshipId=${encodeURIComponent(championshipId)}`, { headers });
      if (!resp.ok) return [];
      const data = await resp.json();
      const uid = auth.currentUser?.uid;
      return (data.leaderboard || []).map((entry: any) => ({
        rank: Number(entry?.rank || 0),
        userId: String(entry?.userId || ''),
        name: String(entry?.name || 'Atleta Invictus'),
        gym: String(entry?.gym || ''),
        score: Number(entry?.score || 0),
        photoURL: typeof entry?.photoURL === 'string' ? entry.photoURL : '',
        isUser: String(entry?.userId || '') === uid,
      }));
    } catch (erro) {
      console.warn('[championshipService] falha ao buscar leaderboard:', erro);
      return [];
    }
  }

  getHistoryResults(): ChampionshipResult[] {
    return [];
  }
}

export const championshipService = new ChampionshipService();
