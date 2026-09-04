# Auditoria + Reconstrução da tela Saúde — 2026-09-03

Commit: `6a03b31`. Arquivos alterados: `src/pages/Health.tsx`, `src/pages/HealthReport.tsx`, `src/pages/HealthNew.css`. **Commit local apenas — precisa de push/deploy do usuário para ir ao ar.**

## A) Fidelidade visual

Reconstruída a área de **conteúdo** da aba "SAÚDE" (dentro de `/health`) seguindo a ordem de cards da imagem de referência. Header e bottom nav (`health-new-shell`/`health-new-footer`) **não foram tocados**.

Componentes reproduzidos: Estado de Hoje (já existia), Seu Corpo × Seus Treinos (novo), Último Treino (novo, card único), Resposta ao Treino (novo), Evolução · 30 Dias (novo, cardio+musculação lado a lado), Sono × Performance (novo, correlação real), Indicadores dos Últimos 7 Dias (6 mini-cards: FC repouso/HRV/Sono/Passos/Freq. Resp./SpO₂), Insight Invictus IA PRO (novo banner com CTA).

Diferenças inevitáveis em relação à imagem:
- **Ilustração corporal** ("Seu Corpo × Seus Treinos"): não existe asset oficial no projeto. Implementado como placeholder (ícone + "Ilustração em preparação"), pronto para receber a arte real.
  **ASSET NECESSÁRIO: "Body recovery / muscle load visualization"** (ilustração anatômica com anel de progresso, como na referência).
- **Carga recente / Prontidão**: mostrados como "Indisponível" (ver seção D).
- **Volume / Séries** no card "Último Treino": mostrados como "Não registrado" para treinos de musculação (ver seção D).
- 5ª aba "RELATÓRIO PRO" da imagem virou um atalho/chip que navega para `/health/report` (rota já existente) em vez de conteúdo duplicado dentro da aba.

## B) Dados

| Métrica | Fonte | Funcionando | Fallback sem dado |
|---|---|---|---|
| FC repouso, HRV, Sono, Passos, Freq. Resp., SpO₂ | HealthKit/Health Connect → `health_samples` → `/api/health-summary` | Sim (Health Confidence Engine A-E real) | "—" / "Sem dados sincronizados" |
| Atividades nas últimas 72h | Firestore `workouts` (mesmo pipeline de antifraude/IGA) | Sim | "0 atividades" |
| Recuperação (card corpo) | Heurística `calcularEstadoDeHoje` (mesma do "Estado de Hoje") | Sim, não-clínica | "Sem dados suficientes" |
| Carga recente / Prontidão | `performanceEngine.ts` (`acute_chronic_workload_ratio`, `readinessScore`) | **Não** — hardcoded indisponível no backend | "Indisponível" |
| Último treino (duração/FC/calorias) | Firestore `workouts` | Sim | "—" |
| Último treino — Volume/Séries | **Não existe no schema atual** | Não | "Não registrado" |
| Último treino — Distância/Ritmo (cardio) | `workouts.distanceKm` (GPS) | Sim, quando há GPS | "—" |
| Resposta ao Treino (FC/duração/calorias vs média) | `healthTimeframeWorkouts` (mesma fonte de `avg_heart_rate`) | Sim | Estado vazio com "precisamos de 2+ treinos" |
| Evolução 30d — pace/sessões cardio | `workouts.distanceKm`/`durationMinutes` | Sim, quando há GPS | "Sem sessões" |
| Evolução 30d — frequência/consistência musculação | Contagem de sessões + `consistency_index` (performanceEngine) | Sim | "—" |
| Sono × Performance | Correlação real: `sleep_duration_min` × `duration_min` (ambos de `/api/health-summary`) | Sim, com amostra ≥3 dias/grupo | "Precisamos de mais dados..." |
| Insight Invictus IA (texto do banner) | `buildHealthInsights` (determinístico, já existia) | Sim | Texto genérico de incentivo a sincronizar |

## C) Pipeline

Confirmado (auditoria de código, não testado em dispositivo real neste ciclo):
- Sync incremental real com cursor (`lastVitalsSyncTime`) + overlap de 24h, backfill de 30 dias na primeira sincronização.
- IDs determinísticos na gravação (`gravarAmostraSaude` usa `.create()`), portanto idempotente — reenviar a mesma amostra não duplica.
- Health Confidence Engine (A-E) é aritmético, sem IA, e já testado (`api/__tests__/health-confidence-engine.test.ts`).

**NÃO TESTADO — AMBIENTE INDISPONÍVEL**: não há como validar o ciclo "novo dado no relógio → aparece na tela" nesta sessão, porque (1) as mudanças estão só localmente commitadas, sem deploy, e (2) este sandbox não tem acesso a um dispositivo iOS/Android real nem simulador. Isso precisa ser validado depois do deploy, com um dispositivo real, seguindo o mesmo ciclo já usado antes nesta conversa (abrir o app publicado → Chrome real → comparar).

## D) Derivações internas (o que passou a ser calculado pelo Invictus, sem IA)

