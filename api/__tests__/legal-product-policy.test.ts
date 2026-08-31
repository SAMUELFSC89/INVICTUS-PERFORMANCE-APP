import { CHAMPIONSHIPS, isRegistrationOpen, matchActiveChampionshipsForActivity } from '../_lib/championship-catalog.js';
import {
  CURRENT_LEGAL_VERSION,
  LEGAL_FAQ_100,
  LEGAL_PROMOTIONAL_RULES,
  LEGAL_TERMS_OF_USE,
} from '../../src/lib/legalDocuments.js';

describe('políticas do ecossistema atual', () => {
  it('exige a versão nova dos termos', () => {
    expect(CURRENT_LEGAL_VERSION).toBe(4);
    expect(LEGAL_TERMS_OF_USE).toContain('Versão: 4.0.0');
  });

  it('define Coins como recompensa sem valor monetário ou saque', () => {
    expect(LEGAL_TERMS_OF_USE).toContain('não podem ser sacados via PIX');
    expect(LEGAL_PROMOTIONAL_RULES).toContain('Não têm valor monetário');
  });

  it('mantém campeonato gratuito sem vínculo com academia e pagos em breve', () => {
    expect(LEGAL_TERMS_OF_USE).toContain('sem vínculo, patrocínio ou associação presumida com academias');
    expect(LEGAL_TERMS_OF_USE).toContain('permanecem EM BREVE');
  });

  it('não expõe FAQ legado de ligas, desafios pagos ou saques', () => {
    const categories = new Set(LEGAL_FAQ_100.map(item => item.category));
    expect(categories).not.toContain('Saques & PIX');
    expect(categories).not.toContain('Campeonatos Oficiais');
    expect(categories).toContain('Invictus Coins e Loja');
  });

  it('fecha o catálogo e a pontuação de campeonatos pagos até aprovação', () => {
    expect(CHAMPIONSHIPS).toEqual([]);
    expect(isRegistrationOpen({} as never)).toBe(false);
    expect(matchActiveChampionshipsForActivity({ activityType: 'workout', when: new Date() })).toEqual([]);
  });
});
