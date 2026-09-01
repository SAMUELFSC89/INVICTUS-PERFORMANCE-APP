import { calculatePace, formatPaceFromSpeed, formatPaceValue } from '../lib/runUtils';

describe('Métricas de corrida', () => {
  it('calcula o pace médio com segundos reais e arredondamento correto', () => {
    expect(formatPaceValue(5, 25 * 60 + 30)).toBe(`5'06"`);
    expect(calculatePace(5000, 25 * 60 + 30)).toBe(`5'06"/km`);
  });

  it('converte a velocidade instantânea para pace equivalente', () => {
    expect(formatPaceFromSpeed(12)).toBe(`5'00"`);
    expect(formatPaceFromSpeed(0)).toBeNull();
  });

  it('não inventa ritmo quando faltam distância ou tempo', () => {
    expect(formatPaceValue(0, 60)).toBeNull();
    expect(formatPaceValue(1, 0)).toBeNull();
  });
});
