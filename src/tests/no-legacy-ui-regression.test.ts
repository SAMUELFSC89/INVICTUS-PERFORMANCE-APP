import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = (relativePath: string) => fs.existsSync(path.join(root, relativePath));

describe('regressão de UI legada', () => {
  test('Layout não remonta badge, sino ou BarbellLifter globais nas telas novas', () => {
    const layout = read('src/components/Layout.tsx');

    expect(layout).not.toContain('barbell-level-btn');
    expect(layout).not.toContain('notification-bell-btn');
    expect(layout).not.toContain("from './BarbellLifter'");
    expect(layout).not.toContain('<BarbellLifter');

    // Rotas de tela cheia que antes deixavam o menu antigo montado por baixo.
    expect(layout).toContain("location.pathname.startsWith('/activity')");
    expect(layout).toContain("location.pathname === '/running'");
    expect(layout).toContain("location.pathname.startsWith('/pagamento/')");
  });

  test('Challenges não contém o catálogo visual antigo por baixo da Hub nova', () => {
    const challenges = read('src/pages/Challenges.tsx');

    expect(challenges).not.toContain('challenge-level-card');
    expect(challenges).not.toContain('challenge-catalogue');
    expect(challenges).not.toContain('challenge-xp-action');
    expect(challenges).not.toContain('challenge-powerlift-art');
    expect(challenges).not.toContain('invictus-power-lift-badge-v2.png');

    expect(challenges).toContain('<ChallengesHubNew');
    expect(challenges).toContain('<ChallengeActivityFlow');
  });

  test('arquivos de telas e componentes substituídos continuam removidos', () => {
    [
      'src/components/BarbellLifter.tsx',
      'src/components/Onboarding.tsx',
      'src/pages/Profile.tsx',
      'src/pages/League.tsx',
      'src/pages/SeasonInscription.tsx',
      'src/pages/Performance.tsx',
      'src/pages/ChampionshipDetails.tsx',
      'src/pages/ChampionshipRegistration.tsx',
      'src/pages/ChampionshipCheckoutAsaas.tsx',
      'src/pages/ChampionshipConfirmation.tsx',
      'src/pages/ChampionshipRegulation.tsx',
      'src/pages/MyChampionships.tsx',
      'src/pages/MyChampionshipDetail.tsx',
    ].forEach((relativePath) => {
      expect(exists(relativePath)).toBe(false);
    });
  });

  test('asset exclusivo do catálogo antigo não volta ao bundle público', () => {
    expect(exists('public/invictus-power-lift-badge-v2.png')).toBe(false);
  });
});
