# Relatório da execução autônoma — Invictus Performance

Período: madrugada de 27/08/2026 (a partir de "vou dormir").
Todos os commits são **locais**. Nada foi publicado, nada foi apagado, nenhum segredo foi tocado.

---

## Resumo executivo

Foram fechadas 14 tarefas: os 8 itens P0 de funções quebradas, 4 itens P2 de ajuste visual e 2 blocos de integridade competitiva (bypass do antifraude e deduplicação entre fontes).

Duas coisas merecem sua atenção antes de qualquer deploy, e estão detalhadas no final: **nenhuma validação visual no Chrome foi possível neste ambiente**, e **duas mudanças alteram quem pontua** (o teto de 90 min por sessão e a dedup Invictus+Strava).

---

## DONE — o que foi entregue

| # | Item | Commit |
|---|---|---|
| 1 | Alterar academia / GPS voltou a funcionar | `761ccdc` |
| 2 | Home → Musculação/Cardio sem etapa intermediária | `761ccdc` |
| 3 | Fundos pretos removidos (Perfil, Alterar Academia, Ranking) | `761ccdc` |
| 4 | Sino reposicionado + sino duplicado do Ranking removido | `761ccdc` |
| 5 | Legibilidade dos banners Home e Campeonatos | `761ccdc` |
| 6 | Apple Health / Health Connect / Strava com fluxo próprio | `18872c4` |
| 7 | Tela Dispositivos e Relógios auditada e corrigida | `18872c4` |
| 8 | BehaviorEngine e ReputationEngine ligados ao histórico real | `2abead7` |
| 9 | Último bypass do antifraude fechado (sync do Strava) | `ea66063` |
| 10 | Perfis de validação por modalidade + teto de 90 min | `ee7df24` |
| 11 | Deduplicação entre fontes | `50d5626` |

---

## CORRIGIDO — causa raiz de cada bug relatado

### 1. Alterar academia não funcionava (P0)

**Arquivo:** `src/pages/ProfileSecondary.tsx`
**Causa raiz:** regressão do commit `17db65d`, que removeu `GymSelector.tsx` (666 linhas) e o substituiu por uma tela nova. A tela antiga fazia reverse-geocoding (Nominatim) e passava bairro+cidade para `gymService.searchNearbyGyms`. A nova passava só lat/lng. O backend (`api/_handlers/gyms.ts`) tem **três fallbacks encadeados que só disparam quando recebem bairro/cidade** — eles ficaram mortos, e em qualquer região onde o "nearby" do Google volta vazio a busca simplesmente não achava nada.

**Segunda causa, mais grave:** a busca por NOME chamava `getCurrentLocation()` e morria junto quando o GPS falhava. Sem GPS, o usuário não tinha **nenhuma** forma de trocar de academia. A tela antiga tinha um fallback de coordenada; a nova não tinha nada.

**Correção:** reverse-geocoding restaurado; busca por texto desacoplada do GPS (usa último ponto conhecido, ou a academia atual do usuário, antes de desistir); erro agora é persistente com botão TENTAR NOVAMENTE em vez de um toast que sumia em 5 s; guarda contra clique duplo no `joinGym`.

**Ainda pendente de confirmação sua:** se a busca continuar vazia em produção, o próximo suspeito é a variável `GOOGLE_PLACES_API_KEY` / faturamento do Google Cloud — o handler devolve 503 quando ela falta. Isso é ambiente, não código.

### 2. Musculação/Cardio caíam numa tela intermediária (P0)

**Arquivo:** `src/pages/Challenges.tsx`
**Causa raiz:** o deep link `/challenges?type=workout` **existia e funcionava**, mas abria o fluxo dentro de um `useEffect` — ou seja, depois da primeira pintura. A lista de Desafios aparecia por um instante antes do overlay subir, e a sensação era exatamente a descrita: "fui jogado numa tela intermediária e preciso procurar a atividade de novo".

