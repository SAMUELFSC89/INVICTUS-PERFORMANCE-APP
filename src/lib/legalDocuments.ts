/** Documentos públicos do ecossistema Invictus — versão de produto 4.0.0. */
export const CURRENT_LEGAL_VERSION = 4;
export interface FAQItem {
  id: number;
  question: string;
  answer: string;
  category: 'Geral' | 'Conta & Perfil' | 'Pontuação & IGA' | 'Assinaturas PRO' | 'Health & Wearables' | 'Desafios e Power Lift' | 'Campeonatos' | 'Invictus Coins e Loja' | 'Antifraude & Auditoria' | 'Privacidade & LGPD';
}

const HEADER = 'Última atualização: 31 de agosto de 2026 | Versão: 4.0.0';

export const LEGAL_TERMS_OF_USE = `
TERMOS DE USO DA PLATAFORMA INVICTUS

${HEADER}

1. QUEM SOMOS E OBJETO
A plataforma INVICTUS é mantida por INVICTUS PERFORMANCE E SOLUÇÕES LTDA., CNPJ 67.770.822/0001-22, com sede na Rua Primeiro de Setembro, nº 70, Sala 301, Porto Alegre/RS. Estes Termos regulam o aplicativo, o site e os serviços digitais associados.

2. ELEGIBILIDADE E CONTA
O serviço é destinado a pessoas com 18 anos ou mais. O usuário deve fornecer dados próprios, corretos e atualizados, proteger suas credenciais e manter uma única conta pessoal. É proibido compartilhar conta, usar identidade de terceiros, automatizar ações ou manipular rankings, recompensas e limites.

3. NATUREZA DO SERVIÇO E SAÚDE
O INVICTUS oferece planejamento e registro de treinos, métricas de desempenho e saúde, rankings, desafios, campeonatos, recursos de inteligência artificial e loja de produtos físicos. Não é dispositivo médico, não diagnostica doenças, não prescreve tratamento e não substitui médico, nutricionista ou profissional de educação física. O usuário deve interromper a atividade diante de sinal de risco e buscar atendimento adequado.

4. TREINOS E INTELIGÊNCIA ARTIFICIAL
Planos e sugestões automáticas são orientações gerais baseadas nos dados disponíveis e podem conter limitações. O usuário deve adaptar exercícios à própria condição, ambiente e equipamentos. Conteúdo enviado deve ser lícito, próprio ou usado com autorização.

5. IGA, RANKINGS E CONQUISTAS
O IGA representa consistência e desempenho a partir de atividades elegíveis. A mesma regra-base vale para usuários Free e Pro; assinatura não compra pontos ou vantagem. Atividades podem ficar em análise, ser parcialmente consideradas ou ser desconsideradas por falta de dado obrigatório, duplicidade ou risco de manipulação. Ranking não garante prêmio ou renda.

6. DESAFIOS E POWER LIFT
Desafios concedem reconhecimento, XP, conquistas e, quando indicado, Invictus Coins. Os desafios atuais não envolvem aposta, taxa de entrada entre usuários, divisão de dinheiro ou prêmio em espécie. No Power Lift, o vídeo deve ser próprio, contínuo e compatível com a regra da modalidade. A análise pode aprovar, reprovar ou encaminhar para revisão; peso sem evidência suficiente não é homologado.

7. CAMPEONATOS
O campeonato gratuito é uma experiência social entre amigos e comunidade, sem vínculo, patrocínio ou associação presumida com academias e sem premiação em dinheiro. As modalidades elegíveis são musculação e cardio.

O check-in presencial é opcional em treinos comuns. Quem optar por realizá-lo pode receber a pontuação e o progresso de missão exibidos no app. Durante participação ativa em campeonato que exija comprovação presencial, o check-in poderá ser obrigatório para que a atividade seja competitivamente elegível; essa exigência deve ser informada antes do início do treino.

Campeonatos pagos de musculação ou cardio permanecem EM BREVE. Sem edição publicada com organizador, datas, preço, critérios, premiação e regulamento específico aprovados, não haverá inscrição ou cobrança. Uma edição futura exigirá aceite separado do respectivo regulamento.

8. INVICTUS COINS
Coins são pontos promocionais internos, cumulativos e destinados a resgates elegíveis na Loja Invictus. Não são moeda, ativo financeiro, dinheiro eletrônico ou investimento; não têm cotação fixa em reais, não rendem juros e não podem ser sacados via PIX, transferidos ou convertidos em dinheiro. Créditos obtidos por erro, duplicidade ou fraude podem ser corrigidos com registro auditável.

9. LOJA E PRODUTOS FÍSICOS
A Loja pode oferecer compra em dinheiro, resgate em Coins ou combinação expressamente indicada. Preço, quantidade, frete, prazo, pagamento e disponibilidade devem aparecer antes da confirmação. Itens EM BREVE não podem ser comprados ou resgatados. Produtos de terceiros mantêm suas marcas e informações oficiais; o catálogo não cria alegação médica além do material aprovado.

10. FREE E PRO
O Free mantém as funções indicadas no app. O Pro libera apenas os recursos digitais descritos na oferta. Preço, período, renovação e eventual teste devem aparecer antes da compra. Assinatura não garante pontuação, Coins, produto, colocação ou participação em campeonato.

11. INTEGRIDADE E MODERAÇÃO
São proibidos GPS falso, veículo para simular atividade, mídia enganosa, adulteração de sensores, exploração de falhas, assédio, conteúdo ilegal e acesso a dados alheios. Podem ser aplicadas remoção da atividade, correção de pontos/Coins, limitação, suspensão ou encerramento da conta, com revisão quando cabível.

12. DISPONIBILIDADE E TERCEIROS
GPS, sensores, mapas, notificações, serviços de saúde, autenticação, pagamento, entrega e integrações dependem do aparelho, permissões, rede e provedores externos. O INVICTUS emprega esforços razoáveis, mas não garante operação ininterrupta ou recuperação de atividade não registrada ou sincronizada.

13. DIREITOS E CONTATO
Marca, software, modelos, textos e assets do INVICTUS são protegidos. O usuário mantém direitos sobre seu conteúdo e concede licença limitada para operar os recursos escolhidos. Alterações materiais serão apresentadas em nova versão. Contato: contato@invictusperformance.app.br. Aplicam-se as leis brasileiras e os direitos obrigatórios do consumidor e do titular de dados.
`;

