import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db, verifyAuth } from '../_lib/common.js';
import { RewardCoinEngine } from '../_lib/reward-coin-engine.js';
import { StoreEngine } from '../_lib/store-engine.js';

async function requireAdmin(userId: string) {
  if (!db) return false;
  const snapshot = await db.collection('users').doc(userId).get();
  return snapshot.exists && snapshot.data()?.role === 'admin';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ success: false, error: 'Sessão inválida ou expirada.' });
  const action = String(req.query.action || req.body?.action || 'catalogue');

  try {
    if (req.method === 'GET' && action === 'catalogue') {
      await StoreEngine.ensureRealCatalogue();
      const [products, activeDrop, coinWallet, coinTransactions] = await Promise.all([
        StoreEngine.getPublicProducts(),
        StoreEngine.getActiveDrop(),
        RewardCoinEngine.getWallet(auth.uid),
        RewardCoinEngine.getTransactions(auth.uid),
      ]);
      return res.status(200).json({ success: true, products, activeDrop: activeDrop ? { id: activeDrop.id, name: activeDrop.name || null, productId: activeDrop.productId || null, coinPrice: activeDrop.coinPrice || null, availableStock: activeDrop.availableStock ?? null, limitPerUser: activeDrop.limitPerUser || null, startsAt: activeDrop.startsAt || null, endsAt: activeDrop.endsAt || null, status: activeDrop.status || null, shippingMode: activeDrop.shippingMode } : null, coinWallet, coinTransactions });
    }

    if (req.method === 'GET' && action === 'product') {
      await StoreEngine.ensureRealCatalogue();
      const product = await StoreEngine.getPublicProduct(String(req.query.productId || ''));
      if (!product) return res.status(404).json({ success: false, error: 'Produto indisponível.' });
      return res.status(200).json({ success: true, product });
    }

    if (req.method === 'GET' && action === 'my-orders') {
      const orders = await StoreEngine.getMyPhysicalOrders(auth.uid);
      return res.status(200).json({ success: true, orders });
    }

    if (req.method === 'GET' && action === 'payment-status') {
      const orderId = String(req.query.orderId || '');
      if (!orderId) return res.status(400).json({ success: false, error: 'Identificador do pedido ausente.' });
      const order = await StoreEngine.getPhysicalOrder(auth.uid, orderId);
      if (!order) return res.status(404).json({ success: false, error: 'Pedido não encontrado.' });
      return res.status(200).json({ success: true, order });
    }

    if (req.method === 'POST' && action === 'resume-payment') {
      const orderId = String(req.body?.orderId || '');
      if (!orderId) return res.status(400).json({ success: false, error: 'Identificador do pedido ausente.' });
      const payment = await StoreEngine.createPaymentForOrder(auth.uid, orderId);
      const order = await StoreEngine.getPhysicalOrder(auth.uid, orderId);
      if (!order) return res.status(404).json({ success: false, error: 'Pedido não encontrado.' });
      return res.status(200).json({ success: true, order, payment });
    }

    if (req.method === 'POST' && action === 'cancel-order') {
      const orderId = String(req.body?.orderId || '');
      if (!orderId) return res.status(400).json({ success: false, error: 'Identificador do pedido ausente.' });
      const financialOperation = await StoreEngine.cancelPendingOrder(auth.uid, orderId);
      const order = await StoreEngine.getPhysicalOrder(auth.uid, orderId);
      const pending = financialOperation.state === 'PENDING';
      return res.status(pending ? 202 : 200).json({ success: true, pending, order, financialOperation });
    }

    if (req.method === 'POST' && action === 'redeem-with-coins') {
      const result = await StoreEngine.redeemWithCoins({ userId: auth.uid, productId: String(req.body.productId || ''), quantity: Number(req.body.quantity), address: req.body.address, idempotencyKey: String(req.body.idempotencyKey || '') });
      return res.status(result.duplicated ? 200 : 201).json({ success: true, ...result });
    }

    if (req.method === 'POST' && action === 'create-cash-order') {
      const paymentMethod = req.body.paymentMethod === 'COINS_PLUS_MONEY' ? 'COINS_PLUS_MONEY' : 'MONEY';
      const result = await StoreEngine.createMoneyOrder({ userId: auth.uid, productId: String(req.body.productId || ''), quantity: Number(req.body.quantity), address: req.body.address, paymentMethod, idempotencyKey: String(req.body.idempotencyKey || '') });
      const payment = await StoreEngine.createPaymentForOrder(auth.uid, result.order.orderId);
      return res.status(result.duplicated ? 200 : 201).json({ success: true, ...result, payment });
    }

    const admin = await requireAdmin(auth.uid);
    if (!admin) return res.status(403).json({ success: false, error: 'Acesso administrativo obrigatório.' });

    if (req.method === 'GET' && action === 'admin-products') {
      const products = await StoreEngine.getAdminProducts();
      return res.status(200).json({ success: true, products });
    }

    if (req.method === 'GET' && action === 'admin-drops') {
      const drops = await StoreEngine.getAdminDrops();
      return res.status(200).json({ success: true, drops });
    }

    if (req.method === 'GET' && action === 'admin-orders') {
      const orders = await StoreEngine.getAdminOrders();
      return res.status(200).json({ success: true, orders });
    }

    if (req.method === 'POST' && action === 'import-catalogue') {
      const result = await StoreEngine.ensureRealCatalogue();
      return res.status(200).json({ success: true, result });
    }

    if (req.method === 'POST' && action === 'update-pricing') {
      const product = await StoreEngine.updatePricing(String(req.body.productId || ''), req.body.pricing || {});
      return res.status(200).json({ success: true, product });
    }

    if (req.method === 'POST' && action === 'update-supplier-cost') {
      await StoreEngine.updateSupplierCost(String(req.body.productId || ''), Number(req.body.newCost), String(req.body.source || 'admin'));
      return res.status(200).json({ success: true });
    }

    if (req.method === 'POST' && action === 'update-product-configuration') {
      const product = await StoreEngine.updateProductConfiguration(String(req.body.productId || ''), req.body.configuration || {});
      return res.status(200).json({ success: true, product });
    }

    if (req.method === 'POST' && action === 'save-drop') {
      const drop = await StoreEngine.saveDrop(req.body.drop || {});
      return res.status(200).json({ success: true, drop });
    }

    if (req.method === 'POST' && action === 'update-order-status') {
      const financialOperation = await StoreEngine.updateOrderStatus(String(req.body.orderId || ''), req.body.status, req.body.trackingCode);
      const pending = financialOperation ? financialOperation.state === 'PENDING' : false;
      return res.status(pending ? 202 : 200).json({ success: true, pending, financialOperation: financialOperation || null });
    }

    return res.status(400).json({ success: false, error: 'Ação de loja não suportada.' });
  } catch (error: any) {
    console.error('[Store Handler Error]:', error);
    const statusCode = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : error?.retryable ? 503 : 400;
    return res.status(statusCode).json({ success: false, retryable: Boolean(error?.retryable), error: error?.message || 'Erro ao processar a Loja Invictus.' });
  }
}
