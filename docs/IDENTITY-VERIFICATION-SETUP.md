# Configuração de verificação de identidade

Este fluxo separa dados preenchidos de dados realmente verificados.

## E-mail

A aplicação usa Firebase Authentication como fonte de verdade (`emailVerified`).

Para a experiência aparecer com a identidade Invictus, configurar no Firebase Console:

- template de verificação de e-mail com nome Invictus;
- domínio de ação autorizado `invictusperformance.app.br`;
- domínio/remetente personalizado, quando disponível no projeto;
- SPF/DKIM/DNS exigidos pelo provedor de e-mail escolhido.

A aplicação nunca aceita um booleano enviado pelo cliente como prova de e-mail verificado.

## Telefone / SMS

O backend usa Twilio Verify. Variáveis necessárias:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_VERIFY_SERVICE_SID`
- `TWILIO_VERIFY_FRIENDLY_NAME=Invictus` (opcional; padrão `Invictus`)

O texto amigável usa Invictus. A exibição do remetente/Sender ID no aparelho depende das regras e do registro das operadoras/provedor no Brasil e deve ser configurada na conta Twilio.

Ao confirmar o telefone, a aplicação grava apenas o telefone da conta e um hash para atrelar a verificação ao número exato. Se o número mudar, a confirmação deixa de ser válida.

## CPF / Receita Federal

A aplicação consulta a API oficial contratada do Serpro/RFB. Variáveis necessárias:

- `SERPRO_CPF_CONSUMER_KEY`
- `SERPRO_CPF_CONSUMER_SECRET`
- `SERPRO_CPF_QUERY_URL_TEMPLATE`
- `SERPRO_CPF_TOKEN_URL` (opcional)

`SERPRO_CPF_QUERY_URL_TEMPLATE` deve conter `{cpf}` e `{birthDate}` e apontar para a URL contratada da versão vigente da Consulta CPF.

O CPF só recebe `cpfVerified=true` quando:

1. CPF e data de nascimento conferem com a resposta oficial;
2. a situação cadastral retornada é `REGULAR`.

A aplicação não grava a resposta bruta da Receita; persiste apenas estado mínimo de auditoria (provedor, situação e datas).

## Saque PIX

A selfie não participa do saque.

Antes do saque, o servidor exige simultaneamente:

- e-mail confirmado pelo Firebase;
- telefone confirmado e ainda igual ao número que recebeu o OTP;
- CPF confirmado via Serpro/RFB e com situação REGULAR.

Cada solicitação de saque gera um OTP SMS novo. O desafio expira, possui limite de tentativas e é vinculado ao usuário, telefone e payload do saque armazenado no servidor. O valor/chave PIX não podem ser trocados pelo cliente depois do envio do SMS.
