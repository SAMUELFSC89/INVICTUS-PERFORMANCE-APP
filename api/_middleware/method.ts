import { VercelRequest, VercelResponse } from '@vercel/node';

export function methodMiddleware(req: VercelRequest, res: VercelResponse, allowedMethods: string[]): boolean {
  if (!allowedMethods.includes(req.method || '')) {
    res.status(405).json({
      success: false,
      message: `Método ${req.method} não permitido. Métodos suportados: ${allowedMethods.join(', ')}`
    });
    return false;
  }
  return true;
}
