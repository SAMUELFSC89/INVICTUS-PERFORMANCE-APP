import { db } from './common.js';
import type { Championship, PrizeRank } from '../../src/types/championships.js';

/**
 * Pote dinâmico de premiação dos campeonatos pagos (Musculação/Cardio).
 *
 * Decisão do usuário (29/08/2026): a premiação PUBLICADA — a que trava o
 * `publishedConfigDigest`/edition lock em `paid-championship-edition.ts` e que
 * satisfaz a exigência da Apple de "prize amounts/positions final and visible
 * in-app" antes da inscrição — é sempre um MÍNIMO GARANTIDO fixo (hoje R$500,
 * configurado via `CHAMPIONSHIP_*_PRIZES_JSON` em `championship-catalog.ts`).
 * "minimo de 500 de premio, so mostre isso" foi a instrução explícita: o app só
 * mostra essa garantia fixa até o fechamento das inscrições.
 *
 * O valor final de fato pago pode ser maior: a plataforma fica com uma fatia
 * menor da receita de inscrição quando há poucos inscritos pagos (20% a partir
 * de 2 inscritos) e com a fatia cheia (60%) a partir de 50 inscritos pagos,
 * interpolado linearmente entre esses dois pontos. Se o pote calculado ficar
 * abaixo do mínimo garantido, a plataforma absorve a diferença — nunca paga
 * menos que o mínimo publicado.
 *
 * Este valor dinâmico NUNCA entra no `publishedConfigDigest`: ele depende do
 * número de inscritos pagos, que muda a cada checkout, e o digest precisa ficar
 * estável durante toda a janela de inscrição (é o que `lockPaidChampionshipEdition`
 * exige para não bloquear novos checkouts — ver `paid-championship-edition.ts`).
 * Ele é usado só em dois lugares: (a) exibição, revelada somente depois que as
 * inscrições fecham (`listChampionshipsHandler` em `championships.ts`); e
 * (b) o pagamento de fato no settlement (`paid-championship-settlement.ts`).
 */

export const GUARANTEED_MINIMUM_PRIZE_POOL_BRL = 500;

const PLATFORM_CUT_FLOOR = 0.20; // a partir de 2 inscritos pagos
const PLATFORM_CUT_CEILING = 0.60; // a partir de 50 inscritos pagos
const PLATFORM_CUT_FLOOR_REGISTRANTS = 2;
const PLATFORM_CUT_CEILING_REGISTRANTS = 50;

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Fatia da plataforma sobre a receita de inscrições, escalada pelo número de inscritos pagos. */
export function platformCutPercentForRegistrants(paidRegistrantCount: number): number {
  const n = Math.max(0, Math.floor(Number(paidRegistrantCount) || 0));
  if (n <= PLATFORM_CUT_FLOOR_REGISTRANTS) return PLATFORM_CUT_FLOOR;
  if (n >= PLATFORM_CUT_CEILING_REGISTRANTS) return PLATFORM_CUT_CEILING;
  const progress = (n - PLATFORM_CUT_FLOOR_REGISTRANTS) / (PLATFORM_CUT_CEILING_REGISTRANTS - PLATFORM_CUT_FLOOR_REGISTRANTS);
  return PLATFORM_CUT_FLOOR + (PLATFORM_CUT_CEILING - PLATFORM_CUT_FLOOR) * progress;
}

/** Pote final calculado a partir do número de inscritos pagos, nunca abaixo do mínimo garantido. */
export function computeDynamicPrizePool(paidRegistrantCount: number, entryPrice: number): number {
  const n = Math.max(0, Math.floor(Number(paidRegistrantCount) || 0));
  const grossRevenue = n * Math.max(0, Number(entryPrice) || 0);
  const cut = platformCutPercentForRegistrants(n);
  const computedPool = grossRevenue * (1 - cut);
  return money(Math.max(GUARANTEED_MINIMUM_PRIZE_POOL_BRL, computedPool));
}

/**
 * Escala a distribuição garantida (percentuais fixos por posição) para o pote
 * final calculado, corrigindo o arredondamento no 1º lugar para o total bater
 * exatamente com `finalPool`.
 */
export function scalePrizeDistribution(guaranteedDistribution: PrizeRank[], finalPool: number): PrizeRank[] {
  if (!guaranteedDistribution.length) return [];
  const guaranteedPool = guaranteedDistribution.reduce((sum, prize) => sum + prize.amount, 0);
  if (guaranteedPool <= 0) return guaranteedDistribution;
  const ratio = finalPool / guaranteedPool;
  const scaled = guaranteedDistribution.map((prize) => ({ ...prize, amount: money(prize.amount * ratio) }));
  const scaledSum = money(scaled.reduce((sum, prize) => sum + prize.amount, 0));
  const drift = money(finalPool - scaledSum);
  if (drift !== 0 && scaled.length) {
    scaled[0] = { ...scaled[0], amount: money(scaled[0].amount + drift) };
  }
  return scaled;
}

/** Conta, via agregação live do Firestore, quantos inscritos pagos a edição já tem. */
export async function countPaidRegistrants(editionId: string): Promise<number> {
  if (!editionId) return 0;
  const snap = await db.collection('championship_registrations')
    .where('editionId', '==', editionId)
    .where('status', '==', 'paga')
    .where('paymentStatus', '==', 'PAID')
    .count()
    .get();
  return snap.data().count || 0;
}

export interface FinalPrizeComputation {
  prizePool: number;
  prizeDistribution: PrizeRank[];
  paidRegistrantCount: number;
}

/**
 * Calcula o pote/distribuição final de fato (para revelação pós-fechamento das
 * inscrições e para o pagamento no settlement), a partir do número real de
 * inscritos pagos desta edição.
 */
export async function computeFinalPrizeForEdition(championship: Championship): Promise<FinalPrizeComputation> {
  const paidRegistrantCount = await countPaidRegistrants(championship.editionId);
  const prizePool = computeDynamicPrizePool(paidRegistrantCount, championship.registrationPrice);
  const prizeDistribution = scalePrizeDistribution(championship.prizeDistribution, prizePool);
  return { prizePool, prizeDistribution, paidRegistrantCount };
}

/** Verdadeiro quando o prazo de inscrição publicado já passou (momento da revelação). */
export function registrationHasClosed(championship: Championship, now: Date = new Date()): boolean {
  const closesAt = Date.parse(championship.registrationClosesAt || '');
  return Number.isFinite(closesAt) && now.getTime() >= closesAt;
}
