import * as Sentry from '@sentry/node';
import { logger } from './logger.js';

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';

  if (!dsn) {
    logger.info({}, 'Sentry DSN not provided; running without external Sentry logging');
  }

  try {
    Sentry.init({
      dsn: dsn || undefined,
      environment,
      tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
      profilesSampleRate: environment === 'production' ? 0.1 : 1.0,
      beforeSend(event) {
        // Filter out sensitive data if needed
        return event;
      }
    });
    logger.info({ environment, hasDsn: !!dsn }, 'Sentry APM initialized successfully');
  } catch (error: any) {
    // Observability must never prevent the API from booting. This also keeps
    // local/test environments without procfs metrics compatible with Sentry.
    logger.warn({ environment, error: error?.message || String(error) }, 'Sentry could not be initialized; continuing without APM');
  }
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (context) {
    Sentry.withScope((scope) => {
      scope.setExtras(context);
      if (context.userId && typeof context.userId === 'string') {
        scope.setUser({ id: context.userId });
      }
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = 'info', context?: Record<string, unknown>): void {
  if (context) {
    Sentry.withScope((scope) => {
      scope.setExtras(context);
      Sentry.captureMessage(message, level);
    });
  } else {
    Sentry.captureMessage(message, level);
  }
}

export { Sentry };
