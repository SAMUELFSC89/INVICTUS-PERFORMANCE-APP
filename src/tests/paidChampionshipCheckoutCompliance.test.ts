import fs from 'node:fs';
import path from 'path';
import {
  APPLE_CHAMPIONSHIP_DISCLAIMER,
  CHAMPIONSHIP_ORGANIZER,
  PAID_CHAMPIONSHIP_ENTRY_PRICE_BRL,
  PAID_CHAMPIONSHIP_OFFERS,
  getPaidChampionshipRuleSections,
} from '../../shared/paidChampionshipPolicy';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('campeonatos pagos — contrato de checkout e compliance', () => {
  it('mantém preço único de R$ 29,90 para cardio e musculação', () => {
    expect(PAID_CHAMPIONSHIP_ENTRY_PRICE_BRL).toBe(29.9);
    expect(PAID_CHAMPIONSHIP_OFFERS.invictus_cardio_v1.entryPrice).toBe(29.9);
    expect(PAID_CHAMPIONSHIP_OFFERS.invictus_strength_v1.entryPrice).toBe(29.9);
  });

  it('publica organizador, elegibilidade, natureza por desempenho e disclaimer da Apple', () => {
    expect(CHAMPIONSHIP_ORGANIZER.cnpj).toBe('67.770.822/0001-22');
    expect(APPLE_CHAMPIONSHIP_DISCLAIMER).toContain('Apple Inc.');
    expect(APPLE_CHAMPIONSHIP_DISCLAIMER).toContain('não são patrocinadoras');
    const rules = getPaidChampionshipRuleSections(PAID_CHAMPIONSHIP_OFFERS.invictus_cardio_v1)
      .map((section) => `${section.title}\n${section.body}`).join('\n');
    expect(rules).toContain('18 anos ou mais');
    expect(rules).toContain('desempenho físico');
    expect(rules).toContain('não há sorteio');
    expect(rules).toContain('R$ 29,90');
    expect(rules).toContain('Asaas');
    expect(rules).toContain(CHAMPIONSHIP_ORGANIZER.contactEmail);
  });

  it('usa checkout hospedado Asaas com PIX/cartão, cobrança avulsa e callbacks HTTPS', () => {
    const asaas = read('api/_lib/asaas-client.ts');
    expect(asaas).toContain("chamarAsaas('/checkouts'");
    expect(asaas).toContain("billingTypes: ['PIX', 'CREDIT_CARD']");
    expect(asaas).toContain("chargeTypes: ['DETACHED']");
    expect(asaas).toContain('successUrl: params.successUrl');
    expect(asaas).toContain('cancelUrl: params.cancelUrl');
    expect(asaas).toContain('expiredUrl: params.expiredUrl');
    expect(asaas).toContain("return 'https://api-sandbox.asaas.com/v3'");
  });

  it('nunca usa o callback do navegador como prova financeira', () => {
    const handler = read('api/_handlers/championships.ts');
    const returnPage = read('public/championship-checkout-return.html');
    const returnScreen = read('src/pages/championships/ChampionshipCheckoutReturn.tsx');
    expect(handler).toContain("event === 'CHECKOUT_PAID'");
    expect(handler).toContain("event === 'CHECKOUT_CANCELED'");
    expect(handler).toContain("event === 'CHECKOUT_EXPIRED'");
    expect(returnPage).toContain('não confirma pagamento');
    expect(returnScreen).toContain('getRegistration(championshipId)');
    expect(returnScreen).not.toContain('paymentStatus:');
  });

  it('preserva o motor futuro, mas bloqueia inscrição paga no build de submissão', () => {
    const handler = read('api/_handlers/championships.ts');
    const page = read('src/pages/championships/ChampionshipPreview.tsx');
    const service = read('src/services/championshipService.ts');
    expect(handler).toContain('criarInscricaoChampionship(');
    expect(handler).not.toContain('criarPresenceCheck');
    expect(handler).not.toContain("actionType: 'championship_registration'");
    expect(page).not.toContain('VerifiedPresenceModal');
    expect(page).toContain('checkout.checkoutUrl');
    expect(page).toContain('const STORE_SUBMISSION_PAID_ENROLLMENT_ENABLED = false;');
    expect(page).toContain('SEM INSCRIÇÃO NESTA VERSÃO');
    expect(page).toContain('SEM EDIÇÃO PAGA ATIVA');
    expect(service).toContain('checkoutUrl: string');
    expect(service).not.toContain('presenceCheckRequired: true');
  });

  it('mantém os aceites compactos no motor futuro, inacessíveis enquanto o kill switch está fechado', () => {
    const page = read('src/pages/championships/ChampionshipPreview.tsx');
    expect(page).toContain('setConsentOpen(true)');
    expect(page).toContain('Confirme os aceites');
    expect(page).toContain('Li e aceito o Regulamento Oficial');
    expect(page).toContain('Estou ciente sobre frequência cardíaca');
    expect(page).toContain('Ver regulamento completo');
    expect(page).toContain('ACEITAR E PAGAR');
    expect(page).not.toContain('className="paid-acceptance"');
  });

  it('mantém como funciona, edição/premiação e regulamento recolhidos até tocar em ver mais', () => {
    const page = read('src/pages/championships/ChampionshipPreview.tsx');
    expect(page).toContain('<details className="group overflow-hidden rounded-2xl');
    expect(page).toContain('COMO FUNCIONA');
    expect(page).toContain('EDIÇÃO E PREMIAÇÃO');
    expect(page).toContain('REGULAMENTO OFICIAL');
    expect(page).toContain('O regulamento específico será publicado antes da abertura');
    expect(page).toContain('VER MAIS');
    expect(page).toContain('VER MENOS');
  });

  it('mantém o checkout futuro isolado no iOS, porém sem CTA no build enviado às lojas', () => {
    const page = read('src/pages/championships/ChampionshipPreview.tsx');
    expect(page).toContain("const isNativeIOS = Capacitor.isNativePlatform() && platform === 'ios'");
    expect(page).toContain("const isNativeAndroid = Capacitor.isNativePlatform() && platform === 'android'");
    expect(page).toContain("championshipService.createPayment(championshipId, accepted.acceptanceId, 'ios_native')");
    expect(page).toContain('{isNativeIOS && canStartEnrollment && <button');
    expect(page).toContain('ANDROID_EXTERNAL_ENROLLMENT_NOTICE');
    expect(page).toContain('const canStartEnrollment = STORE_SUBMISSION_PAID_ENROLLMENT_ENABLED && !paid && !enrollmentBlocked;');
    expect(page).not.toContain("checkoutSurface: 'android_native'");
  });

  it('bloqueia novo CTA em reembolso ou conciliação e mantém o kill switch da loja', () => {
    const page = read('src/pages/championships/ChampionshipPreview.tsx');
    const types = read('src/types/championships.ts');
    expect(page).toContain('const enrollmentBlocked = reconciliation || refunded;');
    expect(page).toContain('const canStartEnrollment = STORE_SUBMISSION_PAID_ENROLLMENT_ENABLED && !paid && !enrollmentBlocked;');
    expect(page).toContain('CONCILIAÇÃO FINANCEIRA');
    expect(page).toContain('REEMBOLSO REGISTRADO');
    expect(page).toContain('{isNativeIOS && canStartEnrollment && <button');
    expect(page).toContain("registration?.status === 'REJECTED'");
    expect(page).toContain("registration?.status === 'REFUNDED'");
    expect(page).not.toContain("registration?.status === 'CANCELLED' ||");
    expect(types).toContain("| 'RECONCILIATION_REQUIRED'");
    expect(types).toContain("| 'PAYMENT_CHARGEBACK_DISPUTE'");
  });

  it('mantém a abertura comercial dependente de configuração explícita mesmo com o motor habilitado', () => {
    const catalog = read('api/_lib/championship-catalog.ts');
    expect(catalog).toContain('PAID_CHAMPIONSHIP_SETTLEMENT_IMPLEMENTED = true');
    expect(catalog).toContain('PAID_CHAMPIONSHIP_REGISTRATION_ENABLED');
    expect(catalog).toContain('A edição ainda não foi liberada para inscrições.');
    expect(catalog).toContain('A premiação oficial ainda não foi publicada ou possui posições inválidas.');
    expect(catalog).toContain('As modalidades de cardio elegíveis ainda não foram publicadas.');
    expect(catalog).toContain('registrationOpensAt');
    expect(catalog).toContain('registrationClosesAt');
    expect(catalog).toContain('settlementAt');
    expect(catalog).toContain('publishedConfigDigest');
    expect(catalog).toContain('editionId');
  });

  it('isola inscrição da edição atual no frontend em vez de reutilizar histórico da modalidade', () => {
    const service = read('src/services/championshipService.ts');
    expect(service).toContain('registration.editionId === championship.editionId');
    expect(service).toContain("case 'contestada': return 'REJECTED'");
    expect(service).toContain('dados.externalPaymentReference');
  });

  it('documenta todas as variáveis necessárias para settlement e saques em produção', () => {
    const envExample = read('.env.example');
    expect(envExample).toContain('ASAAS_AUTHORIZATION_TOKEN=');
    expect(envExample).toContain('CRON_SECRET=');
    expect(envExample).toContain('PAID_CHAMPIONSHIP_REGISTRATION_ENABLED=false');
    expect(envExample).toContain('CHAMPIONSHIP_STRENGTH_SETTLEMENT_AT=');
    expect(envExample).toContain('CHAMPIONSHIP_CARDIO_SETTLEMENT_AT=');
    expect(envExample).toContain('CHAMPIONSHIP_CARDIO_ALLOWED_TYPES=');
  });

  it('mantém a chave do Asaas exclusivamente no backend', () => {
    const page = read('src/pages/championships/ChampionshipPreview.tsx');
    const service = read('src/services/championshipService.ts');
    expect(page).not.toContain('ASAAS_API_KEY');
    expect(service).not.toContain('ASAAS_API_KEY');
    expect(read('api/_lib/asaas-client.ts')).toContain('ASAAS_API_KEY');
  });
});
