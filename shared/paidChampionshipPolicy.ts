export const PAID_CHAMPIONSHIP_ENTRY_PRICE_BRL = 29.90;
export const PAID_CHAMPIONSHIP_RULES_VERSION = 'paid-championship-v1';

export const CHAMPIONSHIP_ORGANIZER = {
  legalName: 'INVICTUS PERFORMANCE E SOLUÇÕES LTDA.',
  cnpj: '67.770.822/0001-22',
  address: 'Rua Primeiro de Setembro, nº 70, Sala 301, Porto Alegre/RS',
  contactEmail: 'contato@invictusperformance.app.br',
} as const;

export const APPLE_CHAMPIONSHIP_DISCLAIMER =
  'A Apple Inc. e a App Store não são patrocinadoras, organizadoras, parceiras nem estão envolvidas neste campeonato ou em sua premiação.';

export const ANDROID_EXTERNAL_ENROLLMENT_NOTICE =
  'No Android, a inscrição paga será realizada no site oficial do Invictus quando a edição estiver aberta. Depois da confirmação do pagamento, o status de inscrição aparece automaticamente no aplicativo.';

export type PaidChampionshipOfferId = 'invictus_strength_v1' | 'invictus_cardio_v1';

export interface PaidChampionshipOfferPolicy {
  id: PaidChampionshipOfferId;
  modality: 'musculacao' | 'cardio';
  title: string;
  shortTitle: string;
  regulationVersion: string;
  regulationHash: string;
  entryPrice: number;
  performanceDescription: string;
}

export const PAID_CHAMPIONSHIP_OFFERS: Record<PaidChampionshipOfferId, PaidChampionshipOfferPolicy> = {
  invictus_strength_v1: {
    id: 'invictus_strength_v1',
    modality: 'musculacao',
    title: 'Campeonato Invictus de Musculação',
    shortTitle: 'Musculação',
    regulationVersion: 'invictus-strength-v1',
    regulationHash: 'invictus-strength-v1-rules-2026-09',
    entryPrice: PAID_CHAMPIONSHIP_ENTRY_PRICE_BRL,
    performanceDescription: 'Treinos reais de musculação elegíveis, registrados durante a janela oficial e aprovados pelos controles de integridade do Invictus.',
  },
  invictus_cardio_v1: {
    id: 'invictus_cardio_v1',
    modality: 'cardio',
    title: 'Campeonato Invictus de Cardio',
    shortTitle: 'Cardio',
    regulationVersion: 'invictus-cardio-v1',
    regulationHash: 'invictus-cardio-v1-rules-2026-09',
    entryPrice: PAID_CHAMPIONSHIP_ENTRY_PRICE_BRL,
    performanceDescription: 'Atividades reais de cardio da modalidade publicada para a edição, registradas durante a janela oficial e aprovadas pelos controles de integridade do Invictus.',
  },
};

export interface ChampionshipRuleSection {
  id: string;
  title: string;
  body: string;
}

