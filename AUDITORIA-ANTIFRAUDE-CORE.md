# Auditoria do Motor Antifraude — Invictus Performance

**Fase 3, primeira passada: mapeamento e classificação. Nenhum código de antifraude foi alterado neste documento.**
Data: 2026-08-27

Igual à auditoria de pontuação (`AUDITORIA-CORE-INVICTUS.md`), este documento responde "o que está realmente conectado?" lendo o código (arquivo:linha), não o nome dos arquivos.

---

## Resumo executivo

A notícia boa: **o motor antifraude central já existe, é sofisticado e já é único** — não há dois sistemas de antifraude concorrentes. `SecurityPipeline.runPipeline()` (`api/_lib/security-pipeline.ts:54`) já roda, nesta ordem fixa e versionada, em todo treino: Validation → Integrity → Behavior → DeviceFingerprint → Network → Fraud → Reputation → Trust → Risk → Explainability, grava um relatório imutável em `security_reports` e no `AuditLogger`, e devolve uma decisão única (`APPROVED` / `PARTIALLY_APPROVED` / `UNDER_REVIEW` / `BLOCKED`) que já mapeia quase 1:1 para os 4 estados que você pediu (item 31).

A notícia que precisa de atenção: **duas peças desse motor (Behavior e Reputation) são alimentadas com histórico vazio em todos os 4 pontos de entrada**, então parte importante da análise comportamental hoje roda sempre no caminho neutro, sem nunca comparar o atleta com ele mesmo. E **não existe Validation Profile por modalidade** — os limites de duração e os pesos de integridade são um único conjunto global, não os 30-90min (musculação) / 20-90min (cardio) que você pediu, nem pesos diferentes por modalidade (item 22).

---

## 1. Classificação por peça

