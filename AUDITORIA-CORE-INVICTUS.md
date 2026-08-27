# Auditoria do Core Competitivo — Invictus Performance

**Fase 1: mapeamento. Nenhum código foi alterado neste documento.**
Data: 2026-08-27

Este documento responde à pergunta "os sistemas estão realmente conectados?" — não "o arquivo existe?". Cada afirmação abaixo foi verificada lendo o código real (arquivo:linha), não inferida pelo nome dos arquivos.

---

## 1. O que existe hoje (mapa real, não o mapa pretendido)

Encontrei **cinco pontos de entrada independentes** que gravam pontuação competitiva, cada um com sua própria lógica:

| # | Entrada | Arquivo | O que calcula | Onde grava |
|---|---|---|---|---|
| 1 | Treino manual/legado (usado por `Challenges.tsx`) | `api/_services/activities/validate-activity-service.ts` | `calculateScore()` — fórmula própria, local, ad-hoc (`duration × pontosPorMinuto × multiplicadorIntensidade`) **e** `calculateRankingPoints()` (cópia de `seasonUtils.ts`) | `users.score` (via `addRankingScore`) + XP via `addXP` |
| 2 | Corrida nativa (GPS, `RunTracker.tsx`) | `src/services/runningService.ts` → `running_stats`/`run_sessions` | Lógica própria de corrida | `running_stats`, `run_sessions` (coleções **separadas** de `workouts`) |
| 3 | Sync do Strava | `api/_lib/sync-service.ts` → `ScoreEngine.processStrava()` | Motor sofisticado em `api/_lib/score-engine/*` (base-score, bonuses, multipliers, penalties, quality-engine, competitive-engine, confidence-engine...) | `users.score`, `users.monthlyScore` (via `score-engine/persistence.ts`) |
| 4 | Check-in de presença na academia | `api/_handlers/validate-presence.ts` | Cálculo próprio de `pointsEarned` | `users.monthlyScore` (incremento direto, **sem passar pelo ScoreEngine**) |
| 5 | IGA semanal | `api/_lib/igaService.ts` → `src/core/iga/igaEngine.ts` | `IGA = 100 × ∛(Fn × Tn × In)` — **3 fatores, raiz cúbica** | `users.weeklyScore`, `users.igaAudit` |

**Nenhuma dessas 5 chama a `ScoreEngine` exceto a via 3 (Strava).** A via 1 (o fluxo mais usado, treino manual) não usa IGA nem ScoreEngine — usa uma terceira fórmula inventada ali mesmo no service.

### A fórmula do IGA que está implementada não é a que você descreveu

Você mencionou `IGA = ⁴√(F × C × T × I)` (4 fatores, raiz quarta, C = gasto calórico como fator multiplicativo).

O que está em `src/core/iga/igaEngine.ts:161-164` é:
```
IGA = 100 × ∛(Fn × Tn × In)     // 3 fatores: Frequência, Tempo, Intensidade (FC)
```
Calorias **não entram na raiz** — entram depois, como um multiplicador de correção (`overallGate`, calculado em `calorieGate.ts`, aplicado em `igaEngine.ts:181`: `igaFinal = igaBase × overallGate`). Ou seja: a fórmula real tem 3 fatores na raiz + 1 fator de correção pós-raiz, não 4 fatores dentro da mesma raiz.

Existe ainda um `src/core/iga/igaOriginal.ts` — **não é importado por nada** (`src/core/iga/index.ts` não o exporta, nenhum outro arquivo o referencia). Código morto, provavelmente uma versão anterior da fórmula abandonada no lugar.

**Preciso que você confirme qual das duas é a fórmula oficial antes de eu consolidar** — não vou decidir isso sozinho.

---

## 2. O ranking mostra números diferentes dependendo da aba — e isso é esperado pelo código, não um bug de UI

`api/_handlers/ranking.ts:19` e `src/services/rankingService.ts:131` (idênticos):
```js
const scoreField = period === 'weekly' ? 'weeklyScore' : period === 'monthly' ? 'monthlyScore' : 'score';
```

- **Semana atual** → `weeklyScore` → escrito só pelo IGA (`igaService.ts`)
- **Mês atual** → `monthlyScore` → escrito pelo ScoreEngine (Strava) **e** por `validate-presence.ts` (check-in), cada um incrementando de forma independente
- **Temporada** → `score` → escrito pela via 1 (treino manual/ranking-points) **e** pelo ScoreEngine (Strava)

Um usuário que treina manualmente pelo app inteiro o mês e nunca sincroniza Strava: `weeklyScore` só reflete o que o IGA rodou naquela semana; `score` cresce pelo ranking-points; `monthlyScore` só cresce se ele fizer check-in de presença. **As três abas do ranking, para a mesma pessoa, contam três histórias diferentes**, porque três sistemas diferentes escrevem em três campos diferentes sem se falar.

---

## 3. Campeonatos: a tela inteira é front-end puro, sem backend

`src/services/championshipService.ts` — busquei qualquer chamada de rede (`fetch`, `axios`, cliente de API): **nenhuma**. `getUserRegistrations()` lê de `localStorage.getItem(...)`. As "inscrições" em Arena 30D / Run Elite 30D que aparecem em `MyChampionshipDetail.tsx` nunca tocam o Firestore.