export const LEGAL_PRIVACY_POLICY = `
POLÍTICA DE PRIVACIDADE E PROTEÇÃO DE DADOS

${HEADER}

1. CONTROLADOR
INVICTUS PERFORMANCE E SOLUÇÕES LTDA., CNPJ 67.770.822/0001-22. Canal de privacidade: contato@invictusperformance.app.br.

2. DADOS TRATADOS
Conforme os recursos usados, podemos tratar: cadastro e contato; CPF e nascimento quando necessários à segurança ou obrigação legal; foto e perfil; atividades, exercícios, cargas e evolução; frequência cardíaca, calorias, sono, HRV e métricas autorizadas; localização e rota durante atividade; fotos, vídeos e áudio enviados; identificadores do aparelho, sinais de integridade e acessos; assinatura; endereço e dados de pedidos; suporte e preferências.

3. FINALIDADES E BASES
Usamos dados para autenticar; registrar e mostrar atividades; criar planos e análises; calcular IGA, XP, conquistas e Coins; operar rankings, desafios, Power Lift e campeonatos; sincronizar provedores autorizados; combater fraude; processar assinatura, pedido e entrega; prestar suporte; cumprir obrigações; proteger usuários e melhorar segurança. As bases podem incluir contrato, consentimento, obrigação legal, exercício de direitos, prevenção à fraude e legítimo interesse avaliado.

4. PERMISSÕES SENSÍVEIS
O aceite geral não concede automaticamente acesso a HealthKit, Health Connect, localização, câmera, microfone, fotos ou notificações. A autorização é pedida no contexto do recurso e pode ser negada ou revogada no sistema operacional ou provedor.

Treinos comuns de musculação podem ser iniciados sem localização. A localização é solicitada para check-in presencial escolhido pelo usuário ou quando a participação ativa em campeonato exigir comprovação de presença. Negar a permissão fora dessas hipóteses não impede o registro do treino comum.

5. EXIBIÇÃO E COMPARTILHAMENTO
Nome público, foto, posição, IGA, conquistas e resultados podem aparecer em recursos sociais conforme a adesão. Rotas exatas, CPF, contato, saúde bruta, endereço e sinais internos antifraude não são publicados. Compartilhamos somente o necessário com operadores de hospedagem, autenticação, segurança/IA, mapas, notificações, assinatura, pagamento, logística, suporte e integrações escolhidas. Não vendemos dados pessoais nem usamos saúde para publicidade comportamental.

6. SEGURANÇA, TRANSFERÊNCIA E RETENÇÃO
Alguns operadores podem processar dados fora do Brasil, sob mecanismos adequados ao serviço. Usamos controles de acesso e auditoria compatíveis com a arquitetura, sem prometer invulnerabilidade. Dados ficam enquanto necessários à conta, às finalidades, à segurança e às obrigações legais; backups seguem ciclo técnico.

7. DIREITOS DO TITULAR
O titular pode solicitar confirmação e acesso; correção; informação sobre compartilhamento; revisão automatizada quando aplicável; portabilidade quando regulamentada; anonimização, bloqueio ou eliminação; revogação de consentimento; oposição e exclusão, observadas retenções legais. Podemos confirmar identidade antes de atender.

8. MENORES E ATUALIZAÇÕES
O serviço não é destinado a menores de 18 anos. Mudanças relevantes serão comunicadas e a versão vigente permanecerá em Perfil > Preferências.
`;

