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

  return res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { details: error.details, stack: error.stack })
  });
}
