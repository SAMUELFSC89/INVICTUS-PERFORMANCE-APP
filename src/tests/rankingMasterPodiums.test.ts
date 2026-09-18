import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const asset = (file: string) => path.join(process.cwd(), 'public', 'assets', 'ranking', file);

describe('master podiums dos rankings Invictus', () => {
  it('versiona os quatro assets master 4:5', () => {
    for (const file of [
      'podium-academy-v1.webp',
      'podium-musculacao-v1.webp',
      'podium-cardio-v1.webp',
      'podium-powerlift-v1.webp',
    ]) {
      expect(fs.existsSync(asset(file))).toBe(true);
      expect(fs.statSync(asset(file)).size).toBeGreaterThan(5_000);
    }
  });

  it('usa um único cenário por ranking e mantém os avatares dinâmicos', () => {
    const podium = read('src/components/ranking/PodiumTopThree.tsx');
    expect(podium).toContain("theme?: PodiumTheme");
    expect(podium).toContain("podium-academy-v1.webp");
    expect(podium).toContain("podium-musculacao-v1.webp");
    expect(podium).toContain("podium-cardio-v1.webp");
    expect(podium).toContain('academy-podium-master-slot');
    expect(podium).toContain('entry.photoURL || fallbackAvatar');
  });

  it('seleciona o tema correto em academia, musculação e cardio', () => {
    const community = read('src/pages/championships/CommunityRanking.tsx');
    const paid = read('src/pages/championships/PaidChampionshipRanking.tsx');

    expect(community).toContain('theme="academy"');
    expect(paid).toContain('theme={isStrength ? "musculacao" : "cardio"}');
  });

  it('calibra posições específicas dos avatares sobre os três aros', () => {
    const css = read('src/pages/championships/CommunityRankingPodium.css');
    expect(css).toContain('.academy-podium--master-musculacao');
    expect(css).toContain('.academy-podium--master-cardio');
    expect(css).toContain('.academy-podium-master-slot--1');
    expect(css).toContain('.academy-podium-master-slot--2');
    expect(css).toContain('.academy-podium-master-slot--3');
  });

  it('aplica o quarto asset ao Power Lift e preserva foto real do atleta', () => {
    const power = read('src/pages/PowerLift.tsx');
    const css = read('src/pages/PowerLiftNew.css');

    expect(power).toContain('/assets/ranking/podium-powerlift-v1.webp');
    expect(power).toContain('row.userPhoto');
    expect(power).toContain('power-podium-master-slot');
    expect(css).toContain('.power-podium-master-slot--1');
    expect(css).toContain('.power-podium-master-slot--2');
    expect(css).toContain('.power-podium-master-slot--3');
  });
});
