# Plano — separar assinatura de competição

Modelo escolhido: **manter o Plano Performance e criar a inscrição de temporada como
transação separada**, cobrada fora das lojas.

---

## Por que a separação é obrigatória

Não é preferência de arquitetura. As duas regras se aplicam ao mesmo tempo e
apontam em direções opostas:

| O que | Canal | Regra |
|---|---|---|
| Plano Performance (IA, saúde, relatórios, integrações) | IAP das lojas | IAP **obrigatório** para assinatura digital |
| Inscrição na temporada | PIX / Asaas | IAP **proibido** para entrada em competição de dinheiro real |
| Pagamento do prêmio | PIX / Asaas | Mesma razão |

Se a assinatura der direito a competir, ela vira entrada de concurso vendida por
IAP — que é motivo de rejeição. Por isso o Performance precisa perder qualquer
vínculo com a disputa.

---

## O que muda para quem usa o app

**O Plano Performance continua existindo e continua pago pela loja.** Ele vende
IA, relatórios de saúde, integrações e histórico. O que ele deixa de dar é o
direito de concorrer a prêmio.

**Aparece a inscrição da temporada.** Uma tela nova, com o regulamento, o valor
da inscrição e o pagamento por PIX. Aberta a qualquer pessoa — assinante ou não.

**O ranking passa a mostrar só quem se inscreveu.** Hoje ele lista assinantes
Performance. Passa a listar inscritos na temporada.

**O card de temporada mostra o estado real:** inscrições abertas ou fechadas,
quanto já acumulou no pote, e se você está dentro ou não.

**Uma tela de regulamento** com critérios de pontuação, como é validado, quem
pode participar, restrição de idade e o aviso de que a Apple não patrocina.

---

## O que muda no código

### Backend — o que não existe e precisa ser criado

**Cobrança de inscrição via Asaas.** Hoje a integração só faz transferência de
saída. Emitir cobrança PIX é caminho novo: endpoint que cria a cobrança e
devolve o QR code / copia-e-cola.

**Webhook de pagamento recebido.** O webhook atual (`asaas-webhook.ts`) só trata
eventos `TRANSFER_*`. Precisa passar a tratar `PAYMENT_RECEIVED` e
`PAYMENT_CONFIRMED` para confirmar a inscrição.

### Backend — o que muda no que já existe

**`season_registrations` vira o registro de inscrição paga.** Hoje é criado no
pagamento da assinatura. Passa a ser criado quando a inscrição é confirmada,
com a academia congelada naquele momento.

**Elegibilidade deixa de olhar assinatura.** Em `getSeasonParticipantsByGym`, o
filtro `subscriptionTier === 'performance'` sai. Passa a valer: tem registro de
inscrição nesta temporada.

**O pote deixa de vir da assinatura.** `computeSeasonRevenueByGym` hoje soma
`payment_orders`, que são assinaturas. Passa a somar as inscrições daquela
temporada, por academia.

**`congelarAcademiasDaTemporada` fica obsoleta e sai.** Ela existia para
inscrever todo assinante ativo no início da temporada. Com inscrição paga, o
registro nasce no ato do pagamento — não há mais o que congelar em massa.

**Congelamento do pote na abertura.** Quando a temporada abre, as inscrições
fecham e o valor do pote é gravado. A partir daí ele não muda mais durante a
disputa.

### Frontend

- Tela de inscrição com regulamento e pagamento PIX
- Ranking filtrando por inscritos
- Card de temporada com estado das inscrições e o pote
- Tela de regulamento
- Remover da interface qualquer texto que ligue assinatura a prêmio

---

## Decisões tomadas

| Item | Decisão |
|---|---|
| Percentual para o pote | **55% das inscrições** |
| Piso garantido | **Não haverá** — o prêmio é proporcional aos inscritos |
| Preço do plano | **R$ 29,90** (era R$ 49,90) |
| Nomenclatura | **Gratuito** e **Pro** (eram Open e Performance) |
| Identificadores internos | `free` e `pro`; produto de loja `invictus_pro` |

A renomeação acontece **depois** da separação entre assinatura e competição,
porque essa separação apaga boa parte das referências a `performance` — todos
os filtros que hoje decidem quem compete deixam de existir. Renomear antes
seria renomear código que vai ser deletado.

Com cerca de 6 usuários e nenhum assinante, a migração de dados é trivial. O
único atrito real é que ID de produto de assinatura não se renomeia nas lojas:
cria-se `invictus_pro` e para-se de oferecer o antigo.

## O que ainda preciso de você

**Valor da inscrição.** Quanto custa entrar numa temporada.

**Conta Asaas.** Confirmar que a chave de API tem permissão para emitir
cobranças, não só transferências. É configuração no painel deles.

**Idade mínima.** 18 anos é o padrão para competição com prêmio em dinheiro.
Precisa de checagem no cadastro e de bloqueio para menores.

---

## Sequência sugerida

Isso é grande demais para um commit só. Proponho quatro etapas, cada uma
testável antes da seguinte:

1. **Cobrança e webhook.** Emitir cobrança PIX e confirmar pagamento. Nada de
   competição ainda — só provar que o dinheiro entra e é confirmado.
2. **Inscrição e elegibilidade.** O registro passa a nascer da inscrição paga,
   e o ranking passa a filtrar por ele.
3. **Pote e premiação.** O cálculo passa a usar inscrições, com congelamento na
   abertura da temporada.
4. **Telas.** Inscrição, regulamento, card de temporada e limpeza dos textos
   que ligam assinatura a prêmio.

---

## O que eu não consigo garantir

**Nada disso roda contra dados reais aqui.** Verificação de tipos passa, mas é
código que movimenta dinheiro. A etapa 1 precisa de teste com valor baixo, de
verdade, antes de seguir.

**A integração de cobrança é nova.** Saque já foi testado; receber não.

**A revisão das lojas é o teste real.** A estrutura segue o que a regra diz e
tem precedente, mas quem decide é o analista. Vale a consulta jurídica antes de
submeter, com este documento em mãos.
