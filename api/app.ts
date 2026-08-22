import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import helmet from 'helmet';
import { globalLimiter, activityLimiter } from './_lib/rate-limit.js';
import { RequestLogger } from './_lib/logger.js';
import { initSentry, captureException } from './_lib/sentry.js';
import { VercelRequest, VercelResponse } from '@vercel/node';
import path from 'path';

// Initialize Sentry APM
initSentry();

// Import all handlers from _handlers
// Note: We use relative imports. In Vercel, these will be bundled.
import healthHandler from './_handlers/health.js';
import profileHandler from './_handlers/profile.js';
import rankingHandler from './_handlers/ranking.js';
import shareHandler from './_handlers/share.js';
import shareImageHandler from './_handlers/share-image.js';
import gymsHandler from './_handlers/gyms.js';
import gymsJoinHandler from './_handlers/gyms_join.js';
import gymsCheckinHandler from './_handlers/gyms_checkin.js';
import gymsPhotoHandler from './_handlers/gyms_photo.js';
import runningHandler, { handleRunActivity } from './_handlers/running.js';
import habitsHandler from './_handlers/habits.js';
import validateActivityHandler from './_handlers/validate-activity.js';
import validatePresenceHandler from './_handlers/validate-presence.js';
import whatsappHandler from './_handlers/whatsapp.js';
import notificationsHandler from './_handlers/notifications.js';
import auditFraudHandler from './_handlers/audit-fraud.js';
import stravaHandler from './_handlers/strava.js';
import migrateResetHandler from './_handlers/migrate-reset.js';
import envCheckHandler from './_handlers/env-check.js';
import walletRedeemHandler from './_handlers/wallet-redeem.js';
import adminHandler from './_handlers/admin.js';
import denounceHandler from './_handlers/denounce.js';
import paymentsVerifyPurchaseHandler from './_handlers/payments-verify-purchase.js';
import revenuecatWebhookHandler from './_handlers/revenuecat-webhook.js';
import asaasWebhookHandler from './_handlers/asaas-webhook.js';
import asaasAuthorizeWithdrawalHandler from './_handlers/asaas-withdrawal-authorization.js';
import seasonPayoutCronHandler from './_handlers/season-payout-cron.js';
import seasonPrizeHandler from './_handlers/season-prize.js';
import seasonInscriptionHandler from './_handlers/season-inscription.js';
import paymentsStatusHandler from './_handlers/payments-status.js';
import paymentsConfigHandler from './_handlers/payments-config.js';
import privateChallengesHandler from './_handlers/private-challenges.js';
import performanceDashboardHandler from './_handlers/performance-dashboard.js';
import performanceAiHandler from './_handlers/performance-ai.js';
import financialHandler from './_handlers/financial.js';
import missionsHandler from './_handlers/missions.js';
import sponsorsHandler from './_handlers/sponsors.js';
import storeHandler from './_handlers/store.js';


const router = express.Router();
console.log('[API Router] Initializing routes...');

// Security: Helmet
router.use(helmet({ contentSecurityPolicy: false }));

// Rate limiting: Global
router.use(globalLimiter);

// Middleware de logging automático
router.use((req: express.Request & { user?: { id?: string; uid?: string } }, res: express.Response, next: express.NextFunction) => {
  const start = Date.now();
  const userId = req.user?.id || req.user?.uid;
  RequestLogger.logIncoming(req.method, req.path, userId);
  
  res.on('finish', () => {
    RequestLogger.logOutgoing(req.method, req.path, res.statusCode, Date.now() - start, userId);
  });
  
  next();
});

// Global API CORS and headers
router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Helper to wrap Vercel handlers for Express with error handling
const wrap = (handler: any) => async (req: any, res: any) => {
  try {
    await handler(req, res);
  } catch (err: any) {
    console.error(`[API Error] Error in handler:`, err);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: err.message || 'Erro interno no servidor.',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
      });
    }
  }
};

// 1. Routes (paths are relative to /api mount point)
console.log('[ROUTE-INIT] Validating handlers before registration...');

const assertHandler = (name: string, handler: any) => {
  console.log(`[ROUTE-INIT] Handler ${name}: ${typeof handler}`);
  if (typeof handler !== 'function') {
    throw new Error(`Handler ${name} is not a function! Actual type: ${typeof handler}`);
  }
};

