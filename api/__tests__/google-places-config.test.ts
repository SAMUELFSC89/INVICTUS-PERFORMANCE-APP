import { classifyGooglePlacesError, getGooglePlacesApiKey } from '../_lib/google-places-config';

describe('configuração Google Places', () => {
  const original = {
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
    GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('prioriza a chave unificada do Google Maps usada em produção', () => {
    process.env.GOOGLE_MAPS_API_KEY = 'maps-key';
    process.env.GOOGLE_PLACES_API_KEY = 'places-key';
    expect(getGooglePlacesApiKey()).toBe('maps-key');
  });

  test.each([
    ['Billing must be enabled', 'BILLING_REQUIRED', true],
    ['Places API has not been used in project or it is disabled', 'API_DISABLED', false],
    ['The provided API key is invalid', 'INVALID_KEY', false],
    ['PERMISSION_DENIED', 'PERMISSION_DENIED', false]
  ])('classifica falha sem expor resposta bruta: %s', (message, code, billing) => {
    expect(classifyGooglePlacesError('', message)).toMatchObject({ code, isBillingError: billing });
  });
});
