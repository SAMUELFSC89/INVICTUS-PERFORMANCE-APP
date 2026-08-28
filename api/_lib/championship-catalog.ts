import { Championship } from '../../src/types/championships.js';

/**
 * Catalogo OFICIAL e SERVIDOR dos campeonatos.
 *
 * Ate 2026-08 esses mesmos dados existiam duplicados em
 * src/services/championshipService.ts (INITIAL_CHAMPIONSHIPS) e em
 * api/_handlers/championships.ts (ACTIVE_REGULATIONS), os dois hardcoded e
 * SEM Firestore por tras -- inscricao, pagamento e leaderboard eram
 * localStorage/mock/Map em memoria (ver AUDITORIA-CORE-INVICTUS.md).
 *
 * Este arquivo agora e a UNICA fonte de verdade sobre preco, janela de
 * competicao e versao/hash do regulamento vigente. O front consome via
 * GET /api/championships (nunca mais hardcode local), e o backend usa
 * exatamente este catalogo para validar aceite de regulamento e emitir
 * cobranca -- preco e hash que o app mostra sao SEMPRE os que o servidor
 * autoriza, nunca um valor que o cliente possa forjar.
 */
export const CHAMPIONSHIPS: Championship[] = [
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
    // #109: padronizado para R$1 a pedido do usuario, para testar o fluxo
    // completo de inscricao (checkout -> PIX -> webhook -> confirmacao) com
    // dinheiro real de baixo valor. O ambiente Asaas hoje esta configurado
    // para PRODUCAO (nao sandbox) -- este R$1 e cobrado de verdade. Voltar
    // para 49.90 antes de considerar os campeonatos "no ar" para o publico.
    registrationPrice: 1,
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
    // #109: padronizado para R$1 a pedido do usuario, para testar o fluxo
    // completo de inscricao (checkout -> PIX -> webhook -> confirmacao) com
    // dinheiro real de baixo valor. O ambiente Asaas hoje esta configurado
    // para PRODUCAO (nao sandbox) -- este R$1 e cobrado de verdade. Voltar
    // para 49.90 antes de considerar os campeonatos "no ar" para o publico.
    registrationPrice: 1,
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

export function listChampionships(): Championship[] {
  return CHAMPIONSHIPS;
}

export function getChampionship(id: string): Championship | undefined {
  return CHAMPIONSHIPS.find((c) => c.id === id);
}

/** Inscricoes ficam abertas ate o fim oficial da competicao. */
export function isRegistrationOpen(championship: Championship, now: Date = new Date()): boolean {
  return now.getTime() < new Date(championship.endAt).getTime();
}

/**
 * A que campeonato ATIVO (dentro da janela) uma atividade pertence, dado o
 * tipo da atividade salva (`workout` = musculacao, `cardio` outdoor = corrida).
 * Usado pela submissao automatica de pontuacao (championship-scoring-service.ts).
 */
export function matchActiveChampionshipsForActivity(params: {
  activityType: string;
  isIndoorCardio?: boolean;
  when: Date;
}): Championship[] {
  const { activityType, isIndoorCardio, when } = params;
  return CHAMPIONSHIPS.filter((c) => {
    const dentroDaJanela = when.getTime() >= new Date(c.startAt).getTime()
      && when.getTime() <= new Date(c.endAt).getTime();
    if (!dentroDaJanela) return false;

    if (c.type === 'arena_musculacao') {
      return activityType === 'workout';
    }
    if (c.type === 'run_elite_corrida') {
      // Regulamento (secao 15): esteira nao conta para a categoria outdoor.
      return activityType === 'cardio' && isIndoorCardio !== true;
    }
    return false;
  });
}
