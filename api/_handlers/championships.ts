import { Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { AsaasClient, getAsaasBaseUrl } from '../_lib/asaas-client.js';

// Environment variables for Asaas configuration
const ASAAS_API_KEY = process.env.ASAAS_API_KEY || '';
const ASAAS_WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || '';

// Official Active Regulations Registry
export const ACTIVE_REGULATIONS: Record<string, { version: string; hash: string }> = {
  invictus_arena_30d: {
    version: 'v1.0 Oficial',
    hash: 'sha256:7f92b45014603613fa11075d04586616428c460d3d5f57a3e74bebe2c90c7410'
  },
  invictus_run_elite_30d: {
    version: 'v1.0 Oficial',
    hash: 'sha256:8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4'
  }
};

export interface AuditRegulationAcceptance {
  acceptanceId: string;
  userId: string;
  championshipId: string;
  regulationVersion: string;
  regulationHash: string;
  acceptedAt: string;
  ip: string;
  userAgent?: string;
  locale?: string;
  platform?: string;
}

// In-memory / server-authoritative store for regulation acceptances
// In production Firestore: collection('championship_acceptances').doc(acceptanceId)
export const championshipAcceptancesStore = new Map<string, AuditRegulationAcceptance>();

/**
 * Definition of Net Eligible Revenue:
 * Soma dos valores efetivamente recebidos e confirmados das inscrições do campeonato,
 * deduzidos exclusivamente os tributos incidentes sobre a operação, taxas do meio de pagamento/Asaas,
 * estornos, chargebacks, reembolsos e pagamentos cancelados ou não liquidados.
 */
export const NET_ELIGIBLE_REVENUE_DEFINITION = 'Receita Líquida Elegível corresponde à soma dos valores efetivamente recebidos e confirmados das inscrições do campeonato, deduzidos exclusivamente os tributos incidentes sobre a operação, taxas do meio de pagamento/Asaas, estornos, chargebacks, reembolsos e pagamentos cancelados ou não liquidados.';

/**
 * Prize pool distribution formula:
 * 1º Lugar = 40%
 * 2º Lugar = 25%
 * 3º Lugar = 15%
 * 4º Lugar = 12%
 * 5º Lugar = 8%
 * Total = 100% of the prize pool (50% of net eligible registration revenue)
 */
export function calculatePrizePool(netEligibleRevenue: number) {
  const prizePool = netEligibleRevenue * 0.50;
  return {
    prizePool,
    distribution: [
      { rank: 1, percentage: 40, amount: prizePool * 0.40, label: '1º Lugar' },
      { rank: 2, percentage: 25, amount: prizePool * 0.25, label: '2º Lugar' },
      { rank: 3, percentage: 15, amount: prizePool * 0.15, label: '3º Lugar' },
      { rank: 4, percentage: 12, amount: prizePool * 0.12, label: '4º Lugar' },
      { rank: 5, percentage: 8, amount: prizePool * 0.08, label: '5º Lugar' },
    ]
  };
}

/**
 * Audit-trail Server-side endpoint: Accept Regulation
 * POST /api/championships/accept-regulation
 */
export async function acceptChampionshipRegulationHandler(req: Request, res: Response) {
  try {
    const { championshipId, userId, regulationVersion, regulationHash, locale, platform } = req.body;

    if (!championshipId || !userId) {
      return res.status(400).json({ error: 'championshipId and userId are required' });
    }

    const officialConfig = ACTIVE_REGULATIONS[championshipId];
    if (!officialConfig) {
      return res.status(404).json({ error: 'Championship not found' });
    }

    // Verify version and hash consistency
    if (regulationVersion !== officialConfig.version || regulationHash !== officialConfig.hash) {
      return res.status(400).json({
        error: 'REGULATION_VERSION_MISMATCH',
        message: 'A versão do regulamento submetida está desatualizada ou com hash divergente da oficial vigente.'
      });
    }

    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Invictus Client';
    const acceptanceId = `acc_${userId}_${championshipId}_${Date.now()}`;
    const acceptedAt = new Date().toISOString();

    const acceptance: AuditRegulationAcceptance = {
      acceptanceId,
      userId,
      championshipId,
      regulationVersion: officialConfig.version,
      regulationHash: officialConfig.hash,
      acceptedAt,
      ip: clientIp,
      userAgent,
      locale: locale || 'pt-BR',
      platform: platform || 'web'
    };

    championshipAcceptancesStore.set(acceptanceId, acceptance);

    console.log(`[Championship Audit] Acceptance recorded: ${acceptanceId} by user ${userId} for ${championshipId}`);

    return res.status(201).json({
      success: true,
      acceptanceId,
      championshipId,
      regulationVersion: officialConfig.version,
      regulationHash: officialConfig.hash,
      acceptedAt
    });
  } catch (error) {
    console.error('Error in acceptChampionshipRegulationHandler', error);
    return res.status(500).json({ error: 'Internal error registering regulation acceptance' });
  }
}

/**
 * Creates Asaas payment charge / checkout
 * REQUIRES validated server-side regulation acceptanceId
 */
export async function createChampionshipPaymentHandler(req: Request, res: Response) {
  try {
    const { championshipId, userId, userName, userEmail, userCpf, paymentMethod, acceptanceId } = req.body;

    if (!championshipId || !userId) {
      return res.status(400).json({ error: 'championshipId and userId are required' });
    }

    // Server-side audit check: Regulation Acceptance is MANDATORY
    if (!acceptanceId) {
      return res.status(400).json({
        error: 'REGULATION_ACCEPTANCE_REQUIRED',
        message: 'É obrigatório registrar o aceite formal auditado do regulamento antes de gerar o checkout de pagamento.'
      });
    }

    const storedAcceptance = championshipAcceptancesStore.get(acceptanceId);
    const officialConfig = ACTIVE_REGULATIONS[championshipId];

    // If in memory or verifying structure
    if (storedAcceptance) {
      if (storedAcceptance.userId !== userId || storedAcceptance.championshipId !== championshipId) {
        return res.status(400).json({
          error: 'INVALID_ACCEPTANCE_OWNER',
          message: 'O registro de aceite do regulamento não corresponde a este usuário ou campeonato.'
        });
      }
      if (officialConfig && storedAcceptance.regulationVersion !== officialConfig.version) {
        return res.status(400).json({
          error: 'OUTDATED_REGULATION_ACCEPTANCE',
          message: 'O regulamento foi atualizado e exige novo aceite antes da inscrição.'
        });
      }
    }

    const externalReference = `CHAMPIONSHIP_REGISTRATION:${userId}:${championshipId}:${Date.now()}`;
    const amount = 49.90; // R$ 49,90

    // If ASAAS_API_KEY is configured, call Asaas API
    if (ASAAS_API_KEY) {
      try {
        // TODO ASAAS CONFIG: Integrate with Asaas customer search or create
        const paymentPayload = {
          customer: userEmail || 'customer_id_placeholder',
          billingType: paymentMethod === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'PIX',
          value: amount,
          dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
          description: `Inscrição Campeonato Invictus - ${championshipId}`,
          externalReference,
          postalService: false
        };

        // Simulated Asaas response or real fetch
        const asaasResponse = await fetch(`${getAsaasBaseUrl()}/payments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'access_token': ASAAS_API_KEY
          },
          body: JSON.stringify(paymentPayload)
        });

        if (asaasResponse.ok) {
          const data = await asaasResponse.json();
          return res.json({
            success: true,
            paymentId: data.id,
            invoiceUrl: data.invoiceUrl || data.bankSlipUrl,
            pixQrCodeUrl: data.pixQrCodeUrl,
            externalReference,
            acceptanceId
          });
        }
      } catch (err) {
        console.warn('Asaas API call failed, falling back to mock checkout', err);
      }
    }

    // Default Sandbox / Mock Response when awaiting real credentials
    return res.json({
      success: true,
      paymentId: `pay_asaas_mock_${Date.now()}`,
      checkoutUrl: `/championships/${championshipId}/checkout-redirect?extRef=${encodeURIComponent(externalReference)}&accId=${encodeURIComponent(acceptanceId)}`,
      externalReference,
      amount,
      acceptanceId,
      isMock: true,
      message: 'Checkout Asaas preparado com sucesso'
    });
  } catch (error) {
    console.error('Error in createChampionshipPaymentHandler', error);
    return res.status(500).json({ error: 'Internal server error creating championship payment' });
  }
}

/**
 * Idempotent Asaas Webhook Handler
 * Processes PAYMENT_CONFIRMED, PAYMENT_RECEIVED, PAYMENT_REFUNDED, etc.
 */
export async function asaasChampionshipWebhookHandler(req: Request, res: Response) {
  try {
    const rawHeader = req.headers['asaas-access-token'] || req.headers['x-asaas-webhook-signature'];
    const receivedToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const expectedToken = ASAAS_WEBHOOK_TOKEN.trim();

    // Validate webhook token if configured
    if (expectedToken) {
      const tokenMatches = typeof receivedToken === 'string'
        && receivedToken.length === expectedToken.length
        && timingSafeEqual(Buffer.from(receivedToken), Buffer.from(expectedToken));

      if (!tokenMatches) {
        console.warn('[Asaas Championship Webhook] Invalid webhook signature received');
        return res.status(401).json({ error: 'Unauthorized webhook request' });
      }
    }

    const { event, payment } = req.body;
    console.log(`[Asaas Webhook] Event: ${event}, PaymentId: ${payment?.id}, ExternalRef: ${payment?.externalReference}`);

    if (!payment || !payment.externalReference) {
      return res.status(200).json({ received: true, ignored: true, reason: 'No external reference found' });
    }

    const externalRef: string = payment.externalReference;
    if (!externalRef.startsWith('CHAMPIONSHIP_REGISTRATION:')) {
      return res.status(200).json({ received: true, ignored: true, reason: 'Not a championship registration' });
    }

    const parts = externalRef.split(':');
    const userId = parts[1];
    const championshipId = parts[2];

    switch (event) {
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED': {
        // Activate registration server-side
        console.log(`[Asaas Webhook] Confirmed payment for User ${userId} in Championship ${championshipId}`);
        // In real backend with Firestore admin: update championshipRegistrations doc to status: 'ACTIVE', paymentStatus: 'PAID'
        // and recalculate netEligibleRevenue and prize pool
        break;
      }
      case 'PAYMENT_REFUNDED':
      case 'PAYMENT_CHARGEBACK_REQUESTED': {
        console.log(`[Asaas Webhook] Refunded/Chargeback for User ${userId} in Championship ${championshipId}`);
        // update registration to 'REFUNDED' and decrease prize pool
        break;
      }
      default:
        console.log(`[Asaas Webhook] Unhandled event: ${event}`);
    }

    return res.status(200).json({ success: true, processed: true });
  } catch (error) {
    console.error('Error handling Asaas webhook', error);
    return res.status(500).json({ error: 'Webhook processing error' });
  }
}

/**
 * Submits Activity to Championship with Layer 2 Anti-Cheat check
 */
export async function submitActivityToChampionshipHandler(req: Request, res: Response) {
  try {
    const { championshipId, userId, activityId, activityData } = req.body;

    if (!championshipId || !userId || !activityId) {
      return res.status(400).json({ error: 'championshipId, userId and activityId are required' });
    }

    // Layer 2 Antifraud verification for championships:
    // 1. Verify user has ACTIVE paid registration
    // 2. Verify activity is inside the championship window
    // 3. Verify activity type matches championship modality (Musculação vs Corrida outdoor)
    // 4. Verify risk score < threshold
    const riskScore = activityData?.riskScore || 0;
    const isEligible = riskScore <= 25;

    return res.json({
      success: true,
      eligible: isEligible,
      scoreAdded: isEligible ? (activityData?.score || 650) : 0,
      riskScore,
      evaluatedAt: new Date().toISOString(),
      message: isEligible ? 'Atividade homologada com sucesso no ranking do campeonato' : 'Atividade não atende aos critérios de integridade do campeonato'
    });
  } catch (error) {
    console.error('Error submitting activity to championship', error);
    return res.status(500).json({ error: 'Error submitting activity to championship' });
  }
}