export const LEGAL_HEALTH_DATA_POLICY = `
POLÍTICA DE DADOS DE SAÚDE, ATIVIDADE E WEARABLES

${HEADER}

1. Dados de saúde e fitness são usados para métricas visíveis ao usuário, sincronização autorizada, indicadores de treino, recomendações e coerência da atividade. Não são usados para anúncios direcionados, venda de perfis ou decisão médica.

2. O app pode receber exercícios, passos, distância, calorias, frequência cardíaca, HRV, sono e outros tipos efetivamente autorizados no Apple Health/HealthKit, Health Connect, Strava ou provedor conectado. Solicitamos apenas o escopo necessário ao recurso apresentado.

3. O aceite dos Termos não concede acesso à saúde. A permissão é solicitada pelo sistema ou provedor e pode ser limitada ou revogada. Revogar interrompe novas leituras, mas a exclusão de dados já importados deve ser solicitada separadamente.

4. Histórico de saúde e elegibilidade competitiva são separados: uma atividade pode continuar no histórico e não pontuar por duplicidade ou regra antifraude.

5. VO₂ máx., calorias, recuperação e outros indicadores são estimativas não clínicas. Sensores podem conter atraso, lacuna ou imprecisão. Não tome decisão médica exclusivamente pelo app.

6. Dados brutos de saúde não são exibidos publicamente ou usados para marketing. Compartilhamento, retenção e direitos seguem a Política de Privacidade.
`;

export const LEGAL_ANTI_FRAUD_POLICY = `
POLÍTICA DE INTEGRIDADE, ANTIFRAUDE E REVISÃO

${HEADER}

1. O sistema busca condições equivalentes em IGA, rankings, desafios, campeonatos, Power Lift, conquistas e recompensas.

2. Conforme modalidade e permissões, podem ser analisados duração, distância, ritmo, GPS, precisão, aceleração, frequência cardíaca, origem, duplicidade, aparelho, presença, foto, vídeo, frames e comportamento incompatível. Ausência de sinal não prova fraude, mas pode impedir validação quando o dado for obrigatório.

3. Uma atividade pode ser aprovada, aprovada parcialmente, colocada em revisão ou bloqueada. Automação auxilia a decisão, sem afirmar certeza quando a evidência é insuficiente. Em falha técnica relevante, o fluxo competitivo não aprova por omissão.

4. No Power Lift, o vídeo deve ser próprio, contínuo e legível. Cortes, reuso, mídia sintética enganosa, cenário inconsistente, peso não verificável ou amplitude insuficiente podem causar revisão ou reprovação. A análise não certifica técnica segura.

5. Podem ocorrer remoção da sessão, correção de pontos/XP/Coins, ajuste de ranking, suspensão ou encerramento. O usuário pode pedir revisão pelo suporte e enviar arquivos originais. Detalhes que permitam contornar controles podem ser omitidos.
`;

