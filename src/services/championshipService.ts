import { auth } from '../firebase';
import { API_CONFIG } from '../config';
import {
  Championship,
  ChampionshipRegistration,
  RegistrationStatus,
  UserChampionshipProgress,
  ChampionshipResult
} from '../types/championships';
import { CHAMPIONSHIP_CONFIG } from '../config';

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
  const isArena = championshipId === 'invictus_arena_30d';
  const organizer = `${CHAMPIONSHIP_CONFIG.ORGANIZER_NAME} (CNPJ: ${CHAMPIONSHIP_CONFIG.ORGANIZER_CNPJ})`;

  return [
    { id: 1, title: '1. Promotor e Organizador', content: `Este campeonato é promovido, organizado e administrado exclusivamente por ${organizer}.` },
    { id: 2, title: '2. Nome da Competição', content: isArena ? 'INVICTUS ARENA 30D — 1ª Edição Oficial.' : 'INVICTUS RUN ELITE 30D — 1ª Edição Oficial.' },
    { id: 3, title: '3. Modalidade Esportiva', content: isArena ? 'Musculação e Treinamento de Força Indoor em Academia cadastrada/selecionada pelo atleta.' : 'Corrida de Rua e Atletismo Outdoor com rastreamento contínuo de GPS.' },
    { id: 4, title: '4. Objetivo da Competição', content: 'Estimular a consistência esportiva, alta performance e disciplina de atletas através de pontuação biométrica auditada e mérito desportivo puro.' },
    { id: 5, title: '5. Período de Inscrição', content: 'Inscrições abertas até 23h59 do dia que antecede o início oficial da edição, ou até o encerramento do lote.' },
    { id: 6, title: '6. Início da Competição', content: '01 de Setembro de 2026 às 00:00:00 (Horário de Brasília).' },
    { id: 7, title: '7. Encerramento da Competição', content: '30 de Setembro de 2026 às 23:59:59 (Horário de Brasília).' },
    { id: 8, title: '8. Duração Oficial', content: '30 (trinta) dias corridos ininterruptos de competição.' },
    { id: 9, title: '9. Elegibilidade dos Participantes', content: 'Aberto a todos os usuários com conta ativa na plataforma Invictus. O status do plano (Free ou PRO) não concede qualquer vantagem competitiva, multiplicador de pontos ou benefício desportivo.' },
    { id: 10, title: '10. Idade Mínima', content: 'Idade mínima de 18 (dezoito) anos completos na data de inscrição, ou a partir de 16 (dezesseis) anos com expressa autorização legal dos responsáveis.' },
    { id: 11, title: '11. Território e Abrangência', content: 'Competição válida em todo o território nacional brasileiro.' },
    { id: 12, title: '12. Valor da Inscrição', content: 'R$ 49,90 (quarenta e nove reais e noventa centavos) por atleta participante nesta edição.' },
    { id: 13, title: '13. Formas de Pagamento', content: 'Pagamento via PIX instantâneo processado via gateway homologado Asaas.' },
    { id: 14, title: '14. Atividades Válidas', content: isArena ? 'Sessões de musculação com duração entre 30 e 90 minutos, com check-in de presença na academia do atleta, sensores de movimento ou foto de confirmação quando exigido.' : 'Corridas ao ar livre com distância mínima de 1.5 km, telemetria GPS contínua e velocidade fisiologicamente compatível com corrida humana.' },
    { id: 15, title: '15. Atividades Inválidas', content: isArena ? 'Treinos inferiores a 30 minutos, registros sem presença presencial comprovada, sessões duplicadas ou manipuladas.' : 'Corridas em esteira para a categoria outdoor, sessões com perda de sinal GPS, uso de bicicletas/veículos motorizados ou teletransporte de coordenadas.' },
    { id: 16, title: '16. Critérios de Pontuação', content: isArena ? 'Pontuação calculada com base na consistência diária, tempo sob tensão útil (máx. 90 min/dia) e validação de esforço real auditado pelo Activity Engine.' : 'Pontuação baseada em quilometragem percorrida, ritmo (pace) válido, ganho de elevação e frequência de treinos válidos.' },
    { id: 17, title: '17. Ranking Oficial', content: 'Ranking atualizado em tempo real no aplicativo após o processamento das atividades pelo motor antifraude de dupla camada.' },
    { id: 18, title: '18. Critérios de Desempate', content: '1) Maior número de dias com treinos homologados; 2) Menor índice médio de risco antifraude (Trust Score); 3) Ordem cronológica da primeira atividade homologada.' },
    { id: 19, title: '19. Sistema Antifraude', content: 'Todas as atividades passam por análise de integridade física e cinemática (GPS, acelerômetro, giroscópio, Apple Health/Health Connect quando disponíveis e análise de duplicidade).' },
    { id: 20, title: '20. Desclassificação', content: 'Tentativa de adulteração de sensores, mock location, compartilhamento de conta ou conduta antidesportiva acarretará desclassificação sumária sem direito a reembolso.' },
    { id: 21, title: '21. Premiação Oficial', content: 'O montante total destinado à premiação (Prize Pool) corresponde exatamente a 50% (cinquenta por cento) da Receita Líquida Elegível arrecadada exclusivamente das inscrições deste campeonato.' },
    { id: 22, title: '22. Definição de Receita Líquida Elegível', content: CHAMPIONSHIP_CONFIG.NET_ELIGIBLE_REVENUE_DEFINITION },
    { id: 23, title: '23. Distribuição do Top 5', content: 'O Prize Pool será distribuído estritamente aos 5 primeiros colocados: 1º Lugar (40%), 2º Lugar (25%), 3º Lugar (15%), 4º Lugar (12%) e 5º Lugar (8%). Totalizando 100% do pote.' },
    { id: 24, title: '24. Homologação dos Resultados', content: 'Os resultados preliminares passarão por um período de auditoria técnica de 48 (quarenta e oito) horas após o encerramento da edição para homologação definitiva.' },
    { id: 25, title: '25. Contestação e Recursos', content: 'Recursos sobre pontuações e desclassificações podem ser submetidos ao Comitê de Arbitragem em até 24h após a publicação do ranking preliminar via suporte oficial.' },
    { id: 26, title: '26. Pagamento do Prêmio', content: 'Os valores homologados serão creditados diretamente na Carteira Digital do Atleta no app Invictus em até 5 (cinco) dias úteis após a homologação final, disponíveis para saque via PIX.' },
    { id: 27, title: '27. Reembolso e Cancelamento', content: 'O participante pode exercer o direito de arrependimento em até 7 (sete) dias corridos após o pagamento da inscrição, desde que não tenha submetido atividades pontuáveis ao ranking.' },
    { id: 28, title: '28. Indisponibilidade Técnica', content: 'Manutenções programadas serão comunicadas previamente. Falhas pontuais de sinal não autorizam pontuação retroativa sem telemetria comprobatória.' },
    { id: 29, title: '29. Proteção de Dados (LGPD)', content: 'O tratamento de dados pessoais segue estritamente a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), com finalidade exclusiva de auditoria e premiação desportiva.' },
    { id: 30, title: '30. Tratamento de Dados Esportivos e de Saúde', content: 'Dados de telemetria, GPS e frequência cardíaca são coletados sob consentimento explícito para fins de validação antifraude e geração de métricas competitivas.' },
    { id: 31, title: '31. Saúde e Responsabilidade do Participante', content: 'O participante declara estar apto fisicamente e clinicamente para a prática de exercícios intensos, assumindo total responsabilidade por sua integridade física.' },
    { id: 32, title: '32. Disposições Gerais', content: 'Casos omissos serão soberanamente decididos pela Diretoria Técnica da Invictus Performance e Soluções Ltda.' },
    { id: 33, title: '33. Versão do Regulamento e Registro Auditável', content: 'Regulamento Oficial Versão v1.0 com hash criptográfico registrado e controle de versão imutável na base de dados.' },
    { id: 34, title: '34. Disclaimer Apple Inc. e Google LLC', content: CHAMPIONSHIP_CONFIG.APPLE_DISCLAIMER }
  ];
}

export const REGULATION_SECTIONS = getRegulationSections('invictus_arena_30d');

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
