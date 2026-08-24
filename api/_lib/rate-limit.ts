import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

interface RequestWithUser extends Request {
  user?: {
    id?: string;
    uid?: string;
  };
}

// Vercel's request adapter can omit req.ip. Use the proxy header when it is
// available and a stable anonymous bucket only as the final fallback.
const requestKey = (req: Request) => {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim();
  return forwardedIp || req.socket?.remoteAddress || 'anonymous';
};

// Rate limiter global (100 requests por minuto)
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { message: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: requestKey,
  validate: { default: false }
});

// Rate limiter para atividades (10 por minuto por usuário/IP)
export const activityLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { message: 'Too many activities submitted, please try again later.' },
  keyGenerator: (req: Request) => {
    const customReq = req as RequestWithUser;
    return customReq.user?.id || customReq.user?.uid || requestKey(req);
  },
  validate: { trustProxy: false, xForwardedForHeader: false, default: false }
});

// Rate limiter para autenticação (5 tentativas por 15 minutos)
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: 'Too many login attempts, please try again later.' },
  skipSuccessfulRequests: true,
  keyGenerator: requestKey,
  validate: { default: false }
});

// Rate limiter para APIs externas (20 por minuto)
export const externalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { message: 'Rate limit exceeded for external API' },
  keyGenerator: requestKey,
  validate: { default: false }
});

export default {
  globalLimiter,
  activityLimiter,
  loginLimiter,
  externalApiLimiter
};
