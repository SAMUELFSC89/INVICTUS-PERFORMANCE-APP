import type { VercelRequest, VercelResponse } from '@vercel/node';
import { corsMiddleware } from './_middleware/cors.js';
import { createChampionshipPaymentHandler } from './_handlers/championships.js';
import { AsaasClient, AsaasRequestError } from './_lib/asaas-client.js';

/**
 * Dedicated championship payment entrypoint.
 *
 * The Asaas hosted checkout accepts customerData only as an optional prefill.
 * A profile containing syntactically present but provider-invalid CPF/CNPJ can
 * make Asaas reject the entire checkout with HTTP 400 / invalid_object before
 * the payer ever reaches the hosted page. For championships we prefer the
 * provider-hosted collection flow: omit customerData and let Asaas collect and
 * validate payer data on its own checkout screen.
 *
 * Asaas currently limits the hosted checkout item `name` field to 30 characters.
 * Normalize that field here as part of the championship-specific guard so a long
 * championship title cannot make the provider reject the whole checkout.
 *
 * The underlying registration/idempotency/webhook logic remains unchanged in
 * createChampionshipPaymentHandler -> criarInscricaoChampionship.
 */
const createHostedCheckout = AsaasClient.criarCheckoutHospedado.bind(AsaasClient);

(AsaasClient as any).criarCheckoutHospedado = async (params: any) => {
  try {
    return await createHostedCheckout({
      ...params,
      nomeItem: String(params?.nomeItem || '').trim().slice(0, 30),
      nomeCliente: undefined,
      cpf: undefined,
      email: undefined,
    });
  } catch (error: any) {
    if (error instanceof AsaasRequestError) {
      console.warn('[Championship checkout guarded] Asaas recusou payload sem prefill', {
        providerStatus: error.status,
        providerCode: error.code || 'ASAAS_4XX',
        providerMessage: String(error.message || '').slice(0, 240),
      });
    }
    throw error;
  }
};

export default async function handler(
  req: VercelRequest & { userId?: string; userEmail?: string },
  res: VercelResponse,
) {
  if (corsMiddleware(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }
  return createChampionshipPaymentHandler(req, res);
}