**Correção:** o fluxo agora nasce aberto no próprio `useState`. A lista nunca chega a ser vista. Além disso, ao concluir ou voltar, quem entrou pela Home volta **para a Home** (`closeFlow`), em vez de cair na lista de Desafios — isso era o item 9 do seu pedido (auditoria dos retornos).

### 3. Apple Health / Health Connect / Strava iam para tela genérica (P0)

**Arquivo:** `src/pages/Profile.tsx` linha 1155
**Causa raiz:** literal — os três cards chamavam `onNavigate('/profile/wearables')`, o mesmo destino. O card dizia "Conectar" e só abria uma lista.

**Correção:** cada card abre o fluxo do seu provedor (`?connect=<id>`). Quem já está conectado continua indo para a tela de dispositivos, para revisar/desconectar sem risco de desconectar sem querer.

**Bug adicional encontrado:** existiam só dois estados (conectado/não conectado), então **qualquer** retorno falso do provider virava "Conexão cancelada pelo usuário" — inclusive abrir Apple Health no Android, onde o provider nem existe. Agora há seis estados e uma checagem de plataforma antes de tentar conectar. "Conectado" só aparece depois que `/api/wearables` confirma o vínculo: abrir o diálogo de permissão não basta mais.

### 4. Dispositivos e Relógios "praticamente infuncional" (P0)

**Arquivo:** `src/services/wearables/WearableManager.ts` linha 200
**Causa raiz:** `syncAll()` **sempre lança uma exceção** — de propósito, porque a ingestão segura de HealthKit/Health Connect ainda não existe no servidor. O comentário no código explica isso e a decisão está certa (não inventar pontuação no cliente). O problema era de UX: um CTA primário com 100% de falha.

**Correção:** o botão agora usa `stravaService.sync()`, que é real e já alimenta o pipeline → IGA, e fica desabilitado com explicação honesta quando o Strava não está conectado. **Nenhuma conexão falsa foi simulada** — conforme sua regra.

### 5. Fundos pretos (P2)

**Causa raiz:** `.profile-reference-screen`, `.profile-flow-screen` e `.ranking-flow` pintavam um preto opaco (`#050505` / `#030303`) por cima de `.app-fundo::before`, que é a arte oficial de fundo. Os três viraram transparentes; o gradiente radial do Ranking foi preservado.

### 6. Sino duplicado no Ranking (P2)

**Causa raiz:** o sino global fica em `Layout.tsx` (`position: fixed`). `Rankings.tsx` desenhava **outro** no próprio header — dois sinos sobrepostos, só nessa tela. Removido o local, mantido o global. A terceira coluna do grid continua reservada, então o sino global pousa ali sem cobrir o título.

O sino global também desceu: passou de `top` fixo para `calc(env(safe-area-inset-top) + 1.5rem)`, respeitando notch/Dynamic Island.

### 7. Legibilidade dos banners (P2) — medido, não estimado

Card real no celular = viewport − 32 px. Com apenas `cqw`, os textos renderizavam assim:

| | Android 360 | iPhone 390 | iPhone 430 |
|---|---|---|---|
| Banner Liga — descrição | 10,2 px | 11,1 px | 12,3 px |
| Campeonatos — rótulo | **7,1 px** | **7,7 px** | 8,6 px |
| Campeonatos — descrição | **6,2 px** | **6,8 px** | 7,6 px |

O banner de Campeonatos estava em 6–8 px. Isso não é "pequeno", é ilegível — bate exatamente com a sua reclamação.

**Correção:** todo texto secundário passou a usar `max(<piso em px>, <cqw>)`. O piso garante um mínimo real na tela; o `cqw` continua mandando nos cards maiores, preservando a proporção da arte aprovada. Liga sobe para 12–13,9 px e Campeonatos para 11–12,3 px.

Onde o espaço físico não permitia — as 4 colunas do banner de Campeonatos têm ~48 px reais cada — apliquei a regra que você definiu (**legibilidade acima de quantidade de texto**): as descrições do banner Liga foram encurtadas e, no celular, o banner de Campeonatos mostra um rótulo curto e oculta a descrição. Nenhuma arte foi alterada. Contraste dos textos menores também aumentado.

