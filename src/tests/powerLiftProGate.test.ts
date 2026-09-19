import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('Power Lift é 100% PRO — gates frontend', () => {
  test('a rota /power usa a mesma política canônica dos outros recursos PRO (ProFeatureGate)', () => {
    const app = read('src/App.tsx');

    expect(app).toContain("<Route path=\"/power\" element={<ProFeatureGate feature=\"powerlift\"><PowerLift /></ProFeatureGate>} />");
  });

  test('ProFeatureGate reconhece a feature powerlift sem duplicar checagem de admin', () => {
    const gate = read('src/components/ProFeatureGate.tsx');

    expect(gate).toContain("type Feature = 'health' | 'ai' | 'powerlift';");
    expect(gate).toContain('if (hasActiveProEntitlement(user))');
    expect(gate).not.toContain("user?.role === 'admin'");
  });

  test('card de Power Lift em Campeonatos continua visível e sinaliza PRO sem abrir um paywall próprio', () => {
    const cards = read('src/pages/championships/ChampionshipCards.tsx');
    const hub = read('src/pages/championships/ChampionshipsHub.tsx');

    expect(cards).toContain('CAMPEONATO DE FORÇA · PRO');
    expect(cards).not.toContain('CAMPEONATO DE FORÇA · GRÁTIS');
    // O card não decide sozinho quem entra: sempre navega para /power e deixa
    // o ProFeatureGate da rota abrir o paywall PRO já existente no app.
    expect(hub).toContain("<PowerLiftFeatureCard onEnroll={() => navigate('/power')} pro={paid} />");
  });
});
