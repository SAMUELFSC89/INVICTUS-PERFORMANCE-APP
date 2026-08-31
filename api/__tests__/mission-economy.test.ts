import { DEFAULT_MISSIONS, MISSION_ECONOMY_VERSION } from '../_lib/mission-engine.js';

describe('economia revisada de missões', () => {
  test('mantém a trilha de consistência disponível para FREE e PRO', () => {
    const consistency = DEFAULT_MISSIONS.filter(mission => mission.type === 'consistency_weeks');
    expect(consistency).toHaveLength(3);
    expect(consistency.map(mission => mission.target)).toEqual([2, 3, 4]);
    expect(consistency.map(mission => mission.rewardCoins)).toEqual([100, 100, 200]);
    expect(consistency.every(mission => mission.isFreeAccess && mission.ledgerType === 'CONSISTENCY_REWARD')).toBe(true);
  });

  test('fecha a economia mensal FREE normal em 1.330 Coins com participação', () => {
    const freeWeekly = DEFAULT_MISSIONS
      .filter(mission => mission.category === 'weekly' && mission.isFreeAccess)
      .reduce((sum, mission) => sum + mission.rewardCoins, 0) * 4;
    const freeMonthly = DEFAULT_MISSIONS
      .filter(mission => mission.category === 'monthly' && mission.isFreeAccess)
      .reduce((sum, mission) => sum + mission.rewardCoins, 0);
    expect(freeWeekly + freeMonthly + 50).toBe(1330);
  });

  test('oferece 2.500 Coins adicionais por mês na camada PRO', () => {
    const proWeekly = DEFAULT_MISSIONS
      .filter(mission => mission.category === 'weekly' && !mission.isFreeAccess)
      .reduce((sum, mission) => sum + mission.rewardCoins, 0) * 4;
    const proMonthly = DEFAULT_MISSIONS
      .filter(mission => mission.category === 'monthly' && !mission.isFreeAccess)
      .reduce((sum, mission) => sum + mission.rewardCoins, 0);
    expect(proWeekly + proMonthly).toBe(2500);
    expect(DEFAULT_MISSIONS.every(mission => mission.definitionVersion === MISSION_ECONOMY_VERSION)).toBe(true);
  });

  test('segrega missões base, consistência e missões PRO no ledger', () => {
    const ledgers = new Set(DEFAULT_MISSIONS.map(mission => mission.ledgerType));
    expect(ledgers).toEqual(new Set(['MISSION_REWARD', 'CONSISTENCY_REWARD', 'PRO_MISSION_REWARD']));
  });
});
