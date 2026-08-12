const getBaseUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  
  // Force relative paths if we are in the AI Studio preview environment (run.app)
  // to avoid CORS issues with production domain VITE_API_URL settings.
  if (typeof window !== 'undefined' && window.location.origin.includes('run.app')) {
    return '';
  }

  if (envUrl && envUrl !== 'undefined' && envUrl !== 'null' && envUrl.length > 4) {
    return envUrl.replace(/\/$/, '');
  }
  
  // Use relative paths by default in development/preview to avoid CORS and SSL origin issues.
  // Relative paths (empty string baseUrl) are usually most reliable for same-origin proxying.
  return '';
};

export const API_CONFIG = {
  baseUrl: getBaseUrl(),
};

console.log('[API_CONFIG] Initialized with baseUrl:', API_CONFIG.baseUrl || '(relative)');
if (typeof window !== 'undefined') {
  console.log('[API_CONFIG] window.location.origin:', window.location.origin);
  console.log('[API_CONFIG] env VITE_API_URL:', import.meta.env.VITE_API_URL);
  console.log('[API_CONFIG] is run.app?', window.location.origin.includes('run.app'));
}
