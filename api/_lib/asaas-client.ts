export function getAsaasBaseUrl(): string {
  if (process.env.ASAAS_API_BASE_URL) {
    return process.env.ASAAS_API_BASE_URL;
  }
  const env = (process.env.ASAAS_ENVIRONMENT || '').trim().toLowerCase();
  if (env === 'production') {
    return 'https://api.asaas.com/v3';
  }
  // URL oficial atual do Sandbox. Default continua sandbox para impedir
  // movimentação real quando o ambiente não foi explicitamente configurado.
  return 'https://api-sandbox.asaas.com/v3';
}

function getAsaasApiKey(): string {
  const key = process.env.ASAAS_API_KEY;
  if (!key) {
    throw new Error('ASAAS_API_KEY não configurada no ambiente.');
  }
  return key;
}

export type AsaasPixKeyType = 'cpf' | 'email' | 'phone' | 'random';

function mapPixKeyTypeToAsaas(type: AsaasPixKeyType): string {
  switch (type) {
    case 'cpf': return 'CPF';
    case 'email': return 'EMAIL';
    case 'phone': return 'PHONE';
    case 'random': return 'EVP';
    default: return 'EVP';
  }
}

export interface AsaasTransferResult {
  id: string;
  status: string;
  value: number;
  externalReference?: string;
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
  encodedImage: string;
  payload: string;
  expirationDate?: string;
}

export interface AsaasPaymentMutationResult {
  id: string;
  status: string;
  deleted?: boolean;
  value?: number;
  raw: any;
}

export interface AsaasHostedCheckoutResult {
  id: string;
  link: string;
  status: string;
  externalReference: string;
  raw: any;
}

function mensagemDeErroAsaas(data: any, status: number, acao: string): string {
  return (data && data.errors && data.errors[0] && data.errors[0].description)
    || data?.message
    || `Falha ao ${acao} no Asaas (HTTP ${status}).`;
}