export const LEGAL_PROMOTIONAL_RULES = `
REGRAS DE DESAFIOS, CAMPEONATOS, XP E INVICTUS COINS

${HEADER}

1. Os recursos atuais valorizam atividade validada. Não existe sorteio, aposta, odd, bolão, taxa entre amigos ou promessa de ganho financeiro. XP, níveis, medalhas, posição e Coins são gamificação.

2. Cada desafio informa objetivo, período, progresso e recompensa. Somente eventos confirmados pelo servidor atualizam progresso. Desafios privados não formam pote de dinheiro.

3. Power Lift exige vídeo e regras por movimento. O registro só entra no ranking após decisão válida; destaque público não é certificação profissional da execução.

4. O campeonato gratuito é social, opcional, sem prêmio em dinheiro e sem parceria, patrocínio ou vínculo comercial com academias. A academia informada pelo usuário pode ser usada apenas para formar o grupo competitivo. FREE e PRO usam o mesmo IGA e a assinatura não concede vantagem de pontuação.

4.0.1. Fora de campeonato ativo, check-in presencial é opcional e o treino comum não depende de academia cadastrada ou GPS. O check-in voluntário pode conceder pontuação própria e progresso em missões. Em campeonato ativo que exija presença, a ausência de check-in válido torna a atividade inelegível para a competição, sem transformar a assinatura PRO em vantagem.

4.1. A premiação padrão mensal do campeonato pode conceder 2.500 Coins ao 1º lugar, 1.500 ao 2º, 1.000 ao 3º e 50 pela conclusão válida do ciclo. Valores podem ser alterados antes do início de cada ciclo e devem aparecer no app. Coins continuam sem valor monetário.

4.2. O encerramento gera resultado provisório. O Top 3 passa por auditoria automática reforçada e pode ficar APPROVED, REVIEW ou REJECTED. O crédito ocorre somente após aprovação. Irregularidades podem alterar a classificação final válida.

5. Campeonatos pagos só poderão ser de musculação ou cardio. Permanecem EM BREVE. Antes de cobrança, deverão informar organizador, elegibilidade, datas, preço, cancelamento, critérios, auditoria, premiação e regulamento próprio. Este texto não cria direito a edição futura.

6. Coins podem ser concedidos por missões, trilha de consistência, campeonato ou campanha habilitada. A consistência mensal é acessível a FREE e PRO e representa o cumprimento da meta semanal válida, não a obrigação de treinar diariamente. Missões PRO criam caminhos adicionais, mas não alteram IGA ou ranking.

7. Os lançamentos são segregados por origem: missão base, consistência, missão PRO, conclusão de campeonato, pódio, promoção e ajuste administrativo. Premiação de pódio não integra eventual limite mensal de missões. A emissão pode respeitar orçamento global configurável e ser redimensionada conforme usuários e grupos ativos.

8. Coins são cumulativos durante a conta ativa e sujeitos a correção de erro ou fraude. Não têm valor monetário, não podem ser sacados, vendidos ou transferidos e só servem aos resgates disponíveis na Loja.
`;

export const LEGAL_ACCOUNT_DELETION_POLICY = `
POLÍTICA DE EXCLUSÃO DE CONTA E DADOS

${HEADER}

1. A exclusão pode ser solicitada pelo caminho disponível em Perfil > Segurança/Conta ou por contato@invictusperformance.app.br. Podemos confirmar identidade e titularidade.

2. A exclusão encerra o acesso e remove ou anonimiza, conforme aplicável, perfil, preferências, histórico, mídias e saúde que não precisem ser mantidos. Coins não são dinheiro e não geram pagamento ou conversão na exclusão.

3. Podem ser preservados, pelo prazo aplicável, registros necessários a obrigação legal, defesa de direitos, prevenção de fraude, segurança, pedidos e transações, com acesso restrito.

4. O pedido será tratado nos prazos legais e operacionais informados no atendimento. Backups deixam de ser usados e são eliminados conforme ciclo seguro, salvo obrigação de preservação.
`;

export const LEGAL_SUBSCRIPTIONS_POLICY = `
POLÍTICA DE ASSINATURA PRO E CANCELAMENTO

${HEADER}

1. O Pro libera os recursos digitais descritos na oferta. Benefícios, preço, periodicidade, teste, renovação e elegibilidade devem aparecer antes da compra. Não há benefício presumido.

2. Em aplicativos móveis, assinaturas digitais são processadas pelo sistema aplicável da Apple App Store ou Google Play. Produtos físicos da Loja são transações separadas.

3. Quando recorrente, renovação e cancelamento são mostrados antes da compra. O gerenciamento ocorre na conta da loja que processou a assinatura. Cancelar normalmente mantém acesso até o fim do período pago, conforme a loja.

4. Reembolsos de compra processada por Apple ou Google seguem seu canal e decisão, sem afastar direitos obrigatórios do consumidor.

5. Pro não compra IGA, posição, validação, Coins, produto, prêmio ou aprovação no Power Lift.
`;

