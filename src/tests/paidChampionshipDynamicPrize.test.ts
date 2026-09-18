import {
  GUARANTEED_MINIMUM_PRIZE_POOL_BRL,
  platformCutPercentForRegistrants,
  computeDynamicPrizePool,
  scalePrizeDistribution,
  registrationHasClosed,
} from '../../api/_lib/paid-championship-dynamic-prize';

describe('premiação dinâmica dos campeonatos pagos', () => {
  describe('platformCutPercentForRegistrants', () => {
    it('usa 20% com poucos inscritos (abaixo/igual ao piso de 2)', () => {
      expect(platformCutPercentForRegistrants(0)).toBeCloseTo(0.20);
      expect(platformCutPercentForRegistrants(1)).toBeCloseTo(0.20);
      expect(platformCutPercentForRegistrants(2)).toBeCloseTo(0.20);
    });

    it('usa 60% a partir de 50 inscritos', () => {
      expect(platformCutPercentForRegistrants(50)).toBeCloseTo(0.60);
      expect(platformCutPercentForRegistrants(120)).toBeCloseTo(0.60);
    });

    it('interpola linearmente entre 2 e 50 inscritos', () => {
      // ponto médio: 26 inscritos -> metade do caminho entre 20% e 60% = 40%
      expect(platformCutPercentForRegistrants(26)).toBeCloseTo(0.40, 5);
    });
  });

  describe('computeDynamicPrizePool', () => {
    it('nunca fica abaixo do mínimo garantido, mesmo com poucos inscritos', () => {
      // 2 inscritos * 29.90 * (1 - 0.20) = 47.84 -> muito abaixo de 500
      expect(computeDynamicPrizePool(2, 29.90)).toBe(GUARANTEED_MINIMUM_PRIZE_POOL_BRL);
      expect(computeDynamicPrizePool(0, 29.90)).toBe(GUARANTEED_MINIMUM_PRIZE_POOL_BRL);
    });

    it('supera o mínimo garantido quando há inscritos suficientes', () => {
      // 50 inscritos * 29.90 * (1 - 0.60) = 598.00
      const pool = computeDynamicPrizePool(50, 29.90);
      expect(pool).toBeCloseTo(598.00, 2);
      expect(pool).toBeGreaterThan(GUARANTEED_MINIMUM_PRIZE_POOL_BRL);
    });

    it('cresce com o número de inscritos', () => {
      const pool50 = computeDynamicPrizePool(50, 29.90);
      const pool200 = computeDynamicPrizePool(200, 29.90);
      expect(pool200).toBeGreaterThan(pool50);
    });
  });

  describe('scalePrizeDistribution', () => {
    const guaranteed = [
      { rank: 1, amount: 300, percentage: 60, label: '1º lugar' },
      { rank: 2, amount: 120, percentage: 24, label: '2º lugar' },
      { rank: 3, amount: 80, percentage: 16, label: '3º lugar' },
    ];

    it('mantém o total no mínimo garantido quando o pote final é o próprio mínimo', () => {
      const scaled = scalePrizeDistribution(guaranteed, 500);
      const total = scaled.reduce((sum, p) => sum + p.amount, 0);
      expect(Math.round(total * 100) / 100).toBe(500);
      expect(scaled).toHaveLength(3);
    });

    it('escala proporcionalmente e o total bate exatamente com o pote final (sem drift de arredondamento)', () => {
      const scaled = scalePrizeDistribution(guaranteed, 598.00);
      const total = scaled.reduce((sum, p) => sum + p.amount, 0);
      expect(Math.round(total * 100) / 100).toBe(598.00);
      expect(scaled[0].amount).toBeCloseTo(598.00 * 0.6, 1);
    });

    it('preserva as posições e rótulos originais', () => {
      const scaled = scalePrizeDistribution(guaranteed, 1000);
      expect(scaled.map((p) => p.rank)).toEqual([1, 2, 3]);
      expect(scaled.map((p) => p.label)).toEqual(['1º lugar', '2º lugar', '3º lugar']);
    });
  });

  describe('registrationHasClosed', () => {
    const base = {
      registrationClosesAt: '2026-12-01T00:00:00-03:00',
    } as any;

    it('é falso antes do fechamento', () => {
      expect(registrationHasClosed(base, new Date('2026-11-30T00:00:00-03:00'))).toBe(false);
    });

    it('é verdadeiro no momento e depois do fechamento', () => {
      expect(registrationHasClosed(base, new Date('2026-12-01T00:00:00-03:00'))).toBe(true);
      expect(registrationHasClosed(base, new Date('2026-12-02T00:00:00-03:00'))).toBe(true);
    });
  });
});
