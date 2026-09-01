const read = (value: string | undefined) => value?.trim() || '';

export type PlacesFailureCode = 'BILLING_REQUIRED' | 'API_DISABLED' | 'INVALID_KEY' | 'PERMISSION_DENIED' | 'UPSTREAM_ERROR';

/** GOOGLE_MAPS_API_KEY é a chave unificada usada pelo mapa e Places. */
export function getGooglePlacesApiKey(): string {
  return read(process.env.GOOGLE_MAPS_API_KEY)
    || read(process.env.GOOGLE_PLACES_API_KEY)
    || read(process.env.GOOGLE_API_KEY);
}

export function classifyGooglePlacesError(status: unknown, message: unknown): { code: PlacesFailureCode; isBillingError: boolean; tip: string } {
  const text = `${String(status || '')} ${String(message || '')}`.toLowerCase();
  if (/billing|billing account|enable billing/.test(text)) {
    return { code: 'BILLING_REQUIRED', isBillingError: true, tip: 'Ative e conclua o faturamento do Google Cloud no projeto associado à chave.' };
  }
  if (/has not been used|not enabled|api[_ ]?disabled|enable.+places/.test(text)) {
    return { code: 'API_DISABLED', isBillingError: false, tip: 'Ative a Places API (New) no mesmo projeto Google Cloud da chave.' };
  }
  if (/api key not valid|invalid.+key|key.+invalid|keyinvalid/.test(text)) {
    return { code: 'INVALID_KEY', isBillingError: false, tip: 'Revise a GOOGLE_MAPS_API_KEY de produção e suas restrições de API.' };
  }
  if (/permission_denied|request_denied|forbidden|403/.test(text)) {
    return { code: 'PERMISSION_DENIED', isBillingError: false, tip: 'Confira faturamento, Places API (New) e restrições da chave no Google Cloud.' };
  }
  return { code: 'UPSTREAM_ERROR', isBillingError: false, tip: 'Tente novamente em instantes.' };
}