export const LEGAL_DISCLAIMERS = `
AVISOS LEGAIS IMPORTANTES

${HEADER}

1. O INVICTUS não é dispositivo médico; indicadores são estimativas de fitness e bem-estar.
2. Exercício envolve risco. Respeite sua condição, orientação profissional e segurança do ambiente.
3. Ranking, XP, Coins e conquistas não garantem renda ou prêmio financeiro.
4. O campeonato gratuito e o perfil de academia não representam parceria, patrocínio ou vínculo com academias.
5. Apple, Google, Strava, Mapbox, wearables e marcas de produtos não patrocinam o INVICTUS, salvo anúncio expresso.
6. Marcas e embalagens pertencem aos titulares. Suplementos não substituem rótulo ou orientação profissional.
7. GPS, sensores, rede, bateria e terceiros podem falhar ou ser imprecisos.
8. Estes textos de produto exigem revisão jurídica profissional antes da publicação comercial definitiva.
`;

export const LEGAL_CONSENTS = `
CONSENTIMENTOS E PERMISSÕES CONTEXTUAIS

${HEADER}

O aceite geral não substitui autorizações específicas. Cada permissão deve ser pedida no uso e pode ser negada ou revogada.

1. SAÚDE: leitura dos tipos selecionados no HealthKit/Health Connect para recursos escolhidos.
2. LOCALIZAÇÃO: posição precisa durante atividade para rota, distância e integridade; segundo plano exige permissão própria.
3. CÂMERA, FOTOS, MICROFONE E VÍDEO: captura/seleção para perfil, atividade, Power Lift ou compartilhamento; evite terceiros sem autorização.
4. ANÁLISE AUTOMATIZADA: dados e mídias podem gerar recomendações, métricas e sinais antifraude, com revisão quando aplicável.
5. NOTIFICAÇÕES: envio das categorias habilitadas; atividade persistente depende do suporte e permissão do sistema.
6. SOCIAL: adesão opcional autoriza exibição dos campos informados, como nome público, foto, pontuação, posição e resultados.
`;

