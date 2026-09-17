import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('tema padrão único do Invictus', () => {
  it('força o tema padrão antes do primeiro render', () => {
    const boot = read('src/boot.tsx');
    expect(boot).toContain("const STANDARD_THEME = 'dark';");
    expect(boot).toContain("localStorage.setItem('theme', STANDARD_THEME)");
    expect(boot).toContain("document.documentElement.setAttribute('data-theme', STANDARD_THEME)");
    expect(boot).toContain('enforceStandardTheme();');
  });

  it('remove a escolha de tema da tela de configurações', () => {
    const boot = read('src/boot.tsx');
    const css = read('src/styles/standardTheme.css');
    expect(boot).toContain("import './styles/standardTheme.css';");
    expect(css).toContain('.profile-flow-list > button:has(svg.lucide-moon)');
    expect(css).toContain('display: none !important');
  });
});
