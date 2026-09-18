/**
 * Lote 2 / Batch E — ACT-09 (auditoria AUDITORIA_INVICTUS_6167c8f)
 *
 * "PowerLift apaga vídeo já registrado quando a resposta de envio se perde"
 *
 * Cenário do achado: o cliente sobe o vídeo, chama action=submit, mas a
 * RESPOSTA dessa chamada se perde (timeout de 30s, AbortError, rede caindo)
 * depois que o servidor já concluiu a transação e persistiu o registro. O
 * código antigo tratava "não recebi resposta" como sinônimo de "nada foi
 * criado" e apagava o vídeo do Storage incondicionalmente — destruindo a
 * única prova do levantamento e deixando o registro do servidor (que já
 * existia) apontando para um arquivo inexistente, enquanto o atleta via uma
 * mensagem dizendo que nada tinha sido registrado.
 *
 * Estes testes exercitam diretamente `reconcilePowerLiftSubmission`, a
 * função que agora decide o que fazer com o upload quando a resposta
 * original se perde. Ela reenvia a MESMA requisição de submit (o handler do
 * servidor já é idempotente pela combinação usuário+path do vídeo — ver
 * api/_handlers/powerlift.ts) e só permite apagar o vídeo quando o servidor
 * responde de forma definitiva recusando o registro. Qualquer incerteza
 * (sem token, sem rede, resposta inesperada) resulta em NÃO apagar o vídeo.
 */

jest.mock('../pages/PowerLiftSeason.css', () => ({}), { virtual: true });

jest.mock('../firebase', () => ({
  auth: { currentUser: null as any },
  storage: {},
}));

jest.mock('firebase/storage', () => ({
  deleteObject: jest.fn(),
  getDownloadURL: jest.fn(),
  ref: jest.fn(),
  uploadBytesResumable: jest.fn(),
}));

jest.mock('../UserContext', () => ({
  useUser: () => ({ user: null }),
}));

jest.mock('../services/validationService', () => ({
  validationService: { validatePowerVideo: jest.fn() },
}));

jest.mock('../config', () => ({
  API_CONFIG: { baseUrl: '' },
}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
}));

import { auth } from '../firebase';
import { getDownloadURL } from 'firebase/storage';
import { reconcilePowerLiftSubmission } from '../pages/PowerLift';

const mockedGetDownloadURL = getDownloadURL as jest.Mock;

function fakeStorageRef(fullPath = 'power_records/user-1/123_video.mp4') {
  return { fullPath } as any;
}

describe('ACT-09: reconciliação pós-falha de envio do PowerLift', () => {
  beforeAll(() => {
    (global as any).window = {
      setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
      clearTimeout: (...args: Parameters<typeof clearTimeout>) => clearTimeout(...args),
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (auth as any).currentUser = null;
    (global as any).fetch = jest.fn();
    mockedGetDownloadURL.mockResolvedValue('https://example.com/video.mp4');
  });

  it('confirma sem apagar quando o reenvio mostra que o servidor já tinha (ou acabou de criar) o registro', async () => {
    const record = { id: 'power_abc123', userId: 'user-1', exercise: 'supino', weight: 120 };
    (auth as any).currentUser = { getIdToken: jest.fn().mockResolvedValue('token-123') };
    (global as any).fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ record, idempotent: true }),
    });

    const outcome = await reconcilePowerLiftSubmission(fakeStorageRef(), 'supino', 120);

    expect(outcome).toEqual({ status: 'confirmed', record });
    const [url, init] = (global as any).fetch.mock.calls[0];
    expect(String(url)).toContain('action=submit');
    expect(JSON.parse(init.body)).toEqual({ exercise: 'supino', weight: 120, videoUrl: 'https://example.com/video.mp4' });
  });

  it('marca como incerto (não apaga) quando o reenvio também falha por rede', async () => {
    (auth as any).currentUser = { getIdToken: jest.fn().mockResolvedValue('token-123') };
    (global as any).fetch.mockRejectedValue(new Error('network drop'));

    const outcome = await reconcilePowerLiftSubmission(fakeStorageRef(), 'agachamento', 200);

    expect(outcome).toEqual({ status: 'uncertain' });
  });

  it('marca como incerto quando não há sessão/token disponível, sem nunca chamar a rede', async () => {
    (auth as any).currentUser = null;

    const outcome = await reconcilePowerLiftSubmission(fakeStorageRef(), 'terra', 250);

    expect(outcome).toEqual({ status: 'uncertain' });
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('só trata como rejeição real quando o servidor responde de forma definitiva recusando', async () => {
    (auth as any).currentUser = { getIdToken: jest.fn().mockResolvedValue('token-123') };
    (global as any).fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Vídeo inválido para este exercício.' }),
    });

    const outcome = await reconcilePowerLiftSubmission(fakeStorageRef(), 'supino', 120);

    expect(outcome).toEqual({ status: 'rejected', message: 'Vídeo inválido para este exercício.' });
  });

  it('marca como incerto se nem for possível reobter a URL de download do vídeo enviado', async () => {
    (auth as any).currentUser = { getIdToken: jest.fn().mockResolvedValue('token-123') };
    mockedGetDownloadURL.mockRejectedValue(new Error('object vanished'));

    const outcome = await reconcilePowerLiftSubmission(fakeStorageRef(), 'supino', 120);

    expect(outcome).toEqual({ status: 'uncertain' });
    expect((global as any).fetch).not.toHaveBeenCalled();
  });
});
