import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';
import { StoreEngine } from '../_lib/store-engine.js';
import { RewardCoinEngine } from '../_lib/reward-coin-engine.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ success: false, error: 'Sessão inválida ou expirada.' });
  }

  const action = (req.query.action || req.body.action) as string;

  try {
    if (req.method === 'GET') {
      const [items, inventory, coinWallet, coinTransactions] = await Promise.all([
        StoreEngine.getStoreItems(),
        StoreEngine.getUserInventory(auth.uid),
        RewardCoinEngine.getWallet(auth.uid),
        RewardCoinEngine.getTransactions(auth.uid),
      ]);

      return res.status(200).json({
        success: true,
        items,
        inventory,
        coinWallet,
        coinTransactions,
      });
    }

    if (req.method === 'POST' && action === 'buy') {
      const { itemId } = req.body;
      if (!itemId) throw new Error('ID do item de loja é obrigatório.');

      const result = await StoreEngine.buyItem(auth.uid, String(itemId));
      return res.status(200).json({
        success: true,
        message: `Compra de "${result.item.name}" realizada com sucesso!`,
        result
      });
    }

    return res.status(400).json({ success: false, error: 'Ação de loja não suportada.' });
  } catch (err: any) {
    console.error('[Store Handler Error]:', err);
    return res.status(400).json({ success: false, error: err.message || 'Erro ao processar loja de IV Coins.' });
  }
}
