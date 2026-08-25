import {
  Championship,
  ChampionshipRegistration,
  ChampionshipScoreEntry,
  UserChampionshipProgress,
  ChampionshipResult
} from '../types/championships';
import { CHAMPIONSHIP_CONFIG } from '../config';

export const INITIAL_CHAMPIONSHIPS: Championship[] = [
  {
    id: 'invictus_arena_30d',
    type: 'arena_musculacao',
    title: 'INVICTUS ARENA 30D',
    edition: '1ª EDIÇÃO OFICIAL',
    subtitle: 'Campeonato de Academia',
    categoryLabel: 'Campeonato de Academia',
    description: 'Consistência, intensidade e disciplina. Treine melhor e suba no ranking.',
    accentColor: 'gold',
    durationDays: 30,
    startAt: '2026-09-01T00:00:00.000Z',
    endAt: '2026-09-30T23:59:59.000Z',
    registrationPrice: 49.90,
    participantCount: 0,
    grossRevenue: 0,
    netEligibleRevenue: 0,
    prizePool: 0,
    prizeDistribution: [
      { rank: 1, percentage: 40, amount: 0, label: '1º Lugar' },
      { rank: 2, percentage: 25, amount: 0, label: '2º Lugar' },
      { rank: 3, percentage: 15, amount: 0, label: '3º Lugar' },
      { rank: 4, percentage: 12, amount: 0, label: '4º Lugar' },
      { rank: 5, percentage: 8, amount: 0, label: '5º Lugar' },
    ],
    status: 'upcoming',
    regulationVersion: 'v1.0 Oficial',
    regulationHash: 'sha256:7f92b45014603613fa11075d04586616428c460d3d5f57a3e74bebe2c90c7410',
    antiFraudProfile: {
      minDurationMinutes: 30,
      maxDurationMinutes: 90,
      requireGeofence: true,
      maxRiskScore: 25
    }
  },
  {
    id: 'invictus_run_elite_30d',
    type: 'run_elite_corrida',
    title: 'INVICTUS RUN ELITE 30D',
    edition: '1ª EDIÇÃO OFICIAL',
    subtitle: 'Campeonato de Corrida',
    categoryLabel: 'Campeonato de Corrida',
    description: 'Performance pura nas pistas e ruas. Desafie o asfalto e dispute o Top 5.',
    accentColor: 'teal',
    durationDays: 30,
    startAt: '2026-09-01T00:00:00.000Z',
    endAt: '2026-09-30T23:59:59.000Z',
    registrationPrice: 49.90,
    participantCount: 0,
    grossRevenue: 0,
    netEligibleRevenue: 0,
    prizePool: 0,
    prizeDistribution: [
      { rank: 1, percentage: 40, amount: 0, label: '1º Lugar' },
      { rank: 2, percentage: 25, amount: 0, label: '2º Lugar' },
      { rank: 3, percentage: 15, amount: 0, label: '3º Lugar' },
      { rank: 4, percentage: 12, amount: 0, label: '4º Lugar' },
      { rank: 5, percentage: 8, amount: 0, label: '5º Lugar' },
    ],
    status: 'upcoming',
    regulationVersion: 'v1.0 Oficial',
    regulationHash: 'sha256:8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4',
    antiFraudProfile: {
      minDurationMinutes: 15,
      maxDurationMinutes: 180,
      requireContinuousGPS: true,
      maxRiskScore: 20
    }
  }
];

export interface RegulationSection {
  id: number;
  title: string;
  content: string;
}

