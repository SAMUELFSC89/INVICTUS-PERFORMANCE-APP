import handler from '../_handlers/habits';
import { cors, verifyAuth } from '../_lib/common';

jest.mock('../_lib/common', () => ({
  cors: jest.fn(() => false),
  verifyAuth: jest.fn(),
  // Deliberately no database: retired requests must never access historical data.
}));

function response() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  (cors as jest.Mock).mockReturnValue(false);
  (verifyAuth as jest.Mock).mockResolvedValue({ uid: 'user-A' });
});

test.each(['GET', 'POST', 'PUT', 'DELETE'])('%s cannot restart or mutate legacy goals', async method => {
  const res = response();
  await handler({ method, body: { action: 'create', userId: 'user-B' } }, res);
  expect(res.status).toHaveBeenCalledWith(410);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    code: 'HABIT_FLOW_RETIRED', nextRoute: '/challenges/cardio/objective',
  }));
});

test('still requires authentication', async () => {
  (verifyAuth as jest.Mock).mockResolvedValue(null);
  const res = response();
  await handler({ method: 'GET' }, res);
  expect(res.status).toHaveBeenCalledWith(401);
});

test('preflight is handled before authentication', async () => {
  (cors as jest.Mock).mockReturnValue(true);
  const res = response();
  await handler({ method: 'OPTIONS' }, res);
  expect(verifyAuth).not.toHaveBeenCalled();
  expect(res.json).not.toHaveBeenCalled();
});
