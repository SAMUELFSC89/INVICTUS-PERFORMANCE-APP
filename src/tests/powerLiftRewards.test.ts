import {
  POWER_LIFT_MASTER_REWARD,
  POWER_LIFT_MODALITY_PODIUM_REWARDS,
  POWER_LIFT_TIER_REWARDS,
  fixedCompetitiveRewardPerSex,
  modalityPodiumRewardCoins,
  tierRewardCoins,
  totalTierRewardForTripleDiamond,
  totalTierRewardPerModality,
} from '../core/powerLift/rewards';

describe('Power Lift — economia de Invictus Coins', () => {
  it('mantém progressão crescente de recompensa por categoria', () => {
    expect(POWER_LIFT_TIER_REWARDS).toEqual({
      FERRO: 20,
      BRONZE: 40,
      PRATA: 60,
      OURO: 100,
      PLATINA: 150,
      DIAMANTE: 300,
    });
    expect(totalTierRewardPerModality()).toBe(670);
    expect(totalTierRewardForTripleDiamond()).toBe(2010);
    expect(tierRewardCoins('UNRANKED')).toBe(0);
    expect(tierRewardCoins('DIAMANTE')).toBe(300);
  });

  it('premia Top 3 por modalidade e reserva o maior prêmio ao Master', () => {
    expect(POWER_LIFT_MODALITY_PODIUM_REWARDS).toEqual({ 1: 1000, 2: 600, 3: 400 });
    expect(modalityPodiumRewardCoins(1)).toBe(1000);
    expect(modalityPodiumRewardCoins(4)).toBe(0);
    expect(POWER_LIFT_MASTER_REWARD).toBe(4000);
  });

  it('fecha orçamento competitivo fixo em 10.000 Coins por sexo/temporada', () => {
    expect(fixedCompetitiveRewardPerSex()).toBe(10000);
  });
});
