// SEC-03 (auditoria 6167c8f): a pagina publica de compartilhamento inseria
// displayName/city/photoUrl direto no HTML/CSS sem escape -- um nome como
// `</title><script>...` fechava a tag <title> e injetava marcacao executavel
// para qualquer visitante do link, sem precisar de conta nem autenticacao.
// Estes testes cobrem o comportamento ESPERADO pelo fluxo atual: o visitante
// precisa de um grant aleatorio/revogavel valido e, depois de autorizado, os
// dados editaveis continuam escapados antes de entrar no HTML/CSS.
import handler from '../_handlers/share';

const SHARE_TOKEN = 'AAAAAAAAAAAAAAAAAAAAAAAA';
const mockGrantGet = jest.fn();
const mockWorkoutGet = jest.fn();
const mockSessionGet = jest.fn();
const mockUserGet = jest.fn();

jest.mock('../_lib/common', () => ({
  db: {
    collection: (name: string) => {
      if (name === 'activity_share_grants') return { doc: () => ({ get: () => mockGrantGet() }) };
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
    mockGrantGet.mockResolvedValue({
      exists: true,
      data: () => ({
        activityId: 'workout123',
        userId: 'u1',
        source: 'workouts',
        revokedAt: null,
      }),
    });
    mockSessionGet.mockResolvedValue({ exists: false });
  });

  test('nome de usuário com tags/script aparece escapado, nunca como marcação executável', async () => {
    const maliciousName = '</title><script>window.__pwned = 1</script>';
    mockWorkoutGet.mockResolvedValue({ exists: true, data: () => ({ userId: 'u1', type: 'workout', status: 'valid', points: 10 }) });
    mockUserGet.mockResolvedValue({ exists: true, data: () => ({ displayName: maliciousName, city: 'São Paulo' }) });

    const res = response();
    await handler(request(SHARE_TOKEN), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const html = res.send.mock.calls[0][0] as string;
    // O payload nunca deve sobreviver como tag real.
    expect(html).not.toContain('<script>window.__pwned');
    expect(html).not.toMatch(/<\/title>\s*<script>/);
    // A versão escapada (entidades HTML) deve estar presente como texto.
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;');
  });

  test('cidade com aspas/tags é escapada no atributo/texto', async () => {
    const maliciousCity = '\"><img src=x onerror=alert(1)>';
    mockWorkoutGet.mockResolvedValue({ exists: true, data: () => ({ userId: 'u1', type: 'workout', status: 'pending' }) });
    mockUserGet.mockResolvedValue({ exists: true, data: () => ({ displayName: 'Atleta Normal', city: maliciousCity }) });

    const res = response();
    await handler(request(SHARE_TOKEN), res);

    const html = res.send.mock.calls[0][0] as string;
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('photoUrl com esquema javascript: é descartado, não entra no HTML', async () => {
    mockWorkoutGet.mockResolvedValue({ exists: true, data: () => ({ userId: 'u1', type: 'cardio', status: 'valid', photoUrl: "javascript:alert(1)//.png" }) });
    mockUserGet.mockResolvedValue({ exists: true, data: () => ({ displayName: 'Atleta Normal' }) });

    const res = response();
    await handler(request(SHARE_TOKEN), res);

    const html = res.send.mock.calls[0][0] as string;
    expect(html).not.toContain('javascript:alert(1)');
  });

  test('photoUrl HTTPS de origem confiável continua funcionando normalmente', async () => {
    const photoUrl = 'https://firebasestorage.googleapis.com/v0/b/invictus/o/foto.jpg?alt=media';
    mockWorkoutGet.mockResolvedValue({ exists: true, data: () => ({ userId: 'u1', type: 'cardio', status: 'valid', photoUrl }) });
    mockUserGet.mockResolvedValue({ exists: true, data: () => ({ displayName: 'Atleta Normal' }) });

    const res = response();
    await handler(request(SHARE_TOKEN), res);

    const html = res.send.mock.calls[0][0] as string;
    expect(html).toContain(`url('${photoUrl}')`);
  });

  test('token fora do formato é rejeitado antes de tocar atividade ou grant', async () => {
    const res = response();
    await handler(request('\"><script>alert(1)</script>'), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockGrantGet).not.toHaveBeenCalled();
    expect(mockWorkoutGet).not.toHaveBeenCalled();
  });

  test('workoutId interno antigo não funciona mais como autorização pública', async () => {
    const res = response();
    await handler(request('workout123'), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockWorkoutGet).not.toHaveBeenCalled();
  });

  test('requisição sem token continua sendo erro de formato', async () => {
    const res = response();
    await handler({ query: {}, headers: { host: 'www.invictusperformance.app.br' } } as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockWorkoutGet).not.toHaveBeenCalled();
  });
});