Enquanto isso, `api/_handlers/championships.ts` existe no backend — mas nada no frontend o chama.

Isso é diferente do conceito de **"Temporada"** (`inscricao-service.ts`, `season-prize-engine.ts`, `season-settings.ts`), que **é** real e passa pelo Firestore (inscrição paga, `seasonStatus`, `getSeasonParticipants()` lendo `monthlyScore`). São dois sistemas com nomes parecidos ("campeonato" vs "temporada") e maturidade completamente diferente: um é protótipo visual, o outro já mexe com dinheiro e Firestore.

**Item 13 do seu pedido ("não existe temporada ativa, backend precisa reconhecer") — parcialmente verdade:** o sistema de Temporada tem essa noção (`seasonStatus`); o sistema de Campeonatos (Arena/Run Elite) não tem noção nenhuma de estado porque não é persistido em lugar nenhum além do localStorage do aparelho.

---

## 4. O SecurityPipeline existe e roda — isso é uma boa notícia

Ao contrário do resto, o antifraude do fluxo principal (via 1) **está** conectado: `validate-activity-service.ts:151` chama `SecurityPipeline.runPipeline(...)`, com fail-closed real (`catch` bloqueia a atividade se o pipeline falhar tecnicamente — `validate-activity-service.ts:188-195`). Ainda não abri `security-pipeline.ts` por dentro para ver quais dos engines (`fraud-engine.ts`, `integrity-engine.ts`, `risk-engine.ts`, `behavior-engine.ts`, `reputation-engine.ts`, `trust-engine.ts`, `network-engine.ts`, `device-fingerprint.ts`) ele de fato aciona — isso é trabalho de Fase 2.

O que já sei: essa camada de segurança **não é a mesma coisa** que decide a pontuação. Ela decide se a atividade é aprovada; a pontuação em si (o "quanto") é a bagunça de 5 fórmulas descrita acima. São auditorias separadas.

---

## 5. Achado colateral, fora do escopo de pontuação

`api/_repositories/activity-repository.ts:31` — `findByUser()` ordena por `.orderBy('timestamp', 'desc')`, mas `base-repository.ts:16-22` (`create()`) nunca grava um campo `timestamp` — só `createdAt`. No Firestore, `orderBy` de um campo ausente **exclui o documento do resultado**. Se nenhum outro caminho grava `timestamp` nesses documentos, toda atividade criada pela via 1 pode estar invisível para `findByUser()` (histórico), mesmo aparecendo certo em `findRecentByUser()` (que usa `createdAt`). Ainda não confirmei se algum outro ponto grava `timestamp` — marcado para verificar na Fase 2, não corrigi ainda.

---

## 6. Duplicações e código morto confirmados

- `src/core/iga/igaOriginal.ts` — morto, zero referências.
- Fórmula de pontos de ranking existe em dois arquivos idênticos por design (`src/lib/seasonUtils.ts` e `api/_lib/ranking-points.ts`) — o comentário no topo de `ranking-points.ts` explica que é intencional (Vercel empacota `api/` isolado), mas isso significa que **toda mudança na fórmula precisa ser feita nos dois lugares manualmente**, sem teste automático que garanta que ficaram iguais. Já divergiram no passado (é o motivo do arquivo existir).
- `updateUserPerformance` em `sync-service.ts` — o próprio comentário do código (linha ~28) diz que ficou órfã após a consolidação do ScoreEngine.

---

## 7. O que ainda NÃO investiguei (para ser honesto sobre o escopo)

Seu pedido cobre 27 seções. Nesta primeira passada priorizei a espinha dorsal (treino → pontuação → ranking → campeonato), porque é onde as inconsistências mais te afetam. Ainda não abri com profundidade:
- `security-pipeline.ts` por dentro (quais engines ele realmente chama, em que ordem)
- Deduplicação entre HealthKit/Health Connect/Strava (item 4 do seu pedido)
- `AppleHealthProvider.ts` / `HealthConnectProvider.ts` / `WearableManager.ts` — se convergem pro mesmo pipeline
- Firestore security rules e transactions/concorrência (itens 16-18)
- Reward Engine (`rewards-engine.ts`) — quem alimenta ele
- Entitlements/planos (item 15)
- iOS/Android nativo (itens 19-20)

---

## Antes de eu continuar

Isso já é o suficiente pra decidir prioridade com você em vez de eu escolher sozinho. Três perguntas concretas:

1. **Qual fórmula do IGA é a oficial** — a raiz cúbica de 3 fatores que está implementada, ou a raiz quarta de 4 fatores que você descreveu? Isso muda o resto da consolidação.
2. **Consolido em cima do `ScoreEngine`** (o motor mais completo, hoje só usado pelo Strava) **ou em cima do IGA** (mais simples, é o que você citou na fórmula)? Não posso aposentar um sistema por conta própria num app que já tem gente pontuando de verdade.
3. **Campeonatos (Arena 30D/Run Elite) — vira um MVP real ligado ao backend agora, ou fica como protótipo visual até você decidir o modelo de negócio dele?** Isso muda se eu construo persistência nova ou só documento o estado atual.

Não vou tocar em código de pontuação/ranking/campeonato até ter sua resposta nessas três — é dinheiro e integridade competitiva real, prefiro perder um ciclo perguntando a quebrar algo que já está em produção.