export function getRegulationSections(championshipId: string): RegulationSection[] {
  const isArena = championshipId === 'invictus_arena_30d';
  const organizer = `${CHAMPIONSHIP_CONFIG.ORGANIZER_NAME} (CNPJ: ${CHAMPIONSHIP_CONFIG.ORGANIZER_CNPJ})`;

  return [
    {
      id: 1,
      title: '1. Promotor e Organizador',
      content: `Este campeonato é promovido, organizado e administrado exclusivamente por ${organizer}.`
    },
    {
      id: 2,
      title: '2. Nome da Competição',
      content: isArena ? 'INVICTUS ARENA 30D — 1ª Edição Oficial.' : 'INVICTUS RUN ELITE 30D — 1ª Edição Oficial.'
    },
    {
      id: 3,
      title: '3. Modalidade Esportiva',
      content: isArena
        ? 'Musculação e Treinamento de Força Indoor em Academia cadastrada/selecionada pelo atleta.'
        : 'Corrida de Rua e Atletismo Outdoor com rastreamento contínuo de GPS.'
    },
    {
      id: 4,
      title: '4. Objetivo da Competição',
      content: 'Estimular a consistência esportiva, alta performance e disciplina de atletas através de pontuação biométrica auditada e mérito desportivo puro.'
    },
    {
      id: 5,
      title: '5. Período de Inscrição',
      content: 'Inscrições abertas até 23h59 do dia que antecede o início oficial da edição, ou até o encerramento do lote.'
    },
    {
      id: 6,
      title: '6. Início da Competição',
      content: '01 de Setembro de 2026 às 00:00:00 (Horário de Brasília).'
    },
    {
      id: 7,
      title: '7. Encerramento da Competição',
      content: '30 de Setembro de 2026 às 23:59:59 (Horário de Brasília).'
    },
    {
      id: 8,
      title: '8. Duração Oficial',
      content: '30 (trinta) dias corridos ininterruptos de competição.'
    },
    {
      id: 9,
      title: '9. Elegibilidade dos Participantes',
      content: 'Aberto a todos os usuários com conta ativa na plataforma Invictus. O status do plano (Free ou PRO) não concede qualquer vantagem competitiva, multiplicador de pontos ou benefício desportivo.'
    },
    {
      id: 10,
      title: '10. Idade Mínima',
      content: 'Idade mínima de 18 (dezoito) anos completos na data de inscrição, ou a partir de 16 (dezesseis) anos com expressa autorização legal dos responsáveis.'
    },
    {
      id: 11,
      title: '11. Território e Abrangência',
      content: 'Competição válida em todo o território nacional brasileiro.'
    },
    {
      id: 12,
      title: '12. Valor da Inscrição',
      content: 'R$ 49,90 (quarenta e nove reais e noventa centavos) por atleta participante nesta edição.'
    },
    {
      id: 13,
      title: '13. Formas de Pagamento',
      content: 'Pagamento via PIX instantâneo e Cartão de Crédito processados via gateway homologado Asaas.'
    },
    {
      id: 14,
      title: '14. Atividades Válidas',
      content: isArena
        ? 'Sessões de musculação com duração entre 30 e 90 minutos, com check-in de presença na academia do atleta, sensores de movimento ou foto de confirmação quando exigido.'
        : 'Corridas ao ar livre com distância mínima de 1.5 km, telemetria GPS contínua e velocidade fisiologicamente compatível com corrida humana.'
    },
    {
      id: 15,
      title: '15. Atividades Inválidas',
      content: isArena
        ? 'Treinos inferiores a 30 minutos, registros sem presença presencial comprovada, sessões duplicadas ou manipuladas.'
        : 'Corridas em esteira para a categoria outdoor, sessões com perda de sinal GPS, uso de bicicletas/veículos motorizados ou teletransporte de coordenadas.'
    },
    {
      id: 16,
      title: '16. Critérios de Pontuação',
      content: isArena
        ? 'Pontuação calculada com base na consistência diária, tempo sob tensão útil (máx. 90 min/dia) e validação de esforço real auditado pelo Activity Engine.'
        : 'Pontuação baseada em quilometragem percorrida, ritmo (pace) válido, ganho de elevação e frequência de treinos válidos.'
    },
    {
      id: 17,
      title: '17. Ranking Oficial',
      content: 'Ranking atualizado em tempo real no aplicativo após o processamento das atividades pelo motor antifraude de dupla camada.'
    },
    {
      id: 18,
      title: '18. Critérios de Desempate',
      content: '1) Maior número de dias com treinos homologados; 2) Menor índice médio de risco antifraude (Trust Score); 3) Ordem cronológica da primeira atividade homologada.'
    },
    {
      id: 19,
      title: '19. Sistema Antifraude',
      content: 'Todas as atividades passam por análise de integridade física e cinemática (GPS, acelerômetro, giroscópio, Apple Health/Health Connect quando disponíveis e análise de duplicidade).'
    },
    {
      id: 20,
      title: '20. Desclassificação',
      content: 'Tentativa de adulteração de sensores, mock location, compartilhamento de conta ou conduta antidesportiva acarretará desclassificação sumária sem direito a reembolso.'
    },
    {
      id: 21,
      title: '21. Premiação Oficial',
      content: 'O montante total destinado à premiação (Prize Pool) corresponde exatamente a 50% (cinquenta por cento) da Receita Líquida Elegível arrecadada exclusivamente das inscrições deste campeonato.'
    },
    {
      id: 22,
      title: '22. Definição de Receita Líquida Elegível',
      content: CHAMPIONSHIP_CONFIG.NET_ELIGIBLE_REVENUE_DEFINITION
    },
    {
      id: 23,
      title: '23. Distribuição do Top 5',
      content: 'O Prize Pool será distribuído estritamente aos 5 primeiros colocados: 1º Lugar (40%), 2º Lugar (25%), 3º Lugar (15%), 4º Lugar (12%) e 5º Lugar (8%). Totalizando 100% do pote.'
    },
    {
      id: 24,
      title: '24. Homologação dos Resultados',
      content: 'Os resultados preliminares passarão por um período de auditoria técnica de 48 (quarenta e oito) horas após o encerramento da edição para homologação definitiva.'
    },
    {
      id: 25,
      title: '25. Contestação e Recursos',
      content: 'Recursos sobre pontuações e desclassificações podem ser submetidos ao Comitê de Arbitragem em até 24h após a publicação do ranking preliminar via suporte oficial.'
    },
    {
      id: 26,
      title: '26. Pagamento do Prêmio',
      content: 'Os valores homologados serão creditados diretamente na Carteira Digital do Atleta no app Invictus em até 5 (cinco) dias úteis após a homologação final, disponíveis para saque via PIX.'
    },
    {
      id: 27,
      title: '27. Reembolso e Cancelamento',
      content: 'O participante pode exercer o direito de arrependimento em até 7 (sete) dias corridos após o pagamento da inscrição, desde que não tenha submetido atividades pontuáveis ao ranking.'
    },
    {
      id: 28,
      title: '28. Indisponibilidade Técnica',
      content: 'Manutenções programadas serão comunicadas previamente. Falhas pontuais de sinal não autorizam pontuação retroativa sem telemetria comprobatória.'
    },
    {
      id: 29,
      title: '29. Proteção de Dados (LGPD)',
      content: 'O tratamento de dados pessoais segue estritamente a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), com finalidade exclusiva de auditoria e premiação desportiva.'
    },
    {
      id: 30,
      title: '30. Tratamento de Dados Esportivos e de Saúde',
      content: 'Dados de telemetria, GPS e frequência cardíaca são coletados sob consentimento explícito para fins de validação antifraude e geração de métricas competitivas.'
    },
    {
      id: 31,
      title: '31. Saúde e Responsabilidade do Participante',
      content: 'O participante declara estar apto fisicamente e clinicamente para a prática de exercícios intensos, assumindo total responsabilidade por sua integridade física.'
    },
    {
      id: 32,
      title: '32. Disposições Gerais',
      content: 'Casos omissos serão soberanamente decididos pela Diretoria Técnica da Invictus Performance e Soluções Ltda.'
    },
    {
      id: 33,
      title: '33. Versão do Regulamento e Registro Auditável',
      content: 'Regulamento Oficial Versão v1.0 com hash criptográfico registrado e controle de versão imutável na base de dados.'
    },
    {
      id: 34,
      title: '34. Disclaimer Apple Inc.',
      content: CHAMPIONSHIP_CONFIG.APPLE_DISCLAIMER
    }
  ];
}

