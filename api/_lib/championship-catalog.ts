import { Championship } from '../../src/types/championships.js';

/**
 * Campeonatos pagos permanecem fechados até a aprovação de uma edição real.
 * As prévias públicas de musculação e cardio são informativas e não entram
 * neste catálogo servidor-autoritativo, pois não podem aceitar inscrição,
 * aceite de regulamento ou cobrança.
 */
export const CHAMPIONSHIPS: Championship[] = [];

export function listChampionships(): Championship[] {
  return CHAMPIONSHIPS;
}

export function getChampionship(id: string): Championship | undefined {
  return CHAMPIONSHIPS.find(championship => championship.id === id);
}

export function isRegistrationOpen(_championship: Championship, _now: Date = new Date()): boolean {
  return false;
}

/**
 * A lista está vazia enquanto campeonatos pagos estiverem fechados, mas o
 * matcher já aplica a regra de modalidade que será usada quando uma edição
 * real for cadastrada. Isso impede que um Camp de corrida aceite uma bike
 * apenas por ambos serem `cardio`.
 */
export function matchActiveChampionshipsForActivity(params: {
  activityType: string;
  cardioType?: string;
  isIndoorCardio?: boolean;
  when: Date;
}): Championship[] {
  const activityType = String(params.activityType || '').trim().toLowerCase();
  const cardioType = String(params.cardioType || '').trim().toLowerCase();
  const whenMs = params.when.getTime();
  if (!Number.isFinite(whenMs)) return [];

  return CHAMPIONSHIPS.filter((championship) => {
    if (championship.status !== 'active') return false;
    const startMs = Date.parse(championship.startAt);
    const endMs = Date.parse(championship.endAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || whenMs < startMs || whenMs > endMs) return false;

    const expectsCardio = championship.type === 'run_elite_corrida';
    if (expectsCardio !== (activityType === 'cardio')) return false;

    if (expectsCardio) {
      const allowed = (championship.antiFraudProfile?.allowedCardioTypes || [])
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean);
      // Campeonato pago de cardio sem allowlist explícita não aceita nenhuma
      // atividade. A edição precisa declarar, no regulamento congelado, se é
      // corrida, caminhada, bike etc.; omissão de configuração nunca abre o Camp.
      if (allowed.length === 0 || !cardioType || !allowed.includes(cardioType)) return false;
    }

    return true;
  });
}