### 8. Bypass do antifraude (integridade competitiva)

O Strava era o **único** caminho que chegava em `workouts` — e portanto ao IGA e ao ranking — sem passar pelo `SecurityPipeline`. Passava só pela validação leve do ScoreEngine. Os outros três caminhos já rodavam os 10 sub-motores.

Vale registrar: o commit anterior (o que fez o Strava escrever em `workouts` para virar elegível ao IGA) **ampliou** essa lacuna. Corrigido no mesmo ciclo.

Detalhe que evitou uma regressão em massa: o Strava não envia lista de checkpoints, só `start_latlng`. Sem mapear isso, o `ValidationEngine` trataria **toda** corrida como "sem GPS" e reprovaria atletas legítimos em bloco.

**Auditoria de bypass, resultado completo:**
- Cliente → `workouts`: já bloqueado pelas regras do Firestore (`create/update` só `isAdmin`).
- Cliente → `users.score` / `weeklyScore` / `monthlyScore`: já bloqueado pelas regras.
- 6 escritores de `workouts` no backend: 5 com pipeline, 1 (revisão do admin) é override humano intencional.
- `ScorePersistence.persistScoreAtomic` incrementa `score`/`monthlyScore` por fora do IGA. Confirmado **sem nenhum chamador**; não removido (também cuida de `running_stats`), mas marcado com aviso para não ser religado sem antes tirar a escrita nesses campos.

### 9. Behavior e Reputation eram decorativos

Os 4 pontos que chamam `runPipeline()` passavam `userHistory` como `[]` fixo. Como o BehaviorEngine exige ≥3 atividades e o ReputationEngine ≥20, os dois **nunca** comparavam o atleta com ele mesmo — bem implementados e completamente inertes.

Além de buscar o histórico, o novo módulo **traduz o vocabulário**: cada caminho de escrita usa nomes diferentes de status e os engines esperam os do pipeline. Sem essa tradução o filtro não reconheceria nenhuma atividade real e o efeito prático continuaria sendo o de lista vazia.

---

## TESTES — o que foi efetivamente executado

`bash scripts/verificar-antifraude.sh` — roda sem `npm install`. **16/16 passando.**

Regras competitivas (executando o motor de verdade, não só compilando):

```
OK  Musculacao de 25 min nao conta (minimo 30)        F=0
OK  Musculacao de 30 min conta                        F=1
OK  Cardio de 15 min nao conta (minimo 20)            F=0
OK  Cardio de 20 min conta                            F=1
OK  Sessao de 300 min pontua igual a uma de 90 min    90min=37  300min=37
OK  Tempo contabilizado limitado a 90 min             T=90
OK  5 treinos reais valem mais que 1 sessao inflada   88 > 37
OK  Sessao reprovada nao entra na frequencia          F=2
OK  120 min / 900 kcal nao e penalizado               gate=1
OK  60 min / 3000 kcal e penalizado                   gate=0.8
```

Deduplicação — metade dos casos existe para provar **ausência de falso positivo**:

```
OK  Mesma corrida por Invictus + Strava e detectada
OK  Corrida 6h depois NAO e duplicata
OK  Metricas incompativeis (5km x 12km) NAO viram duplicata
OK  Musculacao x corrida na mesma janela NAO e duplicata
OK  Re-sync do mesmo id do Strava e duplicata exata
OK  Musculacao repetida por outra fonte e duplicata
```

Além disso: `esbuild` (sintaxe + resolução de imports) em todos os arquivos alterados, e uma varredura estática de TDZ nos 6 arquivos de tela.

**Essa varredura pegou um bug real que o compilador não pega:** o efeito do deep link ficou declarado depois de `connectProvider` e o listava como dependência. Como o array de dependências é avaliado durante a renderização, isso derrubaria a **tela inteira** de Perfil/Configurações — não só o efeito. Foi exatamente o "compilou ≠ funciona" que você alertou.

---