assertHandler('healthHandler', healthHandler);
assertHandler('seasonPrizeHandler', seasonPrizeHandler);
assertHandler('seasonInscriptionHandler', seasonInscriptionHandler);
assertHandler('profileHandler', profileHandler);
assertHandler('rankingHandler', rankingHandler);
assertHandler('shareHandler', shareHandler);
assertHandler('shareImageHandler', shareImageHandler);
assertHandler('gymsHandler', gymsHandler);
assertHandler('gymsJoinHandler', gymsJoinHandler);
assertHandler('gymsCheckinHandler', gymsCheckinHandler);
assertHandler('gymsPhotoHandler', gymsPhotoHandler);
assertHandler('runningHandler', runningHandler);
assertHandler('validateActivityHandler', validateActivityHandler);
assertHandler('validatePresenceHandler', validatePresenceHandler);
assertHandler('stravaHandler', stravaHandler);
assertHandler('whatsappHandler', whatsappHandler);
assertHandler('auditFraudHandler', auditFraudHandler);
assertHandler('envCheckHandler', envCheckHandler);
assertHandler('paymentsVerifyPurchaseHandler', paymentsVerifyPurchaseHandler);
assertHandler('revenuecatWebhookHandler', revenuecatWebhookHandler);
assertHandler('paymentsConfigHandler', paymentsConfigHandler);
assertHandler('paymentsStatusHandler', paymentsStatusHandler);
assertHandler('walletRedeemHandler', walletRedeemHandler);
assertHandler('migrateResetHandler', migrateResetHandler);
assertHandler('adminHandler', adminHandler);
assertHandler('denounceHandler', denounceHandler);
assertHandler('privateChallengesHandler', privateChallengesHandler);
assertHandler('performanceDashboardHandler', performanceDashboardHandler);
assertHandler('performanceAiHandler', performanceAiHandler);

console.log('[ROUTE-INIT] All handlers validated successfully. Registering routes...');

console.log('[ROUTE] /health', typeof healthHandler);
router.all('/health', wrap(healthHandler));

console.log('[ROUTE] /profile', typeof profileHandler);
router.all('/profile', wrap(profileHandler));

console.log('[ROUTE] /ranking', typeof rankingHandler);
router.all('/ranking', wrap(rankingHandler));

console.log('[ROUTE] /share', typeof shareHandler);
router.all('/share', wrap(shareHandler));

console.log('[ROUTE] /share-image', typeof shareImageHandler);
router.all('/share-image', wrap(shareImageHandler));

console.log('[ROUTE] /gyms', typeof gymsHandler);
router.all('/gyms', wrap(gymsHandler));

console.log('[ROUTE] /gyms/join', typeof gymsJoinHandler);
router.all('/gyms/join', wrap(gymsJoinHandler));

console.log('[ROUTE] /gyms/checkin', typeof gymsCheckinHandler);
router.all('/gyms/checkin', wrap(gymsCheckinHandler));

console.log('[ROUTE] /gyms/photo', typeof gymsPhotoHandler);
router.all('/gyms/photo', wrap(gymsPhotoHandler));

console.log('[ROUTE] /running', typeof runningHandler);
router.all('/running', wrap(runningHandler));

console.log('[ROUTE] /activities/running', typeof handleRunActivity);
router.post('/activities/running', activityLimiter, wrap(handleRunActivity));

console.log('[ROUTE] /habits', typeof habitsHandler);
router.all('/habits', wrap(habitsHandler));

console.log('[ROUTE] /validate-activity', typeof validateActivityHandler);
router.all('/validate-activity', wrap(validateActivityHandler));

console.log('[ROUTE] /validate-presence', typeof validatePresenceHandler);
router.all('/validate-presence', wrap(validatePresenceHandler));


console.log('[ROUTE] /strava/auth', typeof stravaHandler);
console.log('[ROUTE] /strava/callback', typeof stravaHandler);
console.log('[ROUTE] /strava/webhook', typeof stravaHandler);
router.use('/strava', stravaHandler);

console.log('[ROUTE] /whatsapp/send', typeof whatsappHandler);
router.all('/whatsapp/send', wrap(whatsappHandler));

console.log('[ROUTE] /notifications', typeof notificationsHandler);
router.all('/notifications', wrap(notificationsHandler));

console.log('[ROUTE] /audit-fraud', typeof auditFraudHandler);
router.all('/audit-fraud', wrap(auditFraudHandler));

console.log('[ROUTE] /env-check', typeof envCheckHandler);
router.all('/env-check', wrap(envCheckHandler));

console.log('[ROUTE] /payments/verify-purchase', typeof paymentsVerifyPurchaseHandler);
router.all('/payments/verify-purchase', wrap(paymentsVerifyPurchaseHandler));

console.log('[ROUTE] /payments/revenuecat-webhook', typeof revenuecatWebhookHandler);
router.all('/payments/revenuecat-webhook', wrap(revenuecatWebhookHandler));

console.log('[ROUTE] /payments/asaas-webhook', typeof asaasWebhookHandler);
router.all('/payments/asaas-webhook', wrap(asaasWebhookHandler));
console.log('[ROUTE] /payments/asaas-authorize-withdrawal', typeof asaasAuthorizeWithdrawalHandler);
router.all('/payments/asaas-authorize-withdrawal', wrap(asaasAuthorizeWithdrawalHandler));
console.log('[ROUTE] /season-payout-cron', typeof seasonPayoutCronHandler);
router.all('/season-payout-cron', wrap(seasonPayoutCronHandler));
console.log('[ROUTE] /season-prize', typeof seasonPrizeHandler);
router.all('/season-prize', wrap(seasonPrizeHandler));
console.log('[ROUTE] /season-inscription', typeof seasonInscriptionHandler);
router.all('/season-inscription', wrap(seasonInscriptionHandler));

