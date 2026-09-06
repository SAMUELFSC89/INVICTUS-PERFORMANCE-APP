// SEC-03 (auditoria 6167c8f): a pagina publica de compartilhamento inseria
// displayName/city/photoUrl direto no HTML/CSS sem escape -- um nome como
// `</title><script>...` fechava a tag <title> e injetava marcacao executavel
// para qualquer visitante do link, sem precisar de conta nem autenticacao.
// Estes testes cobrem o comportamento ESPERADO (nomes maliciosos aparecem
// como texto literal, nunca como marcacao), nao o defeito reproduzido pelos
// probes da auditoria.
import handler from '../_handlers/share';

const mockWorkoutGet = jest.fn();
const mockSessionGet = jest.fn();
const mockUserGet = jest.fn();

jest.mock('../_lib/common', () => ({
  db: {
    collection: (name: string) => {
      if (name === 'workouts') return { doc: () => ({ get: () => mockWorkoutGet() }) };
      if (name === 'run_sessions') return { doc: () => ({ get: () => mockSessionGet() }) };
      if (name === 'users') return { doc: () => ({ get: () => mockUserGet() }) };
      throw new Error(`unexpected collection ${name}`);
    },
  },
}));

function response() {
  const res: any = { status: jest.fn(), send: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  res.send.mockReturnValue(res);
  return res;
}

function request(id: string) {
  return { query: { id }, headers: { host: 'www.invictusperformance.app.br' } } as any;
}

describe('SEC-03: escape de HTML na página pública de compartilhamento', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionGet.mockResolvedValue({ exists: false });
  });

  test('nome de usuário com tags/script aparece escapado, nunca como marcação executável', async () => {
    const maliciousName = '</title><script>window.__pwned = 1</script>';
    mockWorkoutGet.mockResolvedValue({ data: () => ({ userId: 'u1', type: 'workout', status: 'valid', points: 10 }) });
    mockUserGet.mockResolvedValue({ data: () => ({ displayName: maliciousName, city: 'São Paulo' }) });

    const res = response();
    await handler(request('workout123'), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const html = res.send.mock.calls[0][0] as string;
    // O payload nunca deve sobreviver como tag real.
    expect(html).not.toContain('<script>window.__pwned');
    expect(html).not.toMatch(/<\/title>\s*<script>/);
    // A versão escapada (entidades HTML) deve estar presente como texto.
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;');
  });

  test('cidade com aspas/tags é escapada no atributo/texto', async () => {
    const maliciousCity = '"><img src=x onerror=alert(1)>';
    mockWorkoutGet.mockResolvedValue({ data: () => ({ userId: 'u1', type: 'workout', status: 'pending' }) });
    mockUserGet.mockResolvedValue({ data: () => ({ displayName: 'Atleta Normal', city: maliciousCity }) });

    const res = response();
    await handler(request('workout456'), res);

    const html = res.send.mock.calls[0][0] as string;
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('photoUrl com esquema javascript: é descartado, não entra no HTML', async () => {
    mockWorkoutGet.mockResolvedValue({ data: () => ({ userId: 'u1', type: 'cardio', status: 'valid', photoUrl: "javascript:alert(1)//.png" }) });
    mockUserGet.mockResolvedValue({ data: () => ({ displayName: 'Atleta Normal' }) });

    const res = response();
    await handler(request('workout789'), res);

    const html = res.send.mock.calls[0][0] as string;
    expect(html).not.toContain('javascript:alert(1)');
  });

  test('photoUrl http(s) legítimo continua funcionando normalmente', async () => {
    mockWorkoutGet.mockResolvedValue({ data: () => ({ userId: 'u1', type: 'cardio', status: 'valid', photoUrl: 'https://cdn.invictusperformance.app.br/foto.jpg' }) });
    mockUserGet.mockResolvedValue({ data: () => ({ displayName: 'Atleta Normal' }) });

    const res = response();
    await handler(request('workout999'), res);

    const html = res.send.mock.calls[0][0] as string;
    expect(html).toContain("url('https://cdn.invictusperformance.app.br/foto.jpg')");
  });

  test('id fora do formato alfanumérico é rejeitado antes de tocar o banco', async () => {
    const res = response();
    await handler(request('"><script>alert(1)</script>'), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockWorkoutGet).not.toHaveBeenCalled();
  });
});
