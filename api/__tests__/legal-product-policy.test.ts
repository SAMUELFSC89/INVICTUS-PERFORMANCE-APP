import { CHAMPIONSHIPS, isRegistrationOpen, matchActiveChampionshipsForActivity } from '../_lib/championship-catalog.js';
import {
  CURRENT_LEGAL_VERSION,
  LEGAL_FAQ_100,
  LEGAL_PROMOTIONAL_RULES,
  LEGAL_TERMS_OF_USE,
} from '../../src/lib/legalDocuments.js';

describe('políticas do ecossistema atual', () => {
  it('exige a versão nova dos termos', () => {
    expect(CURRENT_LEGAL_VERSION).toBe(5);
    expect(LEGAL_TERMS_OF_USE).toContain('Versão: 5.0.0');
  });

  it('define Coins como recompensa sem valor monetário ou saque', () => {
    expect(LEGAL_TERMS_OF_USE).toContain('não podem ser sacados via PIX');
    expect(LEGAL_PROMOTIONAL_RULES).toContain('Não têm valor monetário');
  });

  it('mantém campeonato gratuito sem vínculo com academia e pagos condicionados a edição publicada', () => {
    expect(LEGAL_TERMS_OF_USE).toContain('sem vínculo, patrocínio ou associação presumida com academias');
    expect(LEGAL_TERMS_OF_USE).toContain('Sem edição publicada com organizador, datas, preço, critérios, premiação e regulamento específico aprovados, não haverá inscrição ou cobrança.');
  });

  it('não expõe FAQ legado de ligas, desafios pagos ou saques', () => {
    const categories = new Set(LEGAL_FAQ_100.map(item => item.category));
    expect(categories).not.toContain('Saques & PIX');
    expect(categories).not.toContain('Campeonatos Oficiais');
    expect(categories).toContain('Invictus Coins e Loja');
  });

  it('publica as duas ofertas, mas mantém inscrição e pontuação fechadas por padrão', () => {
    expect(CHAMPIONSHIPS.map((championship) => championship.id).sort()).toEqual([
      'invictus_cardio_v1',
      'invictus_strength_v1',
    ]);
    expect(CHAMPIONSHIPS.every((championship) => championship.registrationPrice === 29.9)).toBe(true);
    expect(CHAMPIONSHIPS.every((championship) => isRegistrationOpen(championship) === false)).toBe(true);
    expect(matchActiveChampionshipsForActivity({ activityType: 'workout', when: new Date() })).toEqual([]);
    expect(matchActiveChampionshipsForActivity({ activityType: 'cardio', cardioType: 'running', when: new Date() })).toEqual([]);
  });
});
