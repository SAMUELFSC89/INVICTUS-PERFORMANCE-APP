import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';

/**
 * Endpoint financeiro legado.
 *
 * Invictus Coins são pontos internos para resgate de itens elegíveis na Loja.
 * Eles não são dinheiro e não podem ser sacados por PIX. A rota permanece
 * apenas para responder de forma explícita a clientes antigos.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ success: false, error: 'Sessão inválida ou expirada.' });

  return res.status(410).json({
    success: false,
    code: 'LEGACY_FINANCIAL_WALLET_DISABLED',
    error: 'A carteira financeira e os saques via PIX não fazem parte do produto atual. Invictus Coins são pontos internos e podem ser usados somente nas opções elegíveis da Loja.'
  });
}
