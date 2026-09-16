# Checkout Asaas — Campeonatos pagos Invictus

## Objetivo

Estrutura para inscrições avulsas de R$ 29,90 nos campeonatos de Musculação e Cardio. O pagamento usa Checkout hospedado do Asaas, fora da WebView do app, e a inscrição só é ativada quando o backend recebe confirmação financeira autenticada por webhook.

O fluxo permanece **fail-closed**: publicar a aplicação não abre inscrições nem cria cobrança enquanto a edição real não tiver calendário, data de homologação, premiação e parâmetros competitivos válidos. A entrega da premiação também é server-side, idempotente e isolada por edição.

## Identidade da edição

`championshipId` identifica a modalidade/produto estável, por exemplo `invictus_cardio_v1`. Cada edição publicada recebe também um `editionId` imutável derivado do digest de sua configuração material: calendário, data de homologação, premiação, preço e perfil competitivo.

No primeiro checkout da edição, o backend persiste um snapshot em `championship_editions` e trava a edição ativa em `championship_edition_locks`. Depois desse ponto, **não altere as variáveis materiais da edição** até o settlement ficar `FINALIZED`. Se a configuração mudar durante uma edição ativa, checkout/cron devem falhar fechado e exigir correção operacional em vez de misturar duas edições.

Uma nova edição da mesma modalidade pode reutilizar o mesmo `championshipId`; inscrições, scores, settlement, resultados e awards são isolados pelo novo `editionId`.

## Fluxo iOS

1. Atleta abre o campeonato no app.
2. Visualiza preço, calendário, data de homologação, premiação, organizador, regulamento, antifraude e aviso da Apple.
3. Aceita o regulamento da edição e a ciência competitiva sobre frequência cardíaca.
4. Confirma presença/identidade por selfie.
5. Backend trava o snapshot da edição e cria um Checkout Asaas `DETACHED`, com PIX e cartão de crédito.
6. App abre a URL segura do Checkout via `@capacitor/browser`.
7. Asaas retorna o navegador para `/championship-checkout-return.html`.
8. Essa página chama `invictus://championship-checkout?...` e o app volta para a tela de status.
9. O retorno do navegador **não** ativa a inscrição.
10. Somente `CHECKOUT_PAID` (ou evento financeiro compatível) recebido no webhook ativa `paymentStatus=PAID`.
11. Depois da competição, o cron só homologa a edição travada, congela o ranking e credita os prêmios elegíveis na carteira sacável.

## Android / site

O app Android não expõe botão para abrir o Asaas. Ele exibe regras e status. O mesmo backend aceita `checkoutSurface=web`, para que o site oficial possa usar a mesma conta, aceite, presença e confirmação financeira futuramente.

## Configuração Asaas e cron

Variáveis obrigatórias em produção:

```text
ASAAS_ENVIRONMENT=production
ASAAS_API_KEY=<chave de produção>
ASAAS_WEBHOOK_TOKEN=<token forte exclusivo do webhook de pagamentos>
ASAAS_AUTHORIZATION_TOKEN=<token forte exclusivo do mecanismo de autorização de saques>
CRON_SECRET=<segredo forte do cron de homologação>
PUBLIC_APP_URL=https://invictusperformance.app.br
```

Em sandbox, use:

```text
ASAAS_ENVIRONMENT=sandbox
```

O cliente HTTP escolhe `https://api-sandbox.asaas.com/v3` no sandbox e `https://api.asaas.com/v3` em produção. Em produção, uma transferência PIX de saque não é iniciada se `ASAAS_AUTHORIZATION_TOKEN` estiver ausente.

### Webhook de pagamentos

```text
POST https://invictusperformance.app.br/api/championships/webhook-asaas
```

Configure no Asaas o mesmo `ASAAS_WEBHOOK_TOKEN` enviado no header `asaas-access-token`.

Eventos de Checkout tratados:

```text
CHECKOUT_CREATED       (recebido/ignorado)
CHECKOUT_PAID          (ativa inscrição)
CHECKOUT_CANCELED      (encerra checkout pendente)
CHECKOUT_EXPIRED       (encerra checkout pendente)
```

Eventos financeiros relevantes incluem:

```text
PAYMENT_RECEIVED
PAYMENT_CONFIRMED
PAYMENT_REFUNDED
PAYMENT_PARTIALLY_REFUNDED
PAYMENT_REFUND_IN_PROGRESS
PAYMENT_CHARGEBACK_REQUESTED
PAYMENT_CHARGEBACK_DISPUTE
PAYMENT_AWAITING_CHARGEBACK_REVERSAL
```

Reembolso, chargeback ou conciliação podem tornar o finalista inelegível e bloquear saque quando já existir prêmio creditado da mesma edição.

### Autorização de saque

Configure no Asaas o mecanismo de segurança de autorização de transferências apontando para:

```text
POST https://invictusperformance.app.br/api/payments/asaas-authorize-withdrawal
```

O token enviado pelo Asaas no header `asaas-access-token` deve ser exatamente o `ASAAS_AUTHORIZATION_TOKEN`. A autorização é fail-closed e recusa transferências sem vínculo interno, valor divergente, conta inativa, estado inesperado ou prêmio de campeonato em disputa financeira.

## Dados obrigatórios da edição antes de abrir inscrições

Global:

```text
PAID_CHAMPIONSHIP_REGISTRATION_ENABLED=true
```

Musculação:

