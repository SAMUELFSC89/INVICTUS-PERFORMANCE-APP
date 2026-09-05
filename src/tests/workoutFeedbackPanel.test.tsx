import { renderToStaticMarkup } from 'react-dom/server';
import { WorkoutFeedbackPanel } from '../components/health/WorkoutFeedbackPanel';
import type { WorkoutHealthRecord } from '../core/health/workoutHealthTypes';

jest.mock('../ProContext', () => ({ usePro: () => ({ showProInvitation: jest.fn() }) }));
jest.mock('../components/health/WorkoutFeedbackPanel.css', () => ({}));

const start = Date.parse('2026-09-01T10:00:00Z');
const at = (offset: number) => new Date(start + offset * 1000).toISOString();
const record = (): WorkoutHealthRecord => ({
  version: 1, sessionId: 'session-a', startedAt: at(0), endedAt: at(60),
  sets: [{ id: 'set-a', exerciseId: 'squat', exerciseName: 'Agachamento', equipment: 'Barra', startedAt: at(0), endedAt: at(60), status: 'completed', timingSource: 'user_marked', reps: 10, loadKg: 20 }],
  heartRate: { status: 'available', source: 'apple_health', sourceKey: 'watch-a', fetchedAt: at(90), truncated: false, samples: Array.from({ length: 13 }, (_, index) => ({ timestamp: at(index * 5), bpm: 120 })) },
});

beforeEach(() => jest.useFakeTimers({ now: Date.parse('2026-09-05T10:00:00Z') }));
afterEach(() => jest.useRealTimers());

test('Free users retain their readings, entered sets and safety information without Pro exercise interpretation', () => {
  const html = renderToStaticMarkup(<WorkoutFeedbackPanel record={record()} isPro={false} />);
  expect(html).toContain('Média das leituras');
  expect(html).toContain('120');
  expect(html).toContain('Suas séries registradas');
  expect(html).toContain('Agachamento');
  expect(html).toContain('10 repetições');
  expect(html).toContain('Leituras recebidas');
  expect(html).toContain('ligue 192');
  expect(html).toContain('Conhecer o Pro');
  expect(html).not.toContain('Batimentos registrados em Agachamento');
});

test('Pro interpretation shows factual evidence and its limitation, with incomplete history explicit', () => {
  const html = renderToStaticMarkup(<WorkoutFeedbackPanel record={record()} isPro historyStatus={{ status: 'unavailable', reviewedCount: 0, limitReached: false }} />);
  expect(html).toContain('Batimentos registrados em Agachamento');
  expect(html).toContain('120–120 bpm');
  expect(html).toContain('não identificam a causa da variação');
  expect(html).toContain('não confirma melhor desempenho nem determina se o exercício está seguro');
  expect(html).toContain('Nenhuma comparação com sessões anteriores foi feita');
  expect(html).not.toContain('Conhecer o Pro');
});

test('legacy average remains a saved average and never invents exercise attribution, a zone or raw readings', () => {
  const html = renderToStaticMarkup(<WorkoutFeedbackPanel record={null} fallbackAverageBpm={137} isPro />);
  expect(html).toContain('Média salva no treino');
  expect(html).toContain('137');
  expect(html).toContain('Sem FC pontual');
  expect(html).toContain('não informa em qual exercício');
  expect(html).not.toContain('Leituras recebidas');
  expect(html).not.toContain('Zona');
});

test('missing measurements stay absent, and sparse raw values remain accessible without an invented session mean', () => {
  const sparse = record();
  sparse.heartRate.samples = [{ timestamp: at(30), bpm: 160 }];
  const html = renderToStaticMarkup(<WorkoutFeedbackPanel record={sparse} isPro={false} />);
  expect(html).toContain('Leituras incompletas');
  expect(html).toContain('Cobertura insuficiente');
  expect(html).toContain('160 bpm');
  expect(html).not.toContain('160<small>');
  expect(html).toContain('Batimentos por exercício ainda sem base suficiente');
});

test('the bounded history scope is disclosed instead of implying every prior workout was reviewed', () => {
  const html = renderToStaticMarkup(<WorkoutFeedbackPanel record={record()} isPro historyStatus={{ status: 'available', reviewedCount: 30, limitReached: true }} />);
  expect(html).toContain('Limite de 30 registros atingido');
  expect(html).toContain('não representa todo o seu histórico');
});
