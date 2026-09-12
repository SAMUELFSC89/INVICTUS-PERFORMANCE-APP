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
    expect(hub).toContain("setFriendsEnrolled(null)");
    expect(hub).toContain('friendsStatusError');
    expect(hub).not.toContain(".catch(() => { if (!cancelled) setFriendsEnrolled(false); })");
    expect(community).toContain('statusResolved');
    expect(community).toContain('Confirmando sua participação atual antes de liberar uma nova inscrição');
  });

  it('constrói ranking dedicado a partir do visual aprovado', () => {
    const app = read('src/App.tsx');
    const ranking = read('src/pages/championships/CommunityRanking.tsx');
    expect(app).toContain('/championships/community/ranking');
    expect(ranking).toContain('CLASSIFICAÇÃO EXCLUSIVA');
    expect(ranking).toContain('RANKING DA ACADEMIA');
    expect(ranking).toContain('TOP 3');
    expect(ranking).toContain('SEMANA');
    expect(ranking).toContain('MÊS');
    expect(ranking).toContain('TEMPORADA');
    expect(ranking).toContain('SUA POSIÇÃO');
  });

  it('não mantém classificação antiga enquanto outro período carrega', () => {
    const ranking = read('src/pages/championships/CommunityRanking.tsx');
    expect(ranking).toContain('setStatus(null);');
    expect(ranking).toContain("loading ? <section className=\"academy-ranking-state academy-ranking-loading\"");
  });

  it('preserva coroas e usa as três bases de pódio aprovadas', () => {
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
});