```text
CHAMPIONSHIP_STRENGTH_EDITION=<nome da edição>
CHAMPIONSHIP_STRENGTH_REGISTRATION_OPENS_AT=<ISO-8601>
CHAMPIONSHIP_STRENGTH_REGISTRATION_CLOSES_AT=<ISO-8601>
CHAMPIONSHIP_STRENGTH_START_AT=<ISO-8601>
CHAMPIONSHIP_STRENGTH_END_AT=<ISO-8601>
CHAMPIONSHIP_STRENGTH_SETTLEMENT_AT=<ISO-8601 posterior ao END_AT>
CHAMPIONSHIP_STRENGTH_PRIZES_JSON=<JSON>
```

Cardio:

```text
CHAMPIONSHIP_CARDIO_EDITION=<nome da edição>
CHAMPIONSHIP_CARDIO_REGISTRATION_OPENS_AT=<ISO-8601>
CHAMPIONSHIP_CARDIO_REGISTRATION_CLOSES_AT=<ISO-8601>
CHAMPIONSHIP_CARDIO_START_AT=<ISO-8601>
CHAMPIONSHIP_CARDIO_END_AT=<ISO-8601>
CHAMPIONSHIP_CARDIO_SETTLEMENT_AT=<ISO-8601 posterior ao END_AT>
CHAMPIONSHIP_CARDIO_PRIZES_JSON=<JSON>
CHAMPIONSHIP_CARDIO_ALLOWED_TYPES=running,walking
```

`CHAMPIONSHIP_CARDIO_ALLOWED_TYPES` deve conter somente as modalidades efetivamente autorizadas pelo regulamento da edição. Não deixe vazio.

### Exemplo de premiação

Os números abaixo são somente exemplo de configuração:

```json
[
  { "rank": 1, "amount": 1000, "label": "1º lugar" },
  { "rank": 2, "amount": 500, "label": "2º lugar" }
]
```

As posições precisam ser únicas e contínuas a partir do 1º lugar. A aplicação não abre inscrições com premiação vazia ou inválida.

## Homologação e premiação

O cron protegido executa diariamente `/api/gym-championship-payout-cron`. Para o campeonato pago, ele só processa a edição travada e já vencida em `SETTLEMENT_AT`.

Antes do primeiro crédito o backend congela um snapshot `LOCKED` com ranking, premiação e digest da edição. A homologação bloqueia quando existir atividade competitiva ainda em análise, divergência entre score e entrada competitiva, conciliação financeira, empate técnico em posição premiada ou mudança da configuração publicada.

O ranking final usa, nesta ordem: pontuação total, número de atividades válidas, minutos válidos e instante em que a pontuação final foi atingida. Finalistas que perderem elegibilidade financeira/da conta no payout são persistidos em `ineligibleFinalists`; a posição premiada avança para o próximo finalista elegível. O prêmio em reais é creditado em `wallets.redeemableBalance` com IDs determinísticos por edição, atleta, posição e regulamento.

## Checklist de ativação

Antes de definir `PAID_CHAMPIONSHIP_REGISTRATION_ENABLED=true`:

- definir datas de inscrição, competição e `SETTLEMENT_AT`;
- publicar valores e posições premiadas;
- definir modalidades elegíveis do Cardio;
- revisar regulamento exibido no app;
- confirmar dados do organizador e canal de suporte;
- configurar `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_AUTHORIZATION_TOKEN` e `CRON_SECRET`;
- configurar no Asaas o webhook de pagamentos e o mecanismo de autorização de transferências;
- testar criação de Checkout em sandbox;
- confirmar retorno HTTPS → `invictus://championship-checkout` em iPhone real;
- confirmar que success URL sem webhook não ativa inscrição;
- confirmar `CHECKOUT_PAID` idempotente;
- testar cancelamento, expiração, reembolso, reembolso parcial e chargeback;
- testar chargeback após prêmio e confirmar bloqueio de saque;
- testar conta sem CPF e conta inativa;
- testar inscrição histórica e nova edição da mesma modalidade;
- confirmar que alterar configuração após o primeiro checkout é bloqueado até `FINALIZED`;
- testar settlement com retry/crash e confirmar ausência de prêmio duplicado;
- testar finalista inelegível e promoção do próximo colocado;
- homologar câmera/selfie em aparelho físico;
- revisar App Review Notes antes do envio à Apple.

## Processo para a edição seguinte

1. Aguarde a edição anterior ficar `FINALIZED`.
2. Altere as variáveis da nova edição: nome, calendário, `SETTLEMENT_AT`, premiação e modalidades elegíveis.
3. Faça deploy e confira o novo `editionId`/regulamento no catálogo antes de abrir inscrições.
4. Só então habilite/abra a janela comercial da nova edição.
5. O primeiro checkout persistirá e travará o novo snapshot da edição.

## Princípios de segurança

- A API key do Asaas nunca vai para o cliente.
- `userId` vem do token Firebase verificado, não do body.
- preço, `editionId`, regulamento e premiação vêm do servidor.
- callback do navegador não é autoridade de pagamento.
- inscrição paga é persistida no Firestore e confirmada pelo servidor.
- score, ranking e settlement são isolados por edição.
- atividade competitiva continua sujeita ao pipeline de integridade e às regras congeladas da edição.
- payout e saque são idempotentes/fail-closed; inconsistência financeira exige conciliação em vez de aprovação automática.
