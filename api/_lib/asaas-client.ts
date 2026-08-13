const ASAAS_API_BASE_URL = process.env.ASAAS_API_BASE_URL || 'https://api.asaas.com/v3';

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

    const response = await fetch(ASAAS_API_BASE_URL + '/transfers', {
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
}