| Motor | Arquivo | Classificação | Evidência |
|---|---|---|---|
| ValidationEngine | `validation-engine.ts` | **FUNCIONAL** | Valida tipo, duração, GPS obrigatório por modalidade (via `resolveModality`), janela de tempo, distância, FC obrigatória por tipo, fonte de dados, elegibilidade do usuário. `valid` realmente gate a decisão (linha 127-134). |
| IntegrityEngine | `integrity-engine.ts` | **FUNCIONAL** | Score ponderado 0-100 em 5 dimensões (GPS/FC/movimento/consistência de tempo/confiabilidade da fonte), tolerante a imprecisão de GPS pequena (só penaliza >25m/>50m), não acusa fraude automaticamente. |
| FraudEngine | `fraud-engine.ts` | **FUNCIONAL** | Agrega evidências reais de 5 sub-motores (device/GPS/sensor/health/photo) + impossibilidades físicas (calorias/min, FC>230, movimento insuficiente vs. GPS). Sinais padronizados com `code/category/severity/weightPenalty` — muito próximo do formato pedido no item 29. |
| RiskEngine | `risk-engine.ts` | **FUNCIONAL** | Não é "if anomalia então rejeita" (item 30): soma penalidades ponderadas de fraude + integridade + validação, aplica thresholds configuráveis (`security-config.ts`) e só bloqueia direto por ameaça CRÍTICA/emulador ou usuário banido. |
| ExplainabilityEngine + AuditLogger | `explainability-engine.ts`, `audit-logger.ts` | **FUNCIONAL** | Gera `primaryRiskDriver`/`summaryText` (já usado para não expor thresholds ao usuário, item 35) e grava log imutável com `engineVersions` por motor (item 36, já versionado). |
| BehaviorEngine | `behavior-engine.ts` | **PARCIAL — desconectado na prática** | Motor estatístico real (Z-score de duração/calorias/FC, janela de horário, novo local). **Mas os 4 pontos de entrada que chamam `SecurityPipeline.runPipeline()` sempre passam `userHistory=[]`** (ver achado crítico #1). Com histórico vazio, `validHistory.length < 3` é sempre verdade e o motor sempre retorna o branch neutro (score 90, zero anomalias) — nunca compara o atleta com ele mesmo, apesar do código para isso existir e funcionar. |
| ReputationEngine | `reputation-engine.ts` | **PARCIAL — metade morta** | Idade de conta e sanções administrativas funcionam (vêm de `userData`). Mas taxa de aprovação, reincidência de fraude e variação de dispositivos dependem de `userHistory`, que chega sempre vazio pelo mesmo motivo do BehaviorEngine. |
| TrustEngine | `trust-engine.ts` | **FUNCIONAL, mas herda o viés acima** | Combina reputation+integrity+behavior+device+network num score único — matematicamente correto, mas como Behavior/Reputation estão parcialmente cegos, o Trust Score fica sistematicamente "bom demais" pra qualquer atleta (novo ou veterano rende quase o mesmo). |
| DeviceFingerprintEngine | `device-fingerprint.ts` | **FUNCIONAL (não auditado a fundo)** | Roda em todo pipeline, gera hash + risk score. Não confirmei ainda a fonte de dados de fingerprint (nativo iOS/Android vs. apenas web) — fica para a próxima passada. |
| NetworkEngine | `network-engine.ts` | **FUNCIONAL (não auditado a fundo)** | Detecta VPN/Tor/risco de rede a partir de `reqContext`. Não confirmei se `reqContext` chega populado de verdade em todos os 4 call sites (só vi ser passado como `{}` implícito em alguns). |
| Validation Profile por modalidade | — | **NÃO IMPLEMENTADO** | Ver achado crítico #2. Existe `modality-config.ts`, mas só controla exigência de GPS — não duração min/max nem pesos de risco por modalidade. |
| Deduplicação cross-source (fingerprint) | — | **NÃO IMPLEMENTADO** (mock) | Ver achado crítico #3. `FraudEngine` checa `activity.isDuplicateActivity`, mas nenhum caller no backend inteiro seta esse campo. |
| Cross-Account Engine | — | **NÃO IMPLEMENTADO** | Não existe um motor dedicado; `ReputationEngine` tem um campo `linkedAccountsCount` mas ele vem pronto de `userData.linkedAccountsCount` — não há lógica que descubra contas ligadas (mesmo dispositivo, mesmos padrões). |
| Power Lift — pipeline de vídeo | — | **A CONFIRMAR** | Ainda não localizei o fluxo de validação de vídeo/carga do Power Lift dentro do SecurityPipeline — parece rodar fora dele. Fica para a próxima passada (é o item 38 do seu pedido). |

---

## 2. Achado crítico #1 — Behavior/Reputation rodam com histórico vazio

Os 4 pontos de entrada que chamam `SecurityPipeline.runPipeline()` (depois da consolidação de pontuação desta sessão) passam o último parâmetro (`userHistory`) como array vazio:

- `api/_services/activities/validate-activity-service.ts` — `SecurityPipeline.runPipeline({...}, request.userId, user || {}, [])`
- `api/_handlers/validate-presence.ts` (`commitWorkoutSession` e `commitRunningSession`) — mesmo padrão, `[]`
- `api/_services/running/running-service.ts` (`addRun`) — mesmo padrão, `[]`

`BehaviorEngine.evaluate()` exige `validHistory.length >= 3` pra sair do branch neutro (linha 35 de `behavior-engine.ts`); `ReputationEngine.evaluate()` exige `totalActivities >= 20` pra considerar taxa de aprovação (linha 68). Como `userHistory` nunca chega com dados, essas duas peças **nunca** avaliam o comportamento real do atleta hoje — mesmo tendo o código pronto e correto pra isso.

Isso não é um "if" simples de corrigir sem pensar: cada call site precisaria buscar as últimas N atividades do usuário em `workouts` antes de chamar o pipeline (mais uma leitura no Firestore por request). Fica mapeado como parte da Task 21/22 pendente, não corrigido ainda.

---

## 3. Achado crítico #2 — sem Validation Profile por modalidade

`SECURITY_CONFIG.validation.minDurationMins`/`maxDurationMins` (`security-config.ts:79-80`) é **um único par global (5min–360min)**, aplicado a musculação e cardio igualmente. Não existem os 30-90min (musculação) / 20-90min (cardio) do seu pedido. Da mesma forma, `SECURITY_CONFIG.integrityWeights` é um único conjunto de pesos (GPS 20%/FC 20%/movimento 20%/tempo 20%/sensor 20%) — não existe um perfil "musculação pondera duração+coerência muito, pace nada" vs. "cardio pondera GPS+pace+distância muito" como pedido no item 22.

`modality-config.ts` já é a peça certa pra virar esse "Validation Profile" (tem `antiFraudProfile: 'RUNNING'|'WALKING'|...`), mas hoje esse campo **nunca é lido em lugar nenhum** — é declarado e nunca consumido.

---

## 4. Achado crítico #3 — deduplicação cross-source é um mock

`FraudEngine.analyze()` (`fraud-engine.ts:264`) checa `activity.isDuplicateActivity || activity.idempotencyDuplicate` — mas busquei em todo o `api/` e **nenhum caller seta esse campo**. Ou seja, o sinal `REPLAY_DUPLICATE_ACTIVITY` nunca dispara na prática. A única deduplicação real que existe hoje no sistema é:

1. Uma janela de 10 segundos, mesmo tipo + mesma duração, dentro do MESMO request (`validate-activity-service.ts`) — não pega duplicidade entre fontes diferentes.
2. Idempotência por `eventId` no `ScoreEngine`/`EventLogService` — evita reprocessar o MESMO evento do Strava duas vezes, mas não pega a mesma corrida física chegando por HealthKit *e* Strava com IDs diferentes.

Deduplicação de verdade por fingerprint entre HealthKit/Health Connect/Strava/Invictus (seu item 5) não existe ainda — confirma o que já estava mapeado na Task 24.

---

## 5. O que isso muda para as próximas tasks

Nada do que já foi implementado nesta sessão (consolidação de pontuação, Fases 2) precisa ser desfeito — o antifraude que já existe continua sendo a única porta de entrada pro Score Engine/IGA, e essa auditoria não muda isso. O que muda é o escopo real das tasks já criadas:

- **Task 21 (esta)**: concluída — classificação acima.
- **Task 22 (Validation Profiles por modalidade)**: precisa criar limites de duração e pesos por modalidade (musculação vs. cardio vs. Power Lift), consumindo/estendendo `modality-config.ts` em vez de criar um motor novo.
- **Task 23 (bloqueio de bypass)**: revisitar à luz do achado #1 — activities aprovadas hoje têm menos sinal comportamental real do que parecem ter.
- **Task 24 (dedup)**: confirmado que precisa ser construído do zero (não é ajuste, é feature nova) — fingerprint por `sourceActivityId`/janela temporal/duração/distância.
- Nova sub-task recomendada: alimentar `userHistory` de verdade nos 4 call sites do `SecurityPipeline.runPipeline()` (achado #1) — sem isso, Behavior/Reputation continuam cosméticos mesmo depois dos Validation Profiles prontos.
