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

## Telefone / SMS — Firebase Authentication

Twilio não faz mais parte do fluxo.

No Firebase Console:

1. abrir **Authentication > Sign-in method**;
2. habilitar o provedor **Phone**;
3. manter os domínios usados pelo app/web em **Authorized domains**;
4. manter faturamento habilitado para uso real de Phone Auth;
5. não desabilitar a verificação antiabuso/reCAPTCHA em produção.

O app usa `PhoneAuthProvider` + `RecaptchaVerifier` para enviar o SMS. Depois que o código é confirmado, o número fica vinculado ao próprio usuário do Firebase Authentication. O backend usa o `UserRecord.phoneNumber` do Firebase Admin como fonte de verdade; não aceita `phoneVerified=true` vindo do cliente.

Nenhuma variável `TWILIO_*` é necessária na Vercel.

## CPF / Receita Federal

A aplicação consulta a API oficial contratada do Serpro/RFB. Variáveis necessárias:

- `SERPRO_CPF_CONSUMER_KEY`
- `SERPRO_CPF_CONSUMER_SECRET`
- `SERPRO_CPF_QUERY_URL_TEMPLATE`
- `SERPRO_CPF_TOKEN_URL` (opcional; se ausente usa o endpoint padrão de token do gateway Serpro)

`SERPRO_CPF_QUERY_URL_TEMPLATE` deve conter `{cpf}` e `{birthDate}` e apontar para a URL contratada da versão vigente da Consulta CPF.

O CPF só recebe `cpfVerified=true` quando:

1. CPF e data de nascimento conferem com a resposta oficial;
2. a situação cadastral retornada é `REGULAR` (o código oficial `0`, quando retornado, é normalizado para `REGULAR`).

A aplicação não grava a resposta bruta da Receita; persiste apenas estado mínimo de auditoria (provedor, situação e datas).

## Saque PIX

A selfie não participa do saque.

Antes do saque, o servidor exige simultaneamente:

- e-mail confirmado pelo Firebase;
- telefone vinculado e confirmado no Firebase Authentication;
- CPF confirmado via Serpro/RFB e com situação REGULAR.

Cada saque exige uma **nova reautenticação por telefone**. O Firebase envia o SMS e valida o código no cliente. Após a confirmação, o app força a renovação do ID token e envia a solicitação de saque.

O servidor revalida o ID token e só aceita a operação quando:

- o token pertence ao mesmo UID;
- `firebase.sign_in_provider` (ou segundo fator) comprova autenticação por telefone;
- `auth_time` tem no máximo 5 minutos;
- o `phone_number` do token é exatamente o telefone vinculado à conta.

O código SMS nunca é enviado ao backend Invictus e nunca é salvo no Firestore. A reserva financeira continua server-authoritative e idempotente no `WithdrawalEngine`.

## Custo operacional

O Phone Auth é cobrado pelo Google/Firebase por SMS enviado conforme a tabela vigente do Identity Platform. Não existe custo Twilio adicional. O Serpro continua sendo cobrado conforme o contrato da Consulta CPF; a aplicação foi desenhada para confirmar o CPF na verificação de identidade, não em cada saque.
