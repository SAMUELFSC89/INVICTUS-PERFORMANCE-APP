import { Capacitor } from '@capacitor/core';
import { Purchases, LOG_LEVEL } from '@revenuecat/purchases-capacitor';

/**
 * Integração com a RevenueCat para compras nativas reais (Google Play / App Store)
 * do Plano Performance. O Plano Open é gratuito e nunca passa por este módulo.
 *
 * Configuração necessária (feita fora do código, nos dashboards):
 * 1. Criar conta gratuita em https://app.revenuecat.com
 * 2. Criar o produto de assinatura mensal no Google Play Console (e depois na App
 *    Store Connect, quando o iOS entrar), com o preço definido (ex: R$ 49,90/mês).
 * 3. Conectar o app Android/iOS ao projeto da RevenueCat e importar esse produto.
 * 4. Criar uma "Entitlement" chamada exatamente "performance" e vincular o produto.
 * 5. Criar uma "Offering" (ex: "default") com um "Package" que contenha esse produto.
 * 6. Copiar as chaves públicas de API (uma para Android, outra para iOS) em
 *    Project Settings > API Keys, e configurá-las como variáveis de ambiente do
 *    build: VITE_REVENUECAT_ANDROID_API_KEY e VITE_REVENUECAT_IOS_API_KEY.
 */

const REVENUECAT_ANDROID_API_KEY = import.meta.env.VITE_REVENUECAT_ANDROID_API_KEY || '';
const REVENUECAT_IOS_API_KEY = import.meta.env.VITE_REVENUECAT_IOS_API_KEY || '';

// Precisa bater exatamente com o identificador da Entitlement criada no dashboard.
export const PERFORMANCE_ENTITLEMENT_ID = 'performance';

let isConfigured = false;

/**
 * Inicializa o SDK da RevenueCat vinculando o usuário logado (Firebase UID) como
 * appUserID, para que o backend consiga consultar a assinatura pelo mesmo ID.
 * Deve ser chamado uma vez, assim que soubermos qual usuário está logado (ex: no
 * UserContext, logo após o login). Idempotente e seguro para chamar mais de uma vez.
 * Não faz nada fora do app nativo (Android/iOS), já que compras reais não existem
 * na versão web/preview.
 */
export async function configureRevenueCat(firebaseUid: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (isConfigured) return;
  if (!firebaseUid) return;

  const apiKey = Capacitor.getPlatform() === 'ios' ? REVENUECAT_IOS_API_KEY : REVENUECAT_ANDROID_API_KEY;
  if (!apiKey) {
    console.warn('[RevenueCat] Chave de API não configurada para esta plataforma (verifique as variáveis de ambiente VITE_REVENUECAT_ANDROID_API_KEY / VITE_REVENUECAT_IOS_API_KEY). Compras reais desativadas.');
    return;
  }

  try {
    await Purchases.setLogLevel({ level: LOG_LEVEL.WARN });
    await Purchases.configure({ apiKey, appUserID: firebaseUid });
    isConfigured = true;
  } catch (err) {
    console.error('[RevenueCat] Falha ao configurar o SDK:', err);
  }
}

/**
 * Executa a compra real da assinatura do Plano Performance através da loja nativa
 * (Google Play ou App Store, conforme a plataforma do dispositivo). Lança um erro
 * com mensagem amigável em qualquer cenário de falha, cancelamento pelo usuário ou
 * ausência de oferta configurada.
 */
export async function purchasePerformanceSubscription(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('A assinatura do Plano Performance só pode ser feita pelo aplicativo instalado (Android ou iOS), não é possível comprar pelo navegador.');
  }

  const offerings = await Purchases.getOfferings();
  const currentOffering = offerings.current;
  const availablePackages = currentOffering?.availablePackages || [];

  if (availablePackages.length === 0) {
    throw new Error('Nenhum plano de assinatura disponível no momento. Verifique sua conexão ou tente novamente mais tarde.');
  }

  // Usa o primeiro pacote disponível na oferta atual configurada no dashboard da
  // RevenueCat (normalmente há apenas um: a assinatura mensal do Plano Performance).
  const packageToPurchase = availablePackages[0];

  const { customerInfo } = await Purchases.purchasePackage({ aPackage: packageToPurchase });
  const isActive = !!customerInfo.entitlements.active[PERFORMANCE_ENTITLEMENT_ID];

  if (!isActive) {
    throw new Error('A compra foi processada pela loja, mas a assinatura ainda não foi confirmada. Tente novamente em instantes ou contate o suporte.');
  }
}
