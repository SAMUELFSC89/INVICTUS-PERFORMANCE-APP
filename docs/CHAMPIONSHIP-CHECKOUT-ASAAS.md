# Checkout Asaas — Campeonatos pagos Invictus

## Objetivo

Estrutura para inscrições avulsas de R$ 29,90 nos campeonatos de Musculação e Cardio. O pagamento usa Checkout hospedado do Asaas, fora da WebView do app, e a inscrição só é ativada quando o backend recebe confirmação financeira autenticada por webhook.

O código permanece **fail-closed** por padrão: publicar a aplicação não abre inscrições nem cria cobrança enquanto a edição real não tiver calendário, premiação e parâmetros competitivos configurados.

## Fluxo iOS

1. Atleta abre o campeonato no app.
2. Visualiza preço, calendário, premiação, organizador, regulamento, antifraude e aviso da Apple.
3. Aceita o regulamento da edição e a ciência competitiva sobre frequência cardíaca.
4. Confirma presença/identidade por selfie.
5. Backend cria um Checkout Asaas `DETACHED`, com PIX e cartão de crédito.
6. App abre a URL segura do Checkout via `@capacitor/browser`.
7. Asaas retorna o navegador para `/championship-checkout-return.html`.
8. Essa página chama `invictus://championship-checkout?...` e o app volta para a tela de status.
9. O retorno do navegador **não** ativa a inscrição.
10. Somente `CHECKOUT_PAID` (ou evento financeiro compatível) recebido no webhook ativa `paymentStatus=PAID`.

## Android / site

O app Android não expõe botão para abrir o Asaas. Ele exibe regras e status. O mesmo backend aceita `checkoutSurface=web`, para que o site oficial possa usar a mesma conta, aceite, presença e confirmação financeira futuramente.

## Configuração Asaas

Variáveis obrigatórias em produção:

```text
ASAAS_ENVIRONMENT=production
ASAAS_API_KEY=<chave de produção>
ASAAS_WEBHOOK_TOKEN=<token forte exclusivo do webhook>
PUBLIC_APP_URL=https://invictusperformance.app.br
```

Em sandbox, use:

```text
ASAAS_ENVIRONMENT=sandbox
```

O cliente HTTP escolhe `https://api-sandbox.asaas.com/v3` no sandbox e `https://api.asaas.com/v3` em produção.

### Endpoint de webhook

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

Eventos financeiros mantidos para compatibilidade/reembolso:

```text
PAYMENT_RECEIVED
PAYMENT_CONFIRMED
PAYMENT_REFUNDED
PAYMENT_CHARGEBACK_REQUESTED
```

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
CHAMPIONSHIP_STRENGTH_PRIZES_JSON=<JSON>
```

Cardio:

```text
CHAMPIONSHIP_CARDIO_EDITION=<nome da edição>
CHAMPIONSHIP_CARDIO_REGISTRATION_OPENS_AT=<ISO-8601>
CHAMPIONSHIP_CARDIO_REGISTRATION_CLOSES_AT=<ISO-8601>
CHAMPIONSHIP_CARDIO_START_AT=<ISO-8601>
CHAMPIONSHIP_CARDIO_END_AT=<ISO-8601>
CHAMPIONSHIP_CARDIO_PRIZES_JSON=<JSON>
CHAMPIONSHIP_CARDIO_ALLOWED_TYPES=running,walking
```

`CHAMPIONSHIP_CARDIO_ALLOWED_TYPES` deve conter somente as modalidades efetivamente autorizadas pelo regulamento da edição. Não deixe vazio.

### Exemplo de formato da premiação

Os números abaixo são **somente exemplo de configuração**, não valores aprovados para uma edição real:

```json
[
  { "rank": 1, "amount": 1000, "label": "1º lugar" },
  { "rank": 2, "amount": 500, "label": "2º lugar" }
]
```

A aplicação não abre inscrição quando a premiação está vazia.

## Checklist de ativação

Antes de definir `PAID_CHAMPIONSHIP_REGISTRATION_ENABLED=true`:

- definir datas de inscrição e competição;
- publicar valores e posições premiadas;
- definir modalidades elegíveis do Cardio;
- revisar regulamento exibido no app;
- confirmar dados do organizador e canal de suporte;
- configurar chave Asaas de produção e webhook;
- testar criação de Checkout em sandbox;
- confirmar retorno HTTPS → `invictus://championship-checkout` em iPhone real;
- confirmar que success URL sem webhook não ativa inscrição;
- confirmar `CHECKOUT_PAID` idempotente;
- testar cancelamento, expiração, reembolso e chargeback;
- testar conta sem CPF;
- testar usuário já inscrito;
- testar atualização de versão/hash do regulamento;
- homologar câmera/selfie em aparelho físico;
- revisar App Review Notes antes do envio à Apple.

## Princípios de segurança

- A API key do Asaas nunca vai para o cliente.
- `userId` vem do token Firebase verificado, não do body.
- preço e versão do regulamento vêm do catálogo servidor-autoritativo.
- callback do navegador não é autoridade de pagamento.
- inscrição paga é persistida no Firestore e confirmada pelo servidor.
- deep link de retorno usa allowlist de campeonato/status.
- atividade competitiva continua sujeita ao pipeline de integridade e às regras congeladas da edição.
