// Lote 2 (auditoria 6167c8f), Batch H -- ACT-07 em src/pages/Musculation.tsx.
// Estes testes afirmam o comportamento ESPERADO da correção, não um probe de
// defeito da própria auditoria (que usou "static call/contract trace" sem
// executar nenhuma ação de check-in real).
//
// ACT-07: "Musculação com plano não realiza check-in exigido para
// competição". Quando o atleta tem stakes competitivos reais (ranking da
// comunidade ou inscrição paga ativa), o servidor
// (api/_services/activities/validate-activity-service.ts) sempre exige um
// check-in de academia homologado por geofence para a atividade contar --
// mas iniciar um plano pelo hub Musculação nunca coletava um:
// startSession() recebia location/checkInId undefined incondicionalmente,
// e o atleta só descobria a exigência no ENCERRAMENTO da sessão, caindo em
// fila de revisão manual por falta de geofence mesmo tendo seguido o fluxo
// principal do app.
//
// resolveWorkoutCheckIn() (extraída de Musculation.tsx) resolve isso ANTES
// do início: reaproveita o mesmo preflight que Challenges.tsx já usa para
// corrida/cardio com check-in (hasActiveScoringStakes + performGymCheckIn).
import { resolveWorkoutCheckIn } from '../pages/Musculation';
import { activityService } from '../services/activityService';

jest.mock('../pages/Musculation.css', () => ({}), { virtual: true });
jest.mock('../pages/MusculationAi.css', () => ({}), { virtual: true });
jest.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('../components/OfficialExerciseMedia', () => ({ OfficialExerciseMedia: () => null }));
jest.mock('../components/InvictusLogo', () => ({ InvictusLogo: () => null }));
jest.mock('../UserContext', () => ({ useUser: () => ({ user: null }) }));
jest.mock('../services/workoutPlanService', () => ({
  workoutPlanService: {
    loadDraft: jest.fn(() => null),
    saveDraft: jest.fn(),
    list: jest.fn(async () => []),
    save: jest.fn(),
    generate: jest.fn(),
  },
}));
jest.mock('../services/activityService', () => ({
  activityService: {
    hasActiveScoringStakes: jest.fn(),
    requestMotionPermission: jest.fn(async () => 'granted'),
    performGymCheckIn: jest.fn(),
    startSession: jest.fn(),
  },
}));

const mockedActivityService = activityService as jest.Mocked<typeof activityService>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ACT-07: resolveWorkoutCheckIn() -- preflight de check-in ao iniciar treino de plano', () => {
  test('sem stakes competitivos, não pede permissão de sensor nem faz check-in', async () => {
    mockedActivityService.hasActiveScoringStakes.mockResolvedValue(false);

    const result = await resolveWorkoutCheckIn();

    expect(result).toEqual({ hasStakes: false });
    expect(mockedActivityService.requestMotionPermission).not.toHaveBeenCalled();
    expect(mockedActivityService.performGymCheckIn).not.toHaveBeenCalled();
  });

  test('com stakes competitivos ativos, pede permissão de sensor e confirma o check-in de academia ANTES de retornar', async () => {
    mockedActivityService.hasActiveScoringStakes.mockResolvedValue(true);
    mockedActivityService.performGymCheckIn.mockResolvedValue({
      checkInId: 'checkin-123',
      location: { lat: -23.5, lng: -46.6, accuracy: 8 },
      gymName: 'Academia Invictus',
    });

    const result = await resolveWorkoutCheckIn();

    expect(mockedActivityService.requestMotionPermission).toHaveBeenCalledTimes(1);
    expect(mockedActivityService.performGymCheckIn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      hasStakes: true,
      location: { lat: -23.5, lng: -46.6, accuracy: 8 },
      checkInId: 'checkin-123',
    });
  });

  test('quando o check-in de academia falha (fora da geofence, sem GPS), a falha propaga em vez de deixar a sessão iniciar sem prova de presença', async () => {
    mockedActivityService.hasActiveScoringStakes.mockResolvedValue(true);
    mockedActivityService.performGymCheckIn.mockRejectedValue(new Error('Você não está em uma academia parceira.'));

    await expect(resolveWorkoutCheckIn()).rejects.toThrow('Você não está em uma academia parceira.');
  });
});