export const REGULATION_SECTIONS = getRegulationSections('invictus_arena_30d');

class ChampionshipService {
  private getStorageKey(userId: string) {
    return `invictus_championship_regs_${userId}`;
  }

  getChampionships(): Championship[] {
    return INITIAL_CHAMPIONSHIPS;
  }

  getChampionshipById(id: string): Championship | undefined {
    return INITIAL_CHAMPIONSHIPS.find(c => c.id === id);
  }

  getUserRegistrations(userId?: string): ChampionshipRegistration[] {
    if (!userId) return [];
    try {
      const stored = localStorage.getItem(this.getStorageKey(userId));
      if (stored) return JSON.parse(stored);
    } catch {
      // fallback
    }
    return [];
  }

  isUserRegistered(championshipId: string, userId?: string): boolean {
    if (!userId) return false;
    const regs = this.getUserRegistrations(userId);
    return regs.some(r => r.championshipId === championshipId && r.status === 'ACTIVE' && r.paymentStatus === 'PAID');
  }

  getRegistration(championshipId: string, userId?: string): ChampionshipRegistration | undefined {
    if (!userId) return undefined;
    const regs = this.getUserRegistrations(userId);
    return regs.find(r => r.championshipId === championshipId);
  }

  saveRegistration(reg: ChampionshipRegistration): void {
    if (!reg.userId) return;
    try {
      const regs = this.getUserRegistrations(reg.userId);
      const index = regs.findIndex(r => r.championshipId === reg.championshipId);
      if (index >= 0) {
        regs[index] = reg;
      } else {
        regs.push(reg);
      }
      localStorage.setItem(this.getStorageKey(reg.userId), JSON.stringify(regs));
    } catch (e) {
      console.error('Error saving registration', e);
    }
  }

