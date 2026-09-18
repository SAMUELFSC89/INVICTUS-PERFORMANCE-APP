import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Power Lift na aba Campeonatos (campeonato de força gratuito)', () => {
  it('sai por completo da aba Desafios', () => {
    const challenges = read('src/components/ChallengesHubNew.tsx');
    expect(challenges).not.toContain('INVICTUS POWER LIFT');
    expect(challenges).not.toContain("navigate('/power')");
    expect(challenges).not.toContain('dc-powerlift-feature');
  });

  it('mostra o card explicativo com CTA para participar quando o atleta ainda não enviou nenhum levantamento', () => {
    const hub = read('src/pages/championships/ChampionshipsHub.tsx');
    const cards = read('src/pages/championships/ChampionshipCards.tsx');

    expect(hub).toContain('powerLiftService.hasParticipated()');
    expect(hub).toContain('powerLiftParticipating');
    expect(hub).toContain('<PowerLiftFeatureCard onEnroll={() => navigate(\'/power\')} />');
    expect(cards).toContain('export function PowerLiftFeatureCard');
    expect(cards).toContain('PARTICIPAR');
    expect(cards).toContain('INVICTUS POWER LIFT');
  });

  it('troca para o card compacto "participando / ver ranking", igual aos campeonatos pagos, assim que o atleta participa', () => {
    const hub = read('src/pages/championships/ChampionshipsHub.tsx');
    const cards = read('src/pages/championships/ChampionshipCards.tsx');

    expect(hub).toContain('<PaidRankingCard {...powerLiftRankingCard} onOpen={() => navigate(\'/power\')} />');
    expect(cards).toContain('export const powerLiftRankingCard');
    expect(cards).toContain('ch-friends-ranking-card ch-paid-ranking-card');
  });

  it('verifica participação a partir de registros reais do atleta, sem inventar um fluxo de inscrição separado', () => {
    const service = read('src/services/powerLiftService.ts');
    expect(service).toContain("action=me");
    expect(service).toContain('records.length > 0');
  });
});
