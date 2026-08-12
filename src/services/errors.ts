export class QuotaExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExhaustedError';
  }
}

export function isQuotaError(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return t.includes('quota') || 
         text.includes('RESOURCE_EXHAUSTED') || 
         text.includes('QUOTA_EXHAUSTED') ||
         text.includes('8 RESOURCE_EXHAUSTED');
}
