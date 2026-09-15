import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db, verifyAuth } from '../_lib/common.js';
import { hasActiveAdminAuthority } from '../_lib/admin-authority.js';
import { getAsaasBaseUrl } from '../_lib/asaas-client.js';

function hasConfiguredSecret(name: string): boolean {
  return typeof process.env[name] === 'string' && process.env[name]!.trim().length > 0;
}

function getSafeAsaasReadiness() {
  const apiKeyConfigured = hasConfiguredSecret('ASAAS_API_KEY');
  const webhookTokenConfigured = hasConfiguredSecret('ASAAS_WEBHOOK_TOKEN');
  const authorizationTokenConfigured = hasConfiguredSecret('ASAAS_AUTHORIZATION_TOKEN');

  let host = 'invalid';
  try {
    host = new URL(getAsaasBaseUrl()).hostname.toLowerCase();
  } catch {
    // Nunca devolva a URL completa: ela pode ser customizada e não é necessária
    // para o diagnóstico. O hostname basta para identificar o ambiente efetivo.
  }

  const environment = host === 'api.asaas.com'
    ? 'production'
    : host.includes('sandbox.asaas.com')
      ? 'sandbox'
      : 'custom';
  const production = environment === 'production';

  return {
    environment,
    host,
    apiKeyConfigured,
    webhookTokenConfigured,
    authorizationTokenConfigured,
    productionWithdrawalAuthorizationReady: !production || authorizationTokenConfigured,
    paidChampionshipFinancialIntegrationReady:
      apiKeyConfigured && webhookTokenConfigured && (!production || authorizationTokenConfigured),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  // Diagnóstico operacional não deve existir publicamente em produção. Para
  // habilitá-lo, além de ENABLE_ENV_CHECK=true, é necessário ser admin ativo.
  if (process.env.ENABLE_ENV_CHECK !== 'true') {
    return res.status(404).json({ error: 'Não encontrado.' });
  }

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Autenticação necessária.' });
  }

  const userSnap = await db.collection('users').doc(auth.uid).get();
  if (!userSnap.exists || !hasActiveAdminAuthority(userSnap.data())) {
    return res.status(403).json({ error: 'Acesso administrativo necessário.' });
  }

  let firestoreAvailable = false;
  try {
    await db.collection('_connection_test_').doc('ping').get();
    firestoreAvailable = true;
  } catch {
    // Não exponha detalhes de credencial, topologia ou mensagens do SDK.
  }

  const asaas = getSafeAsaasReadiness();
  return res.json({
    ok: firestoreAvailable && asaas.paidChampionshipFinancialIntegrationReady,
    firestoreAvailable,
    integrations: { asaas },
    timestamp: new Date().toISOString()
  });
}