export const LEGAL_FAQ_100: FAQItem[] = [
  { id: 1, category: 'Geral', question: 'O que é o Invictus?', answer: 'Plataforma de treino, desempenho, saúde, gamificação e produtos físicos; não substitui profissionais.' },
  { id: 2, category: 'Geral', question: 'Quem pode usar?', answer: 'Pessoas com 18 anos ou mais, com dados próprios e aceite dos termos.' },
  { id: 3, category: 'Geral', question: 'Existe plano gratuito?', answer: 'Sim. Free e Pro são identificados no app; assinatura não altera a regra-base do IGA.' },
  { id: 4, category: 'Geral', question: 'A Invictus é associada à minha academia?', answer: 'Não. Academia é apenas contexto de perfil/localização, sem parceria presumida.' },
  { id: 5, category: 'Geral', question: 'A IA substitui profissional?', answer: 'Não. Sugestões são gerais e devem ser adaptadas com orientação adequada.' },
  { id: 6, category: 'Conta & Perfil', question: 'Posso ter duas contas?', answer: 'Não. Cada pessoa deve manter uma conta e usar dados próprios.' },
  { id: 7, category: 'Conta & Perfil', question: 'Como excluo a conta?', answer: 'Use o caminho no Perfil ou o suporte; a identidade poderá ser confirmada.' },
  { id: 8, category: 'Conta & Perfil', question: 'Excluir converte Coins em dinheiro?', answer: 'Não. Coins não possuem valor monetário.' },
  { id: 9, category: 'Pontuação & IGA', question: 'O que é IGA?', answer: 'Índice de consistência e desempenho baseado em atividades elegíveis e validadas.' },
  { id: 10, category: 'Pontuação & IGA', question: 'Pro aumenta meu IGA?', answer: 'Não. Assinatura não concede multiplicador ou vantagem.' },
  { id: 11, category: 'Pontuação & IGA', question: 'Todo treino entra no ranking?', answer: 'Não. Deve cumprir regras da modalidade e integridade.' },
  { id: 12, category: 'Pontuação & IGA', question: 'Ranking garante prêmio?', answer: 'Não. Recompensa só existe quando publicada em regra específica.' },
  { id: 13, category: 'Assinaturas PRO', question: 'O que o Pro libera?', answer: 'Somente recursos digitais mostrados na oferta vigente.' },
  { id: 14, category: 'Assinaturas PRO', question: 'Pro inclui loja ou campeonato?', answer: 'Não, salvo benefício expresso. Produtos e eventuais inscrições são separados.' },
  { id: 15, category: 'Assinaturas PRO', question: 'Como cancelo?', answer: 'Na conta Apple App Store ou Google Play usada na compra.' },
  { id: 16, category: 'Health & Wearables', question: 'O app acessa saúde sem permissão?', answer: 'Não. HealthKit e Health Connect exigem autorização contextual e granular.' },
  { id: 17, category: 'Health & Wearables', question: 'Posso revogar?', answer: 'Sim, no sistema ou provedor; isso interrompe novas leituras.' },
  { id: 18, category: 'Health & Wearables', question: 'VO₂ máx é diagnóstico?', answer: 'Não. É estimativa de fitness.' },
  { id: 19, category: 'Health & Wearables', question: 'Saúde é usada em anúncios?', answer: 'Não. Dados de saúde não são vendidos ou usados para publicidade comportamental.' },
  { id: 20, category: 'Desafios e Power Lift', question: 'Desafios envolvem dinheiro?', answer: 'Não. Podem conceder XP, conquistas e Coins.' },
  { id: 21, category: 'Desafios e Power Lift', question: 'O que é Power Lift?', answer: 'Desafio de força com vídeo e ranking por modalidade.' },
  { id: 22, category: 'Desafios e Power Lift', question: 'A IA sempre aprova ou reprova?', answer: 'Não. Evidência insuficiente pode gerar revisão.' },
  { id: 23, category: 'Campeonatos', question: 'Quais modalidades existirão?', answer: 'Musculação e cardio.' },
  { id: 24, category: 'Campeonatos', question: 'Como funciona o gratuito?', answer: 'Disputa social opcional entre amigos/comunidade, sem dinheiro e sem vínculo com academia.' },
  { id: 25, category: 'Campeonatos', question: 'Já existe campeonato pago?', answer: 'Não. As prévias permanecem EM BREVE, sem cobrança.' },
  { id: 26, category: 'Campeonatos', question: 'Quando poderá haver inscrição?', answer: 'Quando edição real publicar preço, datas, regras, cancelamento e eventual premiação.' },
  { id: 27, category: 'Invictus Coins e Loja', question: 'O que são Coins?', answer: 'Pontos internos cumulativos para resgates elegíveis na Loja.' },
  { id: 28, category: 'Invictus Coins e Loja', question: 'Posso sacar via PIX?', answer: 'Não. Coins não são dinheiro, não podem ser sacados, transferidos ou vendidos.' },
  { id: 29, category: 'Invictus Coins e Loja', question: 'Como ganho Coins?', answer: 'Em atividades e campanhas que indiquem essa recompensa.' },
  { id: 30, category: 'Invictus Coins e Loja', question: 'O que significa EM BREVE?', answer: 'O produto ainda não pode ser comprado ou resgatado.' },
  { id: 31, category: 'Invictus Coins e Loja', question: 'Coins têm cotação em reais?', answer: 'Não. Não existe conversão pública ou valor garantido.' },
  { id: 32, category: 'Invictus Coins e Loja', question: 'Como funciona frete?', answer: 'Valor e prazo aparecerão no checkout quando o item estiver habilitado.' },
  { id: 33, category: 'Antifraude & Auditoria', question: 'O que é analisado?', answer: 'Sinais pertinentes à modalidade: duração, GPS, sensores, origem, duplicidade, foto ou vídeo.' },
  { id: 34, category: 'Antifraude & Auditoria', question: 'Falta de sensor prova fraude?', answer: 'Não, mas pode impedir validação quando obrigatório.' },
  { id: 35, category: 'Antifraude & Auditoria', question: 'Posso recorrer?', answer: 'Sim. Solicite revisão e envie arquivos originais disponíveis.' },
  { id: 36, category: 'Privacidade & LGPD', question: 'Quais dados são públicos?', answer: 'Campos sociais necessários; CPF, saúde bruta, endereço e rota exata não são publicados.' },
  { id: 37, category: 'Privacidade & LGPD', question: 'O Invictus vende dados?', answer: 'Não.' },
  { id: 38, category: 'Privacidade & LGPD', question: 'Como acesso ou corrijo dados?', answer: 'Use a conta ou envie solicitação ao canal de privacidade.' },
  { id: 39, category: 'Privacidade & LGPD', question: 'Posso pedir revisão automatizada?', answer: 'Sim, quando aplicável e houver efeito relevante.' },
  { id: 40, category: 'Privacidade & LGPD', question: 'Onde leio a política?', answer: 'Em Perfil > Preferências > Política de Privacidade.' },
];
