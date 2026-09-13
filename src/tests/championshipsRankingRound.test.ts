import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('rodada campeonatos e ranking', () => {
  it('remove banner duplicado e seletor de ranking do hub', () => {
    const hub = read('src/pages/championships/ChampionshipsHub.tsx');
    expect(hub).not.toContain('ch-new-hero');
    expect(hub).not.toContain('AcademyRanking');
    expect(hub).not.toContain('ch-section-tabs');
  });

  it('só troca o card de amigos depois da participação e abre ranking pelo compacto', () => {
    const hub = read('src/pages/championships/ChampionshipsHub.tsx');
    const cards = read('src/pages/championships/ChampionshipCards.tsx');
    expect(hub).toContain('communityChampionshipService.status()');
    expect(hub).toContain('friendsEnrolled ?');
    expect(hub).toContain("navigate('/championships/community/ranking')");
    expect(cards).toContain('PARTICIPANDO');
    expect(cards).toContain('VER RANKING');
  });

  it('mantém participação fail-closed quando o status remoto é inconclusivo', () => {
    const hub = read('src/pages/championships/ChampionshipsHub.tsx');
    const community = read('src/pages/championships/CommunityChampionship.tsx');
    expect(hub).toContain('setFriendsEnrolled(null)');
    expect(hub).toContain('friendsStatusError');
    expect(hub).not.toContain('.catch(() => { if (!cancelled) setFriendsEnrolled(false); })');
    expect(community).toContain('statusResolved');
    expect(community).toContain('Confirmando sua participação atual antes de liberar uma nova inscrição');
  });

  it('usa somente o ranking acumulado da temporada', () => {
    const app = read('src/App.tsx');
    const ranking = read('src/pages/championships/CommunityRanking.tsx');
    expect(app).toContain('/championships/community/ranking');
    expect(ranking).toContain('CLASSIFICAÇÃO EXCLUSIVA');
    expect(ranking).toContain('RANKING DA ACADEMIA');
    expect(ranking).toContain("communityChampionshipService.status('all')");
    expect(ranking).toContain('PÓDIO DA TEMPORADA');
    expect(ranking).toContain('OS MAIS DEDICADOS DO ANO');
    expect(ranking).not.toContain('useSearchParams');
    expect(ranking).not.toContain('CommunityRankingPeriod');
    expect(ranking).not.toContain("label: 'SEMANA'");
    expect(ranking).not.toContain("label: 'MÊS'");
  });

  it('mantém o pódio visível vazio sem frases motivacionais entre coroa e base', () => {
    const ranking = read('src/pages/championships/CommunityRanking.tsx');
    const podium = read('src/components/ranking/PodiumTopThree.tsx');
    expect(ranking).toContain('showEmptySlots cleanSeasonLayout');
    expect(podium).toContain('showEmptySlots = false');
    expect(podium).toContain('cleanSeasonLayout = false');
    expect(podium).not.toContain('AGUARDANDO LÍDER');
    expect(podium).not.toContain('SEU NOME PODE ESTAR AQUI');
    expect(podium).not.toContain('TREINE E CONQUISTE ESTA POSIÇÃO');
    expect(podium).not.toContain('MOSTRE SUA EVOLUÇÃO E SUBA NO RANKING');
    expect(podium).toContain('coroa + base, sem');
  });

  it('usa os assets originais e mantém as três posições coerentes como conjunto', () => {
    const podium = read('src/components/ranking/PodiumTopThree.tsx');
    const css = read('src/pages/championships/CommunityRankingPodium.css');
    const powerLift = read('src/pages/PowerLift.tsx');

    expect(podium).toContain('const slots = [2, 1, 3]');
    expect(podium).toContain("2: '/assets/ranking/podium-top2.webp'");
    expect(podium).not.toContain('academy-podium-base--rebuilt');
    expect(css).not.toContain('aspect-ratio: 240 / 130');
    expect(css).not.toContain('content: "2"');

    expect(css).toContain('--podium-lift: 42px');
    expect(css).toContain('--podium-lift: 18px');
    expect(css).toContain('--podium-lift: 0px');
    expect(css).toContain('transform: translateY(calc(-1 * var(--podium-lift))) !important');
    expect(css).toContain('margin-top: 0 !important');

    // A coroa bronze deve ser exatamente a mesma usada no Power Lift e deve
    // manter folga positiva antes da base para o escudo inferior não ser cortado.
    expect(podium).toContain("3: '/ranking-frame-bronze-reference.png'");
    expect(powerLift).toContain("'bronze'}-reference.png");
    expect(css).toContain('.academy-podium-athlete--clean.academy-podium-athlete--3 .academy-podium-avatar');
    expect(css).toContain('width: 76px !important');
    expect(css).toContain('height: 76px !important');
    expect(css).toContain('width: 62px !important');
    expect(css).toContain('height: 62px !important');
    expect(css).toContain('margin-bottom: 7px');
    expect(css).toContain('z-index: 5');
  });

  it('mostra quarto lugar, posição do usuário e ranking completo de forma compacta', () => {
    const ranking = read('src/pages/championships/CommunityRanking.tsx');
    expect(ranking).toContain('4º LUGAR');
    expect(ranking).toContain('MINHA POSIÇÃO');
    expect(ranking).toContain('RANKING COMPLETO');
    expect(ranking).toContain('community-ranking-disclosure');
    expect(ranking).toContain('showFullRanking');
    expect(ranking).not.toContain('O PÓDIO JÁ ESTÁ ABERTO');
  });

  it('não mantém classificação antiga enquanto a temporada recarrega', () => {
    const ranking = read('src/pages/championships/CommunityRanking.tsx');
    expect(ranking).toContain('setStatus(null);');
    expect(ranking).toContain('academy-ranking-state academy-ranking-loading');
  });

  it('preserva caminho de retorno ao abrir perfil pelo ranking', () => {
    const ranking = read('src/pages/championships/CommunityRanking.tsx');
    const profile = read('src/pages/PublicProfile.tsx');
    expect(ranking).toContain("returnTo: '/championships/community/ranking'");
    expect(ranking).toContain('state: { returnTo:');
    expect(profile).toContain('safeReturnTo');
    expect(profile).toContain('navigate(returnTo)');
  });

  it('preserva as coroas e mantém os assets das três bases disponíveis', () => {
    const podium = read('src/components/ranking/PodiumTopThree.tsx');
    expect(podium).toContain('/ranking-frame-gold-reference.png');
    expect(podium).toContain('/ranking-frame-silver-reference.png');
    expect(podium).toContain('/ranking-frame-bronze-reference.png');
    expect(podium).toContain('/assets/ranking/podium-top1.webp');
    expect(podium).toContain('/assets/ranking/podium-top2.webp');
    expect(podium).toContain('/assets/ranking/podium-top3.webp');
  });

  it('recupera confirmação de academia após reload/deep link sem seleção', () => {
    const app = read('src/App.tsx');
    const confirm = read('src/pages/AcademyConfirm.tsx');
    expect(app).toContain("import('./pages/AcademyConfirm')");
    expect(app).toContain('<Route path="/profile/academy/confirm" element={<AcademyConfirm />} />');
    expect(confirm).toContain('SELEÇÃO EXPIRADA');
    expect(confirm).toContain("navigate('/profile/academy/search', { replace: true })");
    expect(confirm).toContain('Number.isFinite');
  });

  it('usa o seletor central de modalidade nos rodapés genéricos auditados', () => {
    const files = [
      'src/pages/ProfileNew.tsx',
      'src/pages/PublicProfile.tsx',
      'src/pages/AcademySearch.tsx',
      'src/pages/AcademyConfirm.tsx',
      'src/pages/championships/ChampionshipsHub.tsx',
      'src/pages/championships/CommunityRanking.tsx',
    ];
    files.forEach((file) => {
      const content = read(file);
      expect(content).toContain("'/activity'");
      expect(content).toContain('Escolher modalidade');
    });
  });
});
