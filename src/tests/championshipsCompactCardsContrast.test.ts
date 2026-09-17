import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('campeonatos compactos e contraste', () => {
  it('troca campeonatos pagos confirmados por cards compactos de participação', () => {
    const hub = read('src/pages/championships/ChampionshipsHub.tsx');
    const cards = read('src/pages/championships/ChampionshipCards.tsx');

    expect(hub).toContain('championshipService.getUserRegistrations()');
    expect(hub).toContain("registration.status === 'ACTIVE'");
    expect(hub).toContain("registration.paymentStatus === 'PAID'");
    expect(hub).toContain('registration.editionId === championship.editionId');
    expect(hub).toContain('<PaidRankingCard {...strengthPreviewCard}');
    expect(hub).toContain('<PaidRankingCard {...cardioPreviewCard}');
    expect(cards).toContain('ch-paid-ranking-card');
    expect(cards).toContain('PARTICIPANDO');
    expect(cards).toContain('VER RANKING');
  });

  it('abre força e cardio com o mesmo layout visual do ranking da temporada', () => {
    const app = read('src/App.tsx');
    const hub = read('src/pages/championships/ChampionshipsHub.tsx');
    const ranking = read('src/pages/championships/PaidChampionshipRanking.tsx');
    const podium = read('src/components/ranking/PodiumTopThree.tsx');

    expect(app).toContain('/championships/ranking/musculacao');
    expect(app).toContain('/championships/ranking/cardio');
    expect(hub).toContain("navigate('/championships/ranking/musculacao')");
    expect(hub).toContain("navigate('/championships/ranking/cardio')");
    expect(ranking).toContain('championshipService.getLeaderboard(championshipId)');
    expect(ranking).toContain('community-ranking-top3');
    expect(ranking).toContain('community-ranking-summary');
    expect(ranking).toContain('<PodiumTopThree');
    expect(ranking).toContain('scoreUnit="PTS"');
    expect(ranking).toContain('RANKING ATUAL');
    expect(ranking).toContain('MINHA POSIÇÃO');
    expect(ranking).toContain('RANKING COMPLETO');
    expect(podium).toContain("scoreUnit = 'IGA'");
    expect(podium).toContain('?v=20260917');
  });

  it('mantém texto claro em superfícies fixas escuras mesmo com tema claro', () => {
    const boot = read('src/boot.tsx');
    const css = read('src/styles/fixedDarkSurfaces.css');

    expect(boot).toContain("import './styles/fixedDarkSurfaces.css';");
    expect(css).toContain('.ch-new-screen');
    expect(css).toContain('[aria-labelledby="competitive-hr-title"]');
    expect(css).toContain('[aria-label="Aceites obrigatórios da inscrição"]');
    expect(css).toContain('[aria-label="Termos de Uso e Integridade"]');
    expect(css).toContain('--invictus-ui-muted: #d0cbc3');
    expect(css).toContain('color: #fff !important');
    expect(css).toContain('color: #d7d2ca !important');
  });

  it('reforça contraste dos resumos e regulamentos oficiais sem aumentar tipografia', () => {
    const css = read('src/styles/fixedDarkSurfaces.css');
    const contrastRules = css.split('/* Campeonatos oficiais já inscritos')[0];
    expect(contrastRules).toContain('[aria-label="Informações do campeonato"] > details > summary b');
    expect(contrastRules).toContain('[aria-label="Informações do campeonato"] > details > summary small');
    expect(contrastRules).toContain('.paid-rules p');
    expect(contrastRules).not.toContain('font-size:');
  });
});