## NÃO TESTADO — sendo honesto sobre o escopo

| Ambiente | Status |
|---|---|
| Chrome / validação visual | **NÃO EXECUTADO** |
| Build completo (vite) | **NÃO EXECUTADO** |
| iOS (dispositivo/simulador) | **NÃO EXECUTADO** |
| Android (dispositivo/emulador) | **NÃO EXECUTADO** |

**Motivo:** `npm install` não completa neste ambiente (o comando é interrompido por limite de tempo antes de terminar, em todas as tentativas). Sem `node_modules` não há `vite build` nem servidor de desenvolvimento, e sem servidor não há o que abrir no Chrome.

Por isso, seguindo sua regra 18, classifico assim:

- Correções de banner: **IMPLEMENTADO — VALIDADO POR CÁLCULO, NÃO VISUALMENTE.** Os px renderizados foram calculados para 4 larguras reais, mas ninguém olhou a tela. Recomendo abrir a Home e Campeonatos no celular antes de aceitar.
- Fundos pretos, sino: **IMPLEMENTADO — NÃO VALIDADO VISUALMENTE.**
- Apple Health / Health Connect: **IMPLEMENTADO — NÃO VALIDADO EM DISPOSITIVO.** São plugins nativos; navegador não serve para testar.
- Strava OAuth: **IMPLEMENTADO — NÃO VALIDADO PONTA A PONTA** (precisa de conta real e callback).
- GPS / busca de academia: **IMPLEMENTADO — NÃO VALIDADO EM DISPOSITIVO.**

---

## ATENÇÃO ANTES DO DEPLOY — duas mudanças alteram quem pontua

Não são bugs; são regras que você definiu. Mas mudam número no ranking de gente real, então prefiro que você saiba antes e não depois.

**1. Teto de 90 min por sessão.** Quem vinha registrando sessões muito longas vai ver o IGA cair. Antes, uma única sessão de 5 horas já levava o fator tempo ao máximo sozinha — inflar duração era o caminho mais barato para o topo. O teto é a regra que você definiu ("máximo pontuável = 90 minutos"), mas o efeito é retroativo no recálculo.

**2. Dedup Invictus + Strava.** Quem grava a corrida no app **e** sincroniza o Strava vinha pontuando duas vezes pela mesma corrida. Agora pontua uma. Para essas pessoas, o ranking vai parecer que "caiu" — na verdade parou de contar dobrado.

Se preferir avisar os atletas antes, ou aplicar só na próxima temporada, dá para segurar: as duas mudanças estão isoladas e o rollback é simples.

---

## PENDENTE

- Fase 4 — auditoria completa de fluxos e estados (Power Lift, Saúde, Notificações, Histórico, Carteira, modais, recuperação de sessão, back do Android/iOS). Os fluxos P0 que você relatou foram feitos; o varrimento exaustivo do app inteiro não.
- Validação visual e em dispositivo de tudo acima.
- Ingestão segura de HealthKit / Health Connect no servidor — sem ela, esses dois provedores conectam mas não geram atividade nem pontuação. É a maior lacuna funcional que sobrou, e é trabalho de backend novo, não conserto.

## BLOCKED — precisa de decisão sua

- **`BLOCKED_PRODUCT_DECISION` — pesos por modalidade no risco.** Você pediu pesos diferentes para musculação e cardio (item 22). Os perfis de modalidade já existem e estão centralizados, mas os pesos de integridade (`integrityWeights`) continuam um conjunto único. Definir "quanto GPS vale no risco de uma corrida" é calibração de produto com efeito direto em quem é aprovado ou reprovado. Não inventei números.
- **Google Places / faturamento**: se a busca de academias seguir vazia em produção mesmo com as correções, é ambiente. Não mexi em credenciais.

---

## Nota sobre os commits

Tudo local, nada publicado. Para receber, faça `git pull` na sua máquina. Os commits estão em ordem e cada um traz a causa raiz na mensagem, então dá para reverter qualquer bloco isolado sem desfazer os outros.
