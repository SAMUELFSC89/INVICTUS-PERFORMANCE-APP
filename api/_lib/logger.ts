import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isProduction ? undefined : {
    target: 'pino-pretty',
    options: {
      colorize: true,
      singleLine: false,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
      messageFormat: '{levelLabel} [{component}] {msg}'
    }
  }
});

export const scoreLogger = logger.child({ component: 'score-engine' });
export const fraudLogger = logger.child({ component: 'fraud-detection' });
export const authLogger = logger.child({ component: 'auth' });
export const apiLogger = logger.child({ component: 'api' });
export const syncLogger = logger.child({ component: 'sync-service' });

export function sanitizeForLogging(data: any): any {
  const sensitiveKeys = ['password', 'token', 'apiKey', 'secret', 'cpf', 'creditCard', 'pixKey'];
  if (typeof data !== 'object' || data === null) return data;
  
  try {
    const sanitized = JSON.parse(JSON.stringify(data));
    function traverse(node: any) {
      if (typeof node !== 'object' || node === null) return;
      for (const key of Object.keys(node)) {
        if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
          node[key] = '[REDACTED]';
        } else if (typeof node[key] === 'object') {
          traverse(node[key]);
        }
      }
    }
    traverse(sanitized);
    return sanitized;
  } catch {
    return { _sanitizationError: 'Could not sanitize' };
  }
}

export class RequestLogger {
  static logIncoming(method: string, url: string, userId?: string) {
    apiLogger.info({ method, url, userId }, `Incoming ${method} ${url}`);
  }

  static logOutgoing(method: string, url: string, statusCode: number, responseTimeMs: number, userId?: string) {
    const level = statusCode >= 400 ? 'warn' : 'info';
    apiLogger[level]({ method, url, statusCode, responseTimeMs, userId }, `${method} ${url} → ${statusCode} (${responseTimeMs}ms)`);
  }

  static logError(method: string, url: string, error: Error, userId?: string) {
    apiLogger.error({
      method, url, userId,
      error: { message: error.message, stack: error.stack, name: error.name }
    }, `Error in ${method} ${url}`);
  }
}

export class ScoreOperationLogger {
  static logEventReceived(userId: string, eventId: string, source: string) {
    scoreLogger.info({ userId, eventId, source }, 'Score event received');
  }

  static logCalculationComplete(userId: string, eventId: string, earnedPoints: number, processingTimeMs: number) {
    scoreLogger.info({ userId, eventId, earnedPoints, processingTimeMs }, `Score calculated: ${earnedPoints} points in ${processingTimeMs}ms`);
  }
}

export class FraudLogger {
  static logSuspiciousActivity(userId: string, reason: string, confidence: number, details?: any) {
    fraudLogger.warn({ userId, fraudReason: reason, fraudConfidence: confidence, details }, `Suspicious activity: ${reason}`);
  }
}

export default logger;
