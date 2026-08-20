# Checklist — Publicar o INVICTUS no TestFlight (iPhone)

Este documento lista **o que só você pode fazer**, porque exige login na sua conta
Apple. O workflow de build (`codemagic.yaml` → `ios-testflight`) já está pronto
no repositório.

> **Nunca me envie o arquivo .p8, senhas ou códigos de verificação.** Todas as
> credenciais devem ser coladas diretamente no Codemagic ou no site da Apple.

---

## 1. Criar o App ID (Apple Developer)

Acesse <https://developer.apple.com/account/resources/identifiers/list>

1. Clique em **+** (Identifiers)
2. Escolha **App IDs** → **App**
3. Preencha:
   - **Description:** INVICTUS
   - **Bundle ID:** selecione **Explicit** e digite exatamente:
     ```
     com.desafiosemdesculpa.app
     ```
4. Na lista de **Capabilities**, marque:
   - [x] **HealthKit**
   - [x] **Push Notifications**
5. Clique em **Continue** → **Register**

> Se você pular as capabilities, o build falha na etapa de assinatura, porque o
> app declara HealthKit e push nos entitlements.

---

## 2. Criar o app no App Store Connect

Acesse <https://appstoreconnect.apple.com/apps>

1. Clique em **+** → **New App**
2. Preencha:
   - **Platforms:** iOS
   - **Name:** INVICTUS
   - **Primary Language:** Portuguese (Brazil)
   - **Bundle ID:** com.desafiosemdesculpa.app
   - **SKU:** `invictus-performance-001` (qualquer texto único, uso interno)
   - **User Access:** Full Access
3. **Create**

> **Atenção:** o nome do app precisa ser único em toda a App Store. Se
> "INVICTUS" já estiver em uso, a Apple vai recusar — nesse caso use algo como
> "INVICTUS Performance" e me avise, porque isso não afeta o build.

---

## 3. Gerar a chave de API (App Store Connect API Key)

Acesse <https://appstoreconnect.apple.com/access/integrations/api>

1. Aba **Team Keys** → clique em **+**
2. **Name:** Codemagic CI
3. **Access:** selecione **App Manager**
4. **Generate**
5. Baixe o arquivo **.p8**

> ⚠️ O arquivo .p8 só pode ser baixado **uma única vez**. Guarde-o em local
> seguro. Se perder, é preciso revogar e gerar outro.

Anote também, da mesma tela:
- **Issuer ID** (fica no topo da página)
- **Key ID** (na linha da chave criada)

---

## 4. Cadastrar a chave no Codemagic

Acesse <https://codemagic.io/teams> → sua equipe → **Integrations** →
**App Store Connect** → **Add key**

Preencha:

| Campo | Valor |
|---|---|
| **Name** | `INVICTUS_ASC_KEY` |
| **Issuer ID** | o do passo 3 |
| **Key ID** | o do passo 3 |
| **Private key** | envie o arquivo .p8 |

> O **Name** precisa ser exatamente `INVICTUS_ASC_KEY`. É esse nome que o
> `codemagic.yaml` procura na linha `app_store_connect: INVICTUS_ASC_KEY`.
> Qualquer diferença (inclusive maiúsculas) faz o build falhar.

---

## 5. Rodar o build

No Codemagic, abra o projeto **INVICTUS-PERFORMANCE-APP** → **Start new build** →
selecione o workflow **iOS TestFlight (INVICTUS)** → **Start new build**.

O build leva aproximadamente 15–25 minutos. Ao final, o `.ipa` sobe sozinho
para o TestFlight.

---

## 6. Instalar no iPhone

1. No App Store Connect → seu app → aba **TestFlight**
2. Em **Internal Testing**, crie um grupo e adicione o seu e-mail
   (`samuelfsc89@gmail.com`)
3. No iPhone, instale o app **TestFlight** pela App Store
4. Entre com o mesmo Apple ID e instale o INVICTUS

> Teste interno **não passa por revisão da Apple** — o build fica disponível
> poucos minutos após o processamento.

---

## O que testar primeiro no iPhone

Estes são os pontos que só dá para validar de verdade em um iPhone real:

- [ ] App abre sem tela branca e o login funciona
- [ ] Pedido de permissão de **localização** aparece ao iniciar um cardio
- [ ] Pedido de permissão de **sensores de movimento** aparece (crítico: sem
      isso o antifraude reprova a atividade)
- [ ] O GPS registra distância durante uma caminhada real
- [ ] A tela de detalhe estilo Strava abre ao finalizar a atividade
- [ ] O mapa da rota aparece
- [ ] Safe areas: nada cortado no topo (notch/Dynamic Island) nem embaixo
- [ ] O teclado não cobre os campos de texto
- [ ] App volta ao estado correto depois de minimizar e reabrir

---

## Pendências conhecidas (não bloqueiam o teste)

- **Notificações push:** o app registra token FCM, mas no iOS o
  `@capacitor/push-notifications` devolve um token **APNs**. Para o push
  funcionar de verdade no iPhone ainda é preciso subir a chave APNs no Firebase
  Console e ajustar o registro do token. Não impede o app de rodar.
- **Compras no app:** o fluxo de assinatura via loja ainda não foi validado no
  iOS. Ver tarefa #218 (nova arquitetura comercial).