export function getPaidChampionshipRuleSections(offer: PaidChampionshipOfferPolicy): ChampionshipRuleSection[] {
  return [
    {
      id: 'organizer',
      title: '1. ORGANIZADOR E NATUREZA',
      body: `${offer.title} é promovido e patrocinado por ${CHAMPIONSHIP_ORGANIZER.legalName}, CNPJ ${CHAMPIONSHIP_ORGANIZER.cnpj}. É uma competição esportiva de habilidade e desempenho físico. A classificação decorre de atividades reais elegíveis e validadas; não há sorteio, roleta, número aleatório ou resultado determinado por acaso.`,
    },
    {
      id: 'eligibility',
      title: '2. ELEGIBILIDADE',
      body: 'A participação é exclusiva para pessoas com 18 anos ou mais, titulares de conta própria e regular no Invictus. É proibido compartilhar conta, usar identidade de terceiros, automatizar registros, adulterar sensores, localização, fotos, vídeos ou qualquer evidência de atividade.',
    },
    {
      id: 'entry',
      title: '3. INSCRIÇÃO E PAGAMENTO',
      body: `A taxa de inscrição é de R$ ${offer.entryPrice.toFixed(2).replace('.', ',')} por campeonato. A cobrança é avulsa, não recorrente. No iOS, quando a edição estiver aberta, o pagamento é concluído em página segura hospedada pelo Asaas, com Pix ou cartão de crédito. O retorno do navegador não confirma a inscrição: somente a confirmação financeira recebida pelo servidor do Invictus libera a participação.`,
    },
    {
      id: 'performance',
      title: '4. DESEMPENHO E ATIVIDADES VÁLIDAS',
      body: `${offer.performanceDescription} Somente atividades concluídas dentro do período oficial, compatíveis com a modalidade da edição e consideradas elegíveis pelo servidor podem entrar na classificação. Atividades fora do período ou da modalidade publicada não pontuam.`,
    },
    {
      id: 'scoring',
      title: '5. PONTUAÇÃO, CLASSIFICAÇÃO E DESEMPATE',
      body: 'A pontuação competitiva usa somente resultados homologados pelo servidor; o app não aceita score, risco ou classificação enviados pelo próprio usuário como autoridade. Em igualdade de pontuação total, o desempate segue, nesta ordem: maior número de atividades válidas; maior total de minutos válidos; e, persistindo igualdade, quem atingiu a pontuação final primeiro, conforme timestamps do servidor. Se ainda existir empate técnico em posição premiada, a homologação fica bloqueada para revisão em vez de escolher um vencedor arbitrariamente.',
    },
    {
      id: 'integrity',
      title: '6. INTEGRIDADE, ANTIFRAUDE E REVISÃO',
      body: 'Podem ser analisados duração, distância, ritmo, GPS, frequência cardíaca, origem do registro, duplicidade, aparelho, presença, foto, vídeo e outros sinais compatíveis com a modalidade. Uma atividade pode ser aprovada, rejeitada ou enviada para revisão. Tentativa de fraude pode causar invalidação da atividade, retirada da classificação, suspensão da participação ou encerramento da conta, preservado o direito de contestação pelo suporte.',
    },
    {
      id: 'health',
      title: '7. SAÚDE E FREQUÊNCIA CARDÍACA',
      body: 'O Invictus não é dispositivo médico. Sensores e plataformas de saúde podem apresentar atraso, lacunas ou imprecisão. Quando frequência cardíaca influenciar validação, intensidade, pontuação ou desempate, o participante deverá aceitar separadamente a ciência competitiva vigente. A participação não substitui avaliação médica nem orientação profissional.',
    },
    {
      id: 'prize',
      title: '8. PREMIAÇÃO E RESULTADO FINAL',
      body: 'A premiação, quantidade de posições premiadas, valores e data de homologação são publicados na edição antes da abertura das inscrições e passam a integrar o regulamento efetivo daquela edição. O resultado só é homologado depois do encerramento e não é pago enquanto houver atividade em revisão, inconsistência competitiva ou pagamento em disputa/conciliação. A premiação em dinheiro é creditada em reais na carteira sacável do atleta elegível, com lançamento financeiro auditável e idempotente.',
    },
    {
      id: 'refunds',
      title: '9. CANCELAMENTO, REEMBOLSO E CHARGEBACK',
      body: 'Cancelamentos e reembolsos seguem a legislação aplicável, o regulamento específico da edição e o estágio da competição. Reembolso ou chargeback confirmado pode cancelar a inscrição e retirar a elegibilidade competitiva daquela edição. Inscrição em disputa ou conciliação bloqueia a homologação financeira até a resolução. O registro financeiro e de auditoria é preservado pelo prazo necessário ao cumprimento de obrigações legais e à prevenção de fraude.',
    },
    {
      id: 'privacy',
      title: '10. PRIVACIDADE E DADOS',
      body: 'Dados necessários à inscrição, pagamento, atividade, saúde autorizada e prevenção à fraude são tratados conforme os Termos de Uso e a Política de Privacidade do Invictus. Dados brutos de saúde, CPF e sinais internos de segurança não são publicados no ranking. Permissões do sistema operacional continuam separadas do aceite deste regulamento.',
    },
    {
      id: 'support',
      title: '11. CONTESTAÇÃO E CONTATO',
      body: `O participante pode contestar atividade, validação, pontuação, classificação ou falha técnica pelo suporte em ${CHAMPIONSHIP_ORGANIZER.contactEmail}. O pedido de revisão não altera automaticamente o resultado e poderá exigir evidências originais.`,
    },
    {
      id: 'apple',
      title: '12. APPLE / APP STORE',
      body: APPLE_CHAMPIONSHIP_DISCLAIMER,
    },
  ];
}
