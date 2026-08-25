export function getAsaasBaseUrl(): string {
  if (process.env.ASAAS_API_BASE_URL) {
    return process.env.ASAAS_API_BASE_URL;
  }
  const env = (process.env.ASAAS_ENVIRONMENT || '').trim().toLowerCase();
  if (env === 'production') {
    return 'https://api.asaas.com/v3';
  }
  // Default to sandbox for safety when not explicitly in production
  return 'https://sandbox.asaas.com/api/v3';
}

function getAsaasApiKey(): string {
  const key = process.env.ASAAS_API_KEY;
  if (!key) {
    throw new Error('ASAAS_API_KEY não configurada no ambiente. Configure a chave de API do Asaas para processar saques via PIX.');
  }
  return key;
}

export type AsaasPixKeyType = 'cpf' | 'email' | 'phone' | 'random';

function mapPixKeyTypeToAsaas(type: AsaasPixKeyType): string {
  switch (type) {
    case 'cpf':
      return 'CPF';
    case 'email':
      return 'EMAIL';
    case 'phone':
      return 'PHONE';
    case 'random':
      return 'EVP';
    default:
      return 'EVP';
  }
}

export interface AsaasTransferResult {
  id: string;
  status: string;
  value: number;
  raw: any;
}

export interface AsaasCobrancaResult {
  id: string;
  status: string;
  value: number;
  invoiceUrl?: string;
  raw: any;
}

export interface AsaasQrCodePix {
  /** Imagem do QR code em base64, sem o prefixo data:. */
  encodedImage: string;
  /** Codigo copia-e-cola. */
  payload: string;
  expirationDate?: string;
}

/** Erro da API do Asaas, com a mensagem que eles devolvem. */
function mensagemDeErroAsaas(data: any, status: number, acao: string): string {
  return (data && data.errors && data.errors[0] && data.errors[0].description)
    || data?.message
    || `Falha ao ${acao} no Asaas (HTTP ${status}).`;
}

async function chamarAsaas(caminho: string, init: RequestInit, acao: string): Promise<any> {
  const response = await fetch(getAsaasBaseUrl() + caminho, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'access_token': getAsaasApiKey(),
      ...(init.headers || {}),
    },
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(mensagemDeErroAsaas(data, response.status, acao));
  }
  return data;
}

/**
 * Cliente HTTP para a API de Transferências via Pix do Asaas.
 * Docs: https://docs.asaas.com/reference/criar-transferencia
 *
 * Usado para automatizar o envio real do PIX de saque ao atleta, disparado
 * pelo admin na tela /admin/payouts (WithdrawalEngine.processPayment).
 */
export class AsaasClient {
  static async transferPix(params: {
    value: number;
    pixKey: string;
    pixKeyType: AsaasPixKeyType;
    description?: string;
  }): Promise<AsaasTransferResult> {
    const { value, pixKey, pixKeyType, description } = params;

    if (!value || value <= 0) {
      throw new Error('Valor da transferência PIX deve ser maior que zero.');
    }
    if (!pixKey || !pixKey.trim()) {
      throw new Error('Chave PIX de destino é obrigatória.');
    }

    const response = await fetch(getAsaasBaseUrl() + '/transfers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access_token': getAsaasApiKey()
      },
      body: JSON.stringify({
        value,
        pixAddressKey: pixKey.trim(),
        pixAddressKeyType: mapPixKeyTypeToAsaas(pixKeyType),
        description: description || 'Saque Invictus Performance'
      })
    });

    const data: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = (data && data.errors && data.errors[0] && data.errors[0].description)
        || data.message
        || ('Falha ao solicitar transferência PIX ao Asaas (HTTP ' + response.status + ').');
      throw new Error(message);
    }

    return {
      id: data.id,
      status: data.status || 'PENDING',
      value: typeof data.value === 'number' ? data.value : value,
      raw: data
    };
  }

  // ------------------------------------------------------------------
  // COBRANCA (entrada de dinheiro) -- usada para a inscricao na temporada.
  //
  // Este e o sentido oposto da transferencia acima. A inscricao em competicao
  // NAO pode ser cobrada por compra dentro do app (IAP): a regra das lojas
  // proibe IAP para entrada em disputa de dinheiro real e permite meio de
  // pagamento proprio. Por isso ela passa por aqui.
  // ------------------------------------------------------------------

  /**
   * Cria (ou reaproveita) o cliente no Asaas. O Asaas exige um cliente para
   * emitir cobranca, e identifica duplicidade pelo CPF.
   */
  static async criarOuObterCliente(params: {
    nome: string;
    cpf: string;
    email?: string;
    referenciaExterna?: string;
  }): Promise<string> {
    const cpfLimpo = (params.cpf || '').replace(/\D/g, '');
    if (!cpfLimpo) {
      throw new Error('CPF e obrigatorio para emitir a cobranca da inscricao.');
    }
    if (!params.nome?.trim()) {
      throw new Error('Nome e obrigatorio para emitir a cobranca da inscricao.');
    }

    const existentes = await chamarAsaas(
      `/customers?cpfCnpj=${cpfLimpo}`,
      { method: 'GET' },
      'consultar cliente'
    );
    if (existentes?.data?.[0]?.id) {
      return existentes.data[0].id;
    }

    const criado = await chamarAsaas('/customers', {
      method: 'POST',
      body: JSON.stringify({
        name: params.nome.trim(),
        cpfCnpj: cpfLimpo,
        email: params.email,
        externalReference: params.referenciaExterna,
      }),
    }, 'criar cliente');

    if (!criado?.id) {
      throw new Error('Asaas nao devolveu o identificador do cliente.');
    }
    return criado.id;
  }

  /** Emite uma cobranca PIX. */
  static async criarCobrancaPix(params: {
    clienteId: string;
    valor: number;
    descricao: string;
    referenciaExterna: string;
    vencimento: string; // AAAA-MM-DD
  }): Promise<AsaasCobrancaResult> {
    if (!params.valor || params.valor <= 0) {
      throw new Error('Valor da inscricao deve ser maior que zero.');
    }

    const data = await chamarAsaas('/payments', {
      method: 'POST',
      body: JSON.stringify({
        customer: params.clienteId,
        billingType: 'PIX',
        value: params.valor,
        dueDate: params.vencimento,
        description: params.descricao,
        externalReference: params.referenciaExterna,
      }),
    }, 'criar cobranca');

    return {
      id: data.id,
      status: data.status || 'PENDING',
      value: typeof data.value === 'number' ? data.value : params.valor,
      invoiceUrl: data.invoiceUrl,
      raw: data,
    };
  }

  /** Busca o QR code e o copia-e-cola de uma cobranca PIX ja criada. */
  static async obterQrCodePix(cobrancaId: string): Promise<AsaasQrCodePix> {
    const data = await chamarAsaas(
      `/payments/${cobrancaId}/pixQrCode`,
      { method: 'GET' },
      'obter QR code PIX'
    );

    if (!data?.payload) {
      throw new Error('Asaas nao devolveu o codigo PIX da cobranca.');
    }

    return {
      encodedImage: data.encodedImage,
      payload: data.payload,
      expirationDate: data.expirationDate,
    };
  }
}
