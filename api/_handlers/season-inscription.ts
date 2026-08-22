import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth, db } from '../_lib/common.js';
import {
  criarInscricao,
  lerConfiguracaoInscricao,
  temporadaDaInscricao,
} from '../_lib/inscricao-service.js';

/**
 * Inscricao na temporada da Liga Invictus.
 *
 * GET  -> estado atual: se as inscricoes estao abertas, valor, e se o atleta
 *         ja esta inscrito.
 * POST -> emite a cobranca PIX e devolve o QR code.
 *
 * A cobranca acontece FORA das lojas, por exigencia da propria regra delas:
 * IAP e proibido para entrada em competicao de dinheiro real.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const autenticado = await verifyAuth(req);
  if (!autenticado) {
    return res.status(401).json({ error: 'Nao autenticado' });
  }

  try {
    if (req.method === 'GET') {
      const config = await lerConfiguracaoInscricao();
      const { janela } = await temporadaDaInscricao();

      const doc = await db
        .collection('season_inscriptions')
        .doc(`${autenticado.uid}_${janela.seasonId}`)
        .get();

      const dados: any = doc.exists ? doc.data() : null;

      return res.status(200).json({
        inscricoesAbertas: config.abertas,
        valor: config.valor,
        seasonId: janela.seasonId,
        inicioDaTemporada: janela.startDate.toISOString(),
        fimDaTemporada: janela.endDate.toISOString(),
        minhaInscricao: dados
          ? { status: dados.status, valor: dados.valor, gymId: dados.gymId }
          : null,
      });
    }

    if (req.method === 'POST') {
      const resultado = await criarInscricao(autenticado.uid);
      return res.status(200).json(resultado);
    }

    return res.status(405).json({ error: 'Metodo nao suportado' });
  } catch (erro: any) {
    // Erros de regra (inscricoes fechadas, sem CPF, ja inscrito) sao do
    // usuario e voltam como 400 com a mensagem legivel.
    const mensagem = erro?.message || 'Falha ao processar a inscricao.';
    const ehRegra = /inscri|academia|CPF|Usuario nao encontrado/i.test(mensagem);
    if (!ehRegra) {
      console.error('[season-inscription] erro inesperado:', mensagem, erro);
    }
    return res.status(ehRegra ? 400 : 500).json({ error: mensagem });
  }
}