async function chamarAsaas(caminho: string, init: RequestInit, acao: string): Promise<any> {
  const response = await fetch(getAsaasBaseUrl() + caminho, {
    ...init,
    signal: init.signal || AbortSignal.timeout(30_000),
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'InvictusPerformance/1.0 (Node.js)',
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

export class AsaasClient {
  static async transferPix(params: {
    value: number;
    pixKey: string;
    pixKeyType: AsaasPixKeyType;
    description?: string;
    /** ID canônico do saque no Invictus. O Asaas devolve este campo em consultas/webhooks. */
    externalReference?: string;
  }): Promise<AsaasTransferResult> {
    const { value, pixKey, pixKeyType, description, externalReference } = params;
    if (!Number.isFinite(value) || value <= 0) throw new Error('Valor da transferência PIX deve ser maior que zero.');
    if (!pixKey || !pixKey.trim()) throw new Error('Chave PIX de destino é obrigatória.');
    const normalizedReference = externalReference?.trim();
    if (normalizedReference && (
      normalizedReference.length < 8
      || normalizedReference.length > 500
      || normalizedReference.includes('/')
      || /[\u0000-\u001F\u007F]/.test(normalizedReference)
    )) {
      throw new Error('Referência externa da transferência PIX é inválida.');
    }

    const response = await fetch(getAsaasBaseUrl() + '/transfers', {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'InvictusPerformance/1.0 (Node.js)',
        'access_token': getAsaasApiKey()
      },
      body: JSON.stringify({
        value,
        pixAddressKey: pixKey.trim(),
        pixAddressKeyType: mapPixKeyTypeToAsaas(pixKeyType),
        description: description || 'Saque Invictus Performance',
        ...(normalizedReference ? { externalReference: normalizedReference } : {})
      })
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(mensagemDeErroAsaas(data, response.status, 'solicitar transferência PIX'));
    }
    if (typeof data?.id !== 'string' || !data.id.trim()) {
      throw new Error('Asaas não devolveu o identificador da transferência PIX. A operação exige conciliação antes de nova tentativa.');
    }
    if (typeof data.value !== 'number' || !Number.isFinite(data.value) || Math.abs(data.value - value) >= 0.01) {
      throw new Error('Asaas devolveu valor ausente ou divergente para a transferência PIX. A operação exige conciliação.');
    }
    if (normalizedReference && typeof data.externalReference === 'string' && data.externalReference.trim() !== normalizedReference) {
      throw new Error('Asaas devolveu referência externa divergente para a transferência PIX. A operação exige conciliação.');
    }
    return {
      id: data.id.trim(),
      status: data.status || 'PENDING',
      value: data.value,
      externalReference: typeof data.externalReference === 'string' ? data.externalReference : normalizedReference,
      raw: data
    };
  }

  /**
   * Checkout hospedado para inscrição avulsa em campeonato esportivo.
   * A API key permanece exclusivamente no servidor. O cliente recebe apenas
   * a URL pública do Checkout e a confirmação financeira vem por webhook.
   */
  static async criarCheckoutHospedado(params: {
    valor: number;
    nomeItem: string;
    descricao: string;
    referenciaExterna: string;
    nomeCliente: string;
    cpf: string;
    email?: string;
    successUrl: string;
    cancelUrl: string;
    expiredUrl: string;
    minutosExpiracao?: number;
  }): Promise<AsaasHostedCheckoutResult> {
    const cpfLimpo = String(params.cpf || '').replace(/\D/g, '');
    if (!Number.isFinite(params.valor) || params.valor <= 0) throw new Error('Valor do checkout deve ser maior que zero.');
    if (!params.referenciaExterna?.trim()) throw new Error('Referência externa do checkout é obrigatória.');
    if (!params.nomeCliente?.trim() || !cpfLimpo) throw new Error('Nome e CPF são obrigatórios para o checkout.');
    for (const url of [params.successUrl, params.cancelUrl, params.expiredUrl]) {
      if (!/^https:\/\//i.test(url)) throw new Error('Callbacks do checkout devem usar HTTPS.');
    }

    const data = await chamarAsaas('/checkouts', {
      method: 'POST',
      body: JSON.stringify({
        billingTypes: ['PIX', 'CREDIT_CARD'],
        chargeTypes: ['DETACHED'],
        minutesToExpire: Math.min(1440, Math.max(10, Math.floor(params.minutosExpiracao || 60))),
        externalReference: params.referenciaExterna.trim().slice(0, 200),
        callback: {
          successUrl: params.successUrl,
          cancelUrl: params.cancelUrl,
          expiredUrl: params.expiredUrl,
        },
        items: [{
          externalReference: params.referenciaExterna.trim().slice(0, 200),
          name: params.nomeItem.trim().slice(0, 120),
          description: params.descricao.trim().slice(0, 500),
          quantity: 1,
          value: Number(params.valor.toFixed(2)),
        }],
        customerData: {
          name: params.nomeCliente.trim(),
          cpfCnpj: cpfLimpo,
          ...(params.email?.trim() ? { email: params.email.trim() } : {}),
        },
      }),
    }, 'criar checkout hospedado');

    if (typeof data?.id !== 'string' || !data.id.trim()) {
      throw new Error('Asaas não devolveu o identificador do checkout.');
    }
    const checkoutEnv = (process.env.ASAAS_ENVIRONMENT || '').trim().toLowerCase();
    const fallbackHost = checkoutEnv === 'production' ? 'https://asaas.com' : 'https://sandbox.asaas.com';
    const link = typeof data.link === 'string' && /^https:\/\//i.test(data.link)
      ? data.link
      : `${fallbackHost}/checkoutSession/show?id=${encodeURIComponent(data.id)}`;
    return {
      id: data.id,
      link,
      status: data.status || 'ACTIVE',
      externalReference: data.externalReference || params.referenciaExterna,
      raw: data,
    };
  }

  static async criarOuObterCliente(params: {
    nome: string;
    cpf: string;
    email?: string;
    referenciaExterna?: string;
  }): Promise<string> {
    const cpfLimpo = (params.cpf || '').replace(/\D/g, '');
    if (!cpfLimpo) throw new Error('CPF e obrigatorio para emitir a cobranca da inscricao.');
    if (!params.nome?.trim()) throw new Error('Nome e obrigatorio para emitir a cobranca da inscricao.');

    const existentes = await chamarAsaas(
      `/customers?cpfCnpj=${cpfLimpo}`,
      { method: 'GET' },
      'consultar cliente'
    );
    if (existentes?.data?.[0]?.id) return existentes.data[0].id;

    const criado = await chamarAsaas('/customers', {
      method: 'POST',
      body: JSON.stringify({
        name: params.nome.trim(),
        cpfCnpj: cpfLimpo,
        email: params.email,
        externalReference: params.referenciaExterna,
      }),
    }, 'criar cliente');
    if (!criado?.id) throw new Error('Asaas nao devolveu o identificador do cliente.');
    return criado.id;
  }

  /** Mantido para fluxos legados que ainda usam cobrança PIX direta. */
  static async criarCobrancaPix(params: {
    clienteId: string;
    valor: number;
    descricao: string;
    referenciaExterna: string;
    vencimento: string;
  }): Promise<AsaasCobrancaResult> {
    if (!params.valor || params.valor <= 0) throw new Error('Valor da inscricao deve ser maior que zero.');
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
    if (typeof data?.id !== 'string' || !data.id.trim()) {
      throw new Error('Asaas nao devolveu o identificador da cobranca. A intencao deve ser reconciliada antes de tentar novamente.');
    }
    return {
      id: data.id,
      status: data.status || 'PENDING',
      value: typeof data.value === 'number' ? data.value : params.valor,
      invoiceUrl: data.invoiceUrl,
      raw: data,
    };
  }

  static async buscarCobrancaPorReferenciaExterna(referenciaExterna: string): Promise<AsaasCobrancaResult | null> {
    const reference = referenciaExterna?.trim();
    if (!reference) return null;
    const data = await chamarAsaas(
      `/payments?externalReference=${encodeURIComponent(reference)}&limit=100`,
      { method: 'GET' },
      'consultar cobranca por referencia externa'
    );
    const payments = Array.isArray(data?.data) ? data.data : [];
    const canonical = payments
      .filter((payment: any) => payment?.id && payment.externalReference === reference && payment.deleted !== true)
      .sort((left: any, right: any) => String(left.dateCreated || '').localeCompare(String(right.dateCreated || '')) || String(left.id).localeCompare(String(right.id)))[0];
    if (!canonical) return null;
    return {
      id: canonical.id,
      status: canonical.status || 'PENDING',
      value: typeof canonical.value === 'number' ? canonical.value : 0,
      invoiceUrl: canonical.invoiceUrl,
      raw: canonical,
    };
  }

  static async obterCobranca(cobrancaId: string): Promise<AsaasCobrancaResult> {
    if (!cobrancaId?.trim()) throw new Error('Identificador da cobranca e obrigatorio.');
    const data = await chamarAsaas(
      `/payments/${encodeURIComponent(cobrancaId.trim())}`,
      { method: 'GET' },
      'consultar cobranca'
    );
    return {
      id: data.id || cobrancaId,
      status: data.status || 'PENDING',
      value: typeof data.value === 'number' ? data.value : 0,
      invoiceUrl: data.invoiceUrl,
      raw: data,
    };
  }

  static async cancelarCobranca(cobrancaId: string): Promise<AsaasPaymentMutationResult> {
    if (!cobrancaId?.trim()) throw new Error('Identificador da cobranca e obrigatorio para cancelar.');
    const data = await chamarAsaas(
      `/payments/${encodeURIComponent(cobrancaId.trim())}`,
      { method: 'DELETE' },
      'cancelar cobranca'
    );
    return {
      id: data.id || cobrancaId,
      status: data.deleted === true ? 'CANCELLED' : data.status || 'PENDING',
      deleted: data.deleted === true,
      raw: data,
    };
  }

  static async estornarPagamento(cobrancaId: string, params: { valor?: number; descricao?: string } = {}): Promise<AsaasPaymentMutationResult> {
    if (!cobrancaId?.trim()) throw new Error('Identificador da cobranca e obrigatorio para estornar.');
    const body: Record<string, unknown> = {};
    if (typeof params.valor === 'number' && Number.isFinite(params.valor) && params.valor > 0) body.value = params.valor;
    if (params.descricao?.trim()) body.description = params.descricao.trim().slice(0, 500);
    const data = await chamarAsaas(
      `/payments/${encodeURIComponent(cobrancaId.trim())}/refund`,
      { method: 'POST', body: JSON.stringify(body) },
      'solicitar estorno'
    );
    return {
      id: data.id || cobrancaId,
      status: data.status || 'REFUND_REQUESTED',
      value: typeof data.value === 'number' ? data.value : params.valor,
      raw: data,
    };
  }

  static async obterQrCodePix(cobrancaId: string): Promise<AsaasQrCodePix> {
    const data = await chamarAsaas(
      `/payments/${cobrancaId}/pixQrCode`,
      { method: 'GET' },
      'obter QR code PIX'
    );
    if (!data?.payload) throw new Error('Asaas nao devolveu o codigo PIX da cobranca.');
    return {
      encodedImage: data.encodedImage,
      payload: data.payload,
      expirationDate: data.expirationDate,
    };
  }
}
