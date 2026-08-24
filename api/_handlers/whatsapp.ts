import { cors, verifyAuth } from '../_lib/common.js';

export default async function handler(req: any, res: any) {
  if (cors(req, res)) return;

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Autenticação necessária.' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  // Não reporte como entregue algo que não foi enviado. A implementação
  // anterior era apenas um mock e ainda registrava telefone/mensagem em log.
  // Quando houver provedor oficial (Meta/Twilio), ele deve ser integrado aqui
  // com credenciais de ambiente, template aprovado e consentimento do usuário.
  return res.status(501).json({
    success: false,
    error: 'A integração de WhatsApp ainda não está disponível.'
  });
}
