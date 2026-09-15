import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('PRO frontend gates — admin lifecycle', () => {
  test('recurso PRO depende somente da política canônica de entitlement', () => {
    const source = read('src/components/ProFeatureGate.tsx');

    expect(source).toContain('if (hasActiveProEntitlement(user))');
    expect(source).not.toContain("user?.role === 'admin'");
    expect(source).not.toContain("user.role === 'admin'");
  });

  test('paywall global não reabre acesso por role admin bruto', () => {
    const source = read('src/components/AuthGuard.tsx');

    expect(source).toContain('const isPaid = hasBasicAccess || hasActiveProEntitlement(user);');
    expect(source).not.toContain("hasActiveProEntitlement(user) || user?.role === 'admin'");
  });

  test('a política canônica rejeita lifecycle restrito antes do bypass funcional de admin', () => {
    const source = read('src/lib/proEntitlement.ts');
    const restriction = source.indexOf('if (isRestrictedProfile(data)) return false;');
    const admin = source.indexOf("if (normalized(data.role) === 'admin') return true;");

    expect(restriction).toBeGreaterThan(-1);
    expect(admin).toBeGreaterThan(restriction);
  });
});
