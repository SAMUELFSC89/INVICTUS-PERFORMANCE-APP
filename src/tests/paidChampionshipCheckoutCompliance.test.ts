import fs from 'node:fs';
import path from 'node:path';
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

  it('expõe CTA de pagamento somente no iOS nativo e deixa Android preparado para o site', () => {
    const page = read('src/pages/championships/ChampionshipPreview.tsx');
    expect(page).toContain("const isNativeIOS = Capacitor.isNativePlatform() && platform === 'ios'");
    expect(page).toContain("const isNativeAndroid = Capacitor.isNativePlatform() && platform === 'android'");
    expect(page).toContain("championshipService.createPayment(championshipId, accepted.acceptanceId, 'ios_native')");
    expect(page).toContain('{isNativeIOS && !paid && <button');
    expect(page).toContain('ANDROID_EXTERNAL_ENROLLMENT_NOTICE');
    expect(page).not.toContain("checkoutSurface: 'android_native'");
  });

  it('mantém a abertura fail-closed até calendário, homologação, premiação e modalidade de cardio serem publicados', () => {
    const catalog = read('api/_lib/championship-catalog.ts');
    expect(catalog).toContain('PAID_CHAMPIONSHIP_SETTLEMENT_IMPLEMENTED = true');
    expect(catalog).toContain('PAID_CHAMPIONSHIP_REGISTRATION_ENABLED');
    expect(catalog).toContain('A premiação oficial ainda não foi publicada ou possui posições inválidas.');
    expect(catalog).toContain('As modalidades de cardio elegíveis ainda não foram publicadas.');
    expect(catalog).toContain('registrationOpensAt');
    expect(catalog).toContain('registrationClosesAt');
    expect(catalog).toContain('settlementAt');
    expect(catalog).toContain('publishedConfigDigest');
  });

  it('mantém a chave do Asaas exclusivamente no backend', () => {
    const page = read('src/pages/championships/ChampionshipPreview.tsx');
    const service = read('src/services/championshipService.ts');
    expect(page).not.toContain('ASAAS_API_KEY');
    expect(service).not.toContain('ASAAS_API_KEY');
    expect(read('api/_lib/asaas-client.ts')).toContain('ASAAS_API_KEY');
  });
});