- **Resposta ao Treino**: FC média / duração / calorias do treino mais recente vs. média dos demais treinos com FC no período.
- **Evolução 30 dias**: pace médio (distância÷duração de treinos de cardio com GPS), frequência semanal de musculação, reaproveita `consistency_index` já existente.
- **Sono × Performance**: bucket de dias com sono ≥7h vs. <7h, comparando `duration_min` médio de cada grupo. Exige ≥3 dias em cada grupo.
- **Recuperação (card do corpo)**: reaproveita a mesma heurística de `calcularEstadoDeHoje` — não é um segundo cálculo paralelo.
- **Carga recente / Prontidão**: **propositalmente NÃO calculadas** por este trabalho. O `performanceEngine.ts` já deixa essas duas explicitamente `hasEnoughData:false`/`readinessStatus:'Indisponível'`, com o comentário "Aguardando carga de treino auditada pelo servidor" — isso está amarrado ao backlog #129 (sessão de atividade server-authoritative). Calcular um número paralelo aqui, sem essa base, seria inventar dado e contradizer o motor oficial. Ficou como "Indisponível" nos dois lugares onde a imagem pedia esses valores.

## E) Gemini

- Tela `/health` (`Health.tsx`): **zero chamadas Gemini**, antes e depois desta mudança. Confirmado por grep direto no arquivo.
- Banner "Insight Invictus IA": mostra um insight **já calculado deterministicamente** (`buildHealthInsights`, reaproveitado — nenhuma chamada nova). O botão "Conversar com Invictus IA" só **navega** para `/ai`; a chamada real ao chat só acontece se o usuário decidir conversar lá.
- `/health/report` (`HealthReport.tsx`): **antes** desta mudança, a análise de IA disparava sozinha (`useEffect` no mount) — violava a regra de zero chamadas implícitas. **Corrigido**: agora exige clique explícito em "ANALISAR COM IA" antes de chamar `/api/performance-ai`.
- Resultado líquido: abrir `/health`, trocar de aba, ou abrir `/health/report` **não dispara Gemini em nenhum caso**. Só dispara se o usuário clicar em "Conversar com Invictus IA" (leva para outra tela) ou "Analisar com IA" (dentro do relatório).

## F) Arquivos alterados

- `src/pages/Health.tsx` — nova estrutura de abas, 6 componentes novos (`SeuCorpoXSeusTreinosCard`, `UltimoTreinoCard`, `RespostaAoTreinoCard`, `Evolucao30DiasCard`, `SonoXPerformanceCard`, `InvictusIACTA`), helper `media7Dias`.
- `src/pages/HealthReport.tsx` — `AiHealthNarrative` agora requer clique explícito.
- `src/pages/HealthNew.css` — CSS novo para os 6 componentes acima (braces balanceados, verificado).

## G) Testes realizados

- `npx tsc --noEmit` no projeto inteiro: **0 erros** (incluindo os dois arquivos alterados).
- `npx esbuild` bundle-check isolado de `Health.tsx` e `HealthReport.tsx`: **sem erros de sintaxe/import**.
- Contagem de chaves `{`/`}` em `HealthNew.css`: balanceada (138/138).
- Grep de confirmação: nenhuma chamada Gemini nova em `Health.tsx`; `AiHealthNarrative` sem `useEffect` automático.
- **NÃO TESTADO — AMBIENTE INDISPONÍVEL**: verificação visual ao vivo no navegador. Este sandbox não tem rede para instalar o binário nativo do Rollup (`npm i` expirou por timeout) nem para servir a build para o Chrome real do usuário. As mudanças ficaram só localmente commitadas.
- **NÃO TESTADO — AMBIENTE INDISPONÍVEL**: dispositivo iOS/Android real, HealthKit/Health Connect ao vivo.

## H) Build

- `npx tsc --noEmit`: **PASSOU** (0 erros).
- `npm run build` (vite + esbuild do server): **FALHOU** — `Cannot find module @rollup/rollup-linux-x64-gnu` (bug conhecido do npm com dependências opcionais). Tentativa de `npm i @rollup/rollup-linux-x64-gnu` expirou por timeout (sem rede no sandbox). **Esta falha é do ambiente, não do código** — já existia antes desta mudança e não foi introduzida por ela.
- Lint: não executado nesta rodada (sem tempo hábil); recomendo rodar `npm run lint` depois do próximo `npm install` bem-sucedido, junto com a verificação visual.

---

## Próximos passos recomendados

1. Você faz o push (ou o auto-sync já usado antes) para levar o commit `6a03b31` ao ar.
2. Depois do deploy, eu abro `/health` no Chrome real e comparo visualmente com a imagem — aí sim consigo dar o status **APROVADO — TESTADO** para a parte visual.
3. Se quiser, testamos os estados vazios de verdade (conta sem wearable conectado, período sem sono suficiente etc.) usando uma conta de teste.
4. O gap de "Carga recente"/"Prontidão"/"Volume de musculação" fica registrado aqui — só será resolvido quando os itens #126-131 do backlog (sessão de atividade server-authoritative) ou um novo campo de log de séries/carga forem implementados. Não fiz isso agora porque estaria inventando dado.
