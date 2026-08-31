import { auth } from '../firebase';
import { API_CONFIG } from '../config';
import {
  Championship,
  ChampionshipRegistration,
  RegistrationStatus,
  UserChampionshipProgress,
  ChampionshipResult
} from '../types/championships';

/**
 * Ate 2026-08 este arquivo era 100% mock: catalogo hardcoded
 * (INITIAL_CHAMPIONSHIPS), inscricao em localStorage e "confirmacao de
 * pagamento" que so setava um status na hora, sem nenhum Firestore ou Asaas
 * por tras. Reescrito para consumir os endpoints reais em
 * api/_handlers/championships.ts (catalogo, inscricao, pagamento PIX,
 * progresso e leaderboard vem todos do servidor agora).
 *
 * O catalogo (preco, janela, hash do regulamento) NUNCA mais deve ser
 * hardcoded aqui -- ele e servidor-autoritativo (api/_lib/championship-catalog.ts)
 * porque e usado pra validar cobranca real; duplicar os valores aqui e
 * exatamente o tipo de dessincronia que já causou 5 formulas de pontuacao
 * diferentes no passado (ver AUDITORIA-CORE-INVICTUS.md).
 */

export interface RegulationSection {
  id: number;
  title: string;
  content: string;
}

export function getRegulationSections(championshipId: string): RegulationSection[] {
  void championshipId;
  return [
    { id: 1, title: 'CAMPEONATOS PAGOS — EM BREVE', content: 'Não existe edição paga aberta para inscrição. As prévias de musculação e cardio são apenas informativas.' },
    { id: 2, title: 'SEM COBRANÇA', content: 'Preço, datas, premiação e regras comerciais ainda não foram definidos. O sistema não deve emitir cobrança ou registrar inscrição.' },
    { id: 3, title: 'REGULAMENTO FUTURO', content: 'Uma edição somente poderá ser ativada depois de publicar regulamento específico, dados do organizador, elegibilidade, critérios, auditoria, cancelamento e eventual premiação.' }
  ];
}

export const REGULATION_SECTIONS = getRegulationSections('coming_soon');

async function authHeaders(): Promise<Record<string, string>> {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Você precisa estar logado.');
  const idToken = await usuario.getIdToken();
  return { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };
}

/** Status em portugues gravado pelo servidor -> enum ja usado pelo resto do app. */
function mapStatus(statusServidor: string): RegistrationStatus {
  switch (statusServidor) {
    case 'paga': return 'ACTIVE';
    case 'cancelada': return 'CANCELLED';
    case 'reembolsada': return 'REFUNDED';
    case 'pendente':
    default:
      return 'PENDING_PAYMENT';
  }
}

function mapRegistration(dados: any): ChampionshipRegistration {
  return {
    id: `${dados.userId}_${dados.championshipId}`,
    championshipId: dados.championshipId,
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
    paymentMethod: 'PIX',
    createdAt: dados.criadaEm,
    paidAt: dados.pagaEm,
  };
}

export interface QrCodePix {
  encodedImage: string;
  payload: string;
  expirationDate?: string;
}

class ChampionshipService {
  private catalogPromise: Promise<Championship[]> | null = null;

  /** Catalogo oficial (preco/janela/regulamento vigente), com cache em memoria por sessao. */
  async getChampionships(): Promise<Championship[]> {
    if (!this.catalogPromise) {
      this.catalogPromise = fetch(`${API_CONFIG.baseUrl}/api/championships`)
        .then(async (resp) => {
          if (!resp.ok) throw new Error('Falha ao carregar campeonatos.');
          const data = await resp.json();
          return (data.championships || []) as Championship[];
        })
        .catch((erro) => {
          console.warn('[championshipService] falha ao buscar catalogo:', erro);
          this.catalogPromise = null; // permite tentar de novo na proxima chamada
          return [] as Championship[];
        });
    }
    return this.catalogPromise;
  }

  async getChampionshipById(id: string): Promise<Championship | undefined> {
    const lista = await this.getChampionships();
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
    const regs = await this.getUserRegistrations();
    return regs.some((r) => r.championshipId === championshipId && r.status === 'ACTIVE');
  }

  async getRegistration(championshipId: string): Promise<ChampionshipRegistration | undefined> {
    const regs = await this.getUserRegistrations();
    return regs.find((r) => r.championshipId === championshipId);
  }

  /** Registra o aceite auditado do regulamento vigente (obrigatorio antes do pagamento). */
  async acceptRegulation(championshipId: string, regulationVersion: string, regulationHash: string): Promise<{ acceptanceId: string }> {
    const headers = await authHeaders();
    const resp = await fetch(`${API_CONFIG.baseUrl}/api/championships/accept-regulation`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ championshipId, regulationVersion, regulationHash, locale: 'pt-BR', platform: 'app' }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Falha ao registrar aceite do regulamento.');
    return data;
  }

  /**
   * Antes de emitir a cobranca PIX (dinheiro real), o servidor agora exige
   * confirmacao de presenca por selfie (ver api/_handlers/championships.ts).
   * Este metodo sempre devolve `presenceCheckRequired: true` -- o QR code so
   * chega depois, via VerifiedPresenceModal -> POST /api/validate-presence
   * (actionType 'championship_registration'), cujo `commitResult` e o mesmo
   * formato `{ valor, qrCode, jaExistia }` que antes vinha direto daqui.
   */
  async createPayment(championshipId: string, acceptanceId: string): Promise<{
    presenceCheckRequired: true;
    presenceCheckId: string;
    livenessPrompt: string;
    userMessage: string;
  }> {
    const headers = await authHeaders();
    const resp = await fetch(`${API_CONFIG.baseUrl}/api/championships/payment`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ championshipId, acceptanceId }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Falha ao iniciar a confirmação de presença para a inscrição.');
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

  async getLeaderboard(championshipId: string): Promise<Array<{ rank: number; name: string; gym: string; score: number; isUser?: boolean }>> {
    try {
      const resp = await fetch(`${API_CONFIG.baseUrl}/api/championships/leaderboard?championshipId=${encodeURIComponent(championshipId)}`);
      if (!resp.ok) return [];
      const data = await resp.json();
      const uid = auth.currentUser?.uid;
      return (data.leaderboard || []).map((e: any) => ({ ...e, isUser: e.userId === uid }));
    } catch (erro) {
      console.warn('[championshipService] falha ao buscar leaderboard:', erro);
      return [];
    }
  }

  /** Ainda nao ha homologacao/pagamento de premio automatizados -- historico fica vazio ate isso existir. */
  getHistoryResults(): ChampionshipResult[] {
    return [];
  }
}

export const championshipService = new ChampionshipService();
