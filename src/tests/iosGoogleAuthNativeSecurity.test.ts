import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.join(process.cwd(), 'ios/App/App/InvictusBridgeViewController.swift'),
  'utf8',
);

// Security assertions about executable Swift must not fail because a comment
// names the unsafe API it is documenting. Keep line comments out of this view
// while preserving the original source for all positive contract checks.
const executableSource = source
  .split('\n')
  .filter(line => !line.trimStart().startsWith('//'))
  .join('\n');

describe('Gate 1 — Google OAuth nativo iOS', () => {
  test('mantém state + PKCE e valida exatamente o callback configurado', () => {
    expect(source).toContain('code_challenge_method", value: "S256"');
    expect(source).toContain('values["state"] == state');
    expect(source).toContain('callbackURL.scheme?.lowercased() == reversedClientID.lowercased()');
    expect(source).toContain('callbackURL.host == nil');
    expect(source).toContain('callbackURL.path == "/oauthredirect"');
  });

  test('parâmetros duplicados falham fechado em vez de derrubar o processo', () => {
    expect(source).toContain('uniqueQueryValues');
    expect(source).toContain('if values[item.name] != nil { return nil }');
    expect(executableSource).not.toContain('Dictionary(uniqueKeysWithValues:');
  });

  test('um segundo login não substitui a sessão OAuth ainda em andamento', () => {
    expect(source).toContain('guard self.authSession == nil else');
    expect(source).toContain('Já existe um login com Google em andamento.');
    expect(source).toContain('self.authSession = nil');
  });
});