console.log('[ROUTE] /payments/config', typeof paymentsConfigHandler);
router.all('/payments/config', wrap(paymentsConfigHandler));

console.log('[ROUTE] /payments/status/:orderId', typeof paymentsStatusHandler);
router.all('/payments/status/:orderId', wrap(paymentsStatusHandler));

console.log('[ROUTE] /payments/status', typeof paymentsStatusHandler);
router.all('/payments/status', wrap(paymentsStatusHandler));

console.log('[ROUTE] /wallet/redeem', typeof walletRedeemHandler);
router.all('/wallet/redeem', wrap(walletRedeemHandler));

console.log('[ROUTE] /migrate-reset', typeof migrateResetHandler);
router.all('/migrate-reset', wrap(migrateResetHandler));

console.log('[ROUTE] /admin', typeof adminHandler);
router.all('/admin', wrap(adminHandler));

console.log('[ROUTE] /denounce', typeof denounceHandler);
router.all('/denounce', wrap(denounceHandler));

console.log('[ROUTE] /private-challenges', typeof privateChallengesHandler);
router.all('/private-challenges', wrap(privateChallengesHandler));

console.log('[ROUTE] /performance-dashboard', typeof performanceDashboardHandler);
router.all('/performance-dashboard', wrap(performanceDashboardHandler));

console.log('[ROUTE] /performance-ai', typeof performanceAiHandler);
router.all('/performance-ai', wrap(performanceAiHandler));

console.log('[ROUTE] /financial', typeof financialHandler);
router.all('/financial', wrap(financialHandler));

console.log('[ROUTE] /missions', typeof missionsHandler);
router.all('/missions', wrap(missionsHandler));

console.log('[ROUTE] /sponsors', typeof sponsorsHandler);
router.all('/sponsors', wrap(sponsorsHandler));

console.log('[ROUTE] /store', typeof storeHandler);
router.all('/store', wrap(storeHandler));

// Support for the /share/:id custom route
console.log('[ROUTE] /share/:id', typeof shareHandler);
router.get('/share/:id', (req, res) => {
  req.query.id = req.params.id;
  return shareHandler(req as any, res as any);
});

// 2. The Unified Endpoint
router.all('/app', wrap(async (req: any, res: any) => {
  const action = (req.query.action || req.body.action) as string;
  
  switch (action) {
    case 'health': return await healthHandler(req as any, res as any);
    case 'profile': return await profileHandler(req as any, res as any);
    case 'ranking': return await rankingHandler(req as any, res as any);
    case 'gyms': return await gymsHandler(req as any, res as any);
    case 'gyms-join': return await gymsJoinHandler(req as any, res as any);
    case 'gyms-checkin': return await gymsCheckinHandler(req as any, res as any);
    case 'validate-activity': return await validateActivityHandler(req as any, res as any);
    case 'validate-presence': return await validatePresenceHandler(req as any, res as any);
    case 'strava': return await stravaHandler(req as any, res as any, () => {});
    case 'whatsapp-send': return await whatsappHandler(req as any, res as any);
    case 'wallet-redeem': return await walletRedeemHandler(req as any, res as any);
    case 'financial': return await financialHandler(req as any, res as any);
    case 'missions': return await missionsHandler(req as any, res as any);
    case 'sponsors': return await sponsorsHandler(req as any, res as any);
    case 'store': return await storeHandler(req as any, res as any);
    case 'payments-verify-purchase': return await paymentsVerifyPurchaseHandler(req as any, res as any);
    case 'payments-config': return await paymentsConfigHandler(req as any, res as any);
    case 'payments-status': return await paymentsStatusHandler(req as any, res as any);
    case 'migrate-reset': return await migrateResetHandler(req as any, res as any);
    case 'admin': return await adminHandler(req as any, res as any);
    case 'private-challenges': return await privateChallengesHandler(req as any, res as any);
    case 'performance-dashboard': return await performanceDashboardHandler(req as any, res as any);
    case 'performance-ai': return await performanceAiHandler(req as any, res as any);
    default: 
      return res.status(400).json({ 
        error: 'Ação inválida ou não fornecida.',
        tip: 'Use /api/app?action=profile ou os endpoints específicos.' 
      });
  }
}));

export default function handler(req: any, res: any, next?: any) {
  // Normalize req.url by removing '/api' or '/api/app' prefix for Vercel deployment compatibility
  const originalUrl = req.url;
  if (req.url && req.url.startsWith('/api')) {
    req.url = req.url.substring(4);
    if (!req.url.startsWith('/')) {
      req.url = '/' + req.url;
    }
  }
  if (req.url && req.url.startsWith('/app/')) {
    req.url = req.url.substring(4);
  }

  return router(req, res, next || ((err?: any) => {
    if (err) {
      console.error('[API App Router Error]:', err);
      captureException(err, { url: req.url, originalUrl });
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Erro interno no router.' });
      }
    } else if (!res.headersSent) {
      res.status(404).json({ error: `Endpoint não encontrado: ${req.url} (Original: ${originalUrl})` });
    }
  }));
}