  createPendingRegistration(championship: Championship, userId: string, userName?: string): ChampionshipRegistration {
    const reg: ChampionshipRegistration = {
      id: `reg_${userId}_${championship.id}_${Date.now()}`,
      championshipId: championship.id,
      championshipTitle: championship.title,
      userId,
      userName: userName || 'Atleta Invictus',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      amount: championship.registrationPrice,
      regulationVersion: championship.regulationVersion,
      regulationHash: championship.regulationHash,
      regulationAcceptedAt: new Date().toISOString(),
      externalPaymentReference: `CHAMPIONSHIP_REGISTRATION:${userId}:${championship.id}`,
      createdAt: new Date().toISOString()
    };
    this.saveRegistration(reg);
    return reg;
  }

  confirmPaymentMock(championshipId: string, userId: string): ChampionshipRegistration | undefined {
    const reg = this.getRegistration(championshipId, userId);
    if (!reg) return undefined;
    reg.status = 'ACTIVE';
    reg.paymentStatus = 'PAID';
    reg.paidAt = new Date().toISOString();
    reg.asaasPaymentId = `pay_asaas_${Date.now()}`;
    this.saveRegistration(reg);
    return reg;
  }

  getUserProgress(championshipId: string, userId: string): UserChampionshipProgress {
    // Dynamic progress calculation based on championship
    if (championshipId === 'invictus_arena_30d') {
      return {
        championshipId,
        userId,
        currentRank: 182,
        totalScore: 7650,
        validSessionsCount: 12,
        totalTimeMinutes: 86 * 60,
        progressPercentage: 20,
        daysRemaining: 24,
        lastUpdated: 'Atualizado há 2h'
      };
    }
    return {
      championshipId,
      userId,
      currentRank: 1,
      totalScore: 0,
      validSessionsCount: 0,
      totalTimeMinutes: 0,
      progressPercentage: 0,
      daysRemaining: 30,
      lastUpdated: 'Início em 5 dias'
    };
  }

  getLeaderboard(championshipId: string): Array<{ rank: number; name: string; gym: string; score: number; isUser?: boolean }> {
    if (championshipId === 'invictus_arena_30d') {
      return [
        { rank: 1, name: 'Lucas "Titan" Silva', gym: 'Ironberg SP', score: 14850 },
        { rank: 2, name: 'Rodrigo Mendonça', gym: 'Invictus HQ', score: 13920 },
        { rank: 3, name: 'Marcos Paulo', gym: 'SmartFit Paulista', score: 13200 },
        { rank: 4, name: 'Gabriel Torres', gym: 'Bluefit Jardins', score: 12850 },
        { rank: 5, name: 'Thiago Alencar', gym: 'Academia Corpo & Vida', score: 12100 },
        { rank: 182, name: 'Você', gym: 'Invictus Pro', score: 7650, isUser: true }
      ];
    }
    return [
      { rank: 1, name: 'Danilo Marathon', gym: 'Assessoria Pace', score: 19800 },
      { rank: 2, name: 'Carlos Eduardo', gym: 'Runners Club', score: 18600 },
      { rank: 3, name: 'Felipe Santos', gym: 'Asfalto Brasil', score: 17950 },
      { rank: 4, name: 'Bruno Lima', gym: 'Elite Runners', score: 17200 },
      { rank: 5, name: 'Vitor Hugo', gym: 'Corrida Urbana', score: 16800 }
    ];
  }

  getHistoryResults(): ChampionshipResult[] {
    return [];
  }
}

export const championshipService = new ChampionshipService();
