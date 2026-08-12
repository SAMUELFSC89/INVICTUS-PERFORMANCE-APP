import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

interface RequestWithUser extends Request {
  user?: {
    id?: string;
    uid?: string;
  };
}

// Rate limiter global (100 requests por minuto)
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { message: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false }
});

// Rate limiter para atividades (10 por minuto por usuário/IP)
export const activityLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { message: 'Too many activities submitted, please try again later.' },
  keyGenerator: (req: Request) => {
    const customReq = req as RequestWithUser;
    return customReq.user?.id || customReq.user?.uid || req.ip || 'unknown';
  },
  validate: { trustProxy: false, xForwardedForHeader: false, default: false }
});

// Rate limiter para autenticação (5 tentativas por 15 minutos)
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: 'Too many login attempts, please try again later.' },
  skipSuccessfulRequests: true,
  validate: { trustProxy: false, xForwardedForHeader: false }
});

// Rate limiter para APIs externas (20 por minuto)
export const externalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { message: 'Rate limit exceeded for external API' },
  validate: { trustProxy: false, xForwardedForHeader: false }
});

export default {
  globalLimiter,
  activityLimiter,
  loginLimiter,
  externalApiLimiter
};
