import { VercelResponse } from '@vercel/node';

export class AppError extends Error {
  constructor(public message: string, public statusCode: number = 400, public details?: any) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(error: any, res: VercelResponse) {
  const statusCode = error.statusCode || error.status || 500;
  const message = error.message || 'Erro interno no servidor.';

  console.error(`[ERROR_HANDLER] [${statusCode}] ${message}`, error.stack || error);

  // BUG CONFIRMADO ao vivo (finalizacao de cardio, achado via Chrome): este
  // handler so devolvia o motivo especifico do erro em `message`. O restante
  // da API (a maioria dos handlers fora do errorHandler) usa `error` como
  // chave, e o cliente (src/services/activityService.ts) so lia
  // `userMessage`/`error` -- nenhum dos dois existia aqui, entao TODO erro
  // (antifraude, geofence, GPS instavel etc.) caia sempre na mensagem
  // generica do cliente, escondendo do atleta o motivo real e acionavel.
  // Devolvemos `error` e `userMessage` como aliases de `message` (aditivo,
  // nao remove nada) para cobrir qualquer chamador existente.
  return res.status(statusCode).json({
    success: false,
    message,
    error: message,
    userMessage: message,
    ...(error.details && { reasonCode: error.details.reasonCode, canRetry: error.details.canRetry }),
    ...(process.env.NODE_ENV === 'development' && { details: error.details, stack: error.stack })
  });
}
