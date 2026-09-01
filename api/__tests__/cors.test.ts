import { isCorsOriginAllowed } from '../_lib/common';

describe('allowlist CORS da API', () => {
  it('permite a origem Vercel usada pelo deploy público', () => {
    expect(isCorsOriginAllowed('https://sem-desculpa.vercel.app')).toBe(true);
  });

  it('mantém bloqueadas origens arbitrárias', () => {
    expect(isCorsOriginAllowed('https://example.com')).toBe(false);
  });
});
