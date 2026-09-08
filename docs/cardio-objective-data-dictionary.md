# Buscar Objetivo — dicionário de dados

Versão inicial: 2026-09-07. Este domínio não alimenta ranking, IGA, premiação, cobrança ou antifraude. As decisões de segurança e progressão são determinísticas e versionadas.

## Estrutura privada

Todas as coleções abaixo ficam sob `cardio_objectives/{userId}` e têm leitura e escrita direta bloqueadas nas regras do cliente. O acesso ocorre somente pela API autenticada, sempre usando o `uid` do token — nunca um identificador enviado pelo aplicativo.

| Caminho | Finalidade | Mutabilidade e retenção |
|---|---|---|
| raiz do usuário | Ponteiro `currentJourneyId` e instante da última atualização | Mutável; não contém histórico clínico |
| `journeys/{journeyId}` | Estado atual, objetivo, comportamento atual e versões dos motores | Atualizações transacionais; preservado após conclusão/cancelamento |
| `journeys/{journeyId}/baselines/initial` | Foto inicial confirmada: respostas, perfil mínimo e capacidade relatada | Imutável (`create`); nunca reescrito |
| `journeys/{journeyId}/missions/{missionId}` | Meta semanal, prescrição, data, estado e vínculo com sessão/atividade | Transições controladas pela API; reagendamento preserva a missão original |
| `journeys/{journeyId}/reviews/{weekId}` | Check-in semanal e decisão antes/depois | Append-only, um documento por semana |
| `journeys/{journeyId}/weights/{measurementId}` | Pesagens confirmadas para o objetivo | Append-only; timestamp da medição e do registro separados |
| `journeys/{journeyId}/achievements/{achievementId}` | Conquista determinística e evidência que a originou | Criada uma vez; IDs garantem idempotência |
| `journeys/{journeyId}/events/{eventId}` | Linha do tempo de transições relevantes | Append-only e versionada |
| `journeys/{journeyId}/consents/product_v1` | Consentimento operacional da jornada | Não autoriza pesquisa nem profissional |
| `session_claims/{sessionId}` | Impede uma sessão em mais de uma missão | Permanente para idempotência |
| `activity_claims/{activityId}` | Impede uma atividade em mais de uma missão | Permanente para idempotência |

Documentos antigos em `habit_goals` são somente históricos. O endpoint antigo não lê nem modifica esses registros e responde `410 HABIT_FLOW_RETIRED`.

## Campos principais

### Jornada

- `status`: `active`, `paused`, `completed` ou `cancelled`.
- `goalType` / `goalLabel`: objetivo normalizado e texto mostrado.
- `outcome`: peso, distância ou tempo contínuo quando aplicável; `null` não significa zero.
- `behavior`: prescrição vigente. `targetMetric` define se a missão é validada por duração ou distância.
- `currentWeek`, `weekStartedAt`: janela de revisão semanal.
- `habitConfidence`: indicador de aderência do produto, não diagnóstico nem prova de hábito formado.
- `versions`: versões exatas de todos os motores que produziram a decisão.

### Missão

- `state`: `locked`, `available`, `started`, `completed`, `skipped`, `failed` ou `rescheduled`.
- `prescription`: modalidade, métrica-alvo, duração/distância, frequência e intensidade permitida.
- `localDate`: data civil na zona da jornada; não é um timestamp UTC.
- `sessionId` / `activityId`: referências a registros reais existentes; nenhum valor enviado pelo cliente é aceito como progresso.
- `context`: orientação curta de execução e segurança.
- `ruleVersion`: motor que criou a meta.

### Baseline de perfil

- `weightKg`: primeiro peso confiável disponível entre Apple Saúde/Health Connect e perfil, sempre apresentado para confirmação.
- `weightSource`, `weightMeasuredAt`, `weightSourceId`: origem e momento da sugestão.
- `strengthDays`, `planId`: calendário de musculação apenas para combinar a rotina.
- `recentCardioSessions`, `recentLongestRunKm`: janela limitada a 28 dias; `null` indica consulta indisponível, nunca ausência de esforço.
- `ageYears`, `heightCm`: somente limites básicos e proteção do produto.

### Evidência e tempo

Datas de criação, decisão e conclusão são produzidas pelo servidor. Uma conclusão de missão exige `workouts` persistido, mesmo usuário, sessão, modalidade, status concluído, ausência de rejeição e métrica mínima atingida. Repetições usam claims permanentes e não duplicam contagem.

## Catálogo de campos persistidos

`—` na coluna Unidade significa que o campo é categórico, identificador ou texto. Versão é herdada de `versions`, `ruleVersion` ou do valor explícito indicado.

| Documento.campo | Tipo | Unidade | Nulo? | Origem | Versão / significado exato |
|---|---|---:|:---:|---|---|
| raiz.`currentJourneyId` | string | — | sim | API | ID da jornada corrente; ausência significa nenhuma jornada selecionada |
| raiz.`updatedAt` | ISO-8601 string | instante UTC | não | servidor | Última troca do ponteiro da raiz |
| jornada.`id` | string | — | não | Firestore | ID imutável da jornada |
| jornada.`userId` | string | — | não | token autenticado | Dono da jornada; nunca vem do corpo da requisição |
| jornada.`status` | enum | — | não | engine/API | `active`, `paused`, `completed` ou `cancelled` |
| jornada.`goalType` | `GoalType` | — | não | resposta normalizada | Código estável do resultado desejado |
| jornada.`goalLabel` | string | — | não | Goal Engine | Texto curto apresentado ao usuário |
| jornada.`outcome.weightKg` | number | kg | sim | usuário + Goal Engine | Peso-alvo confirmado; não é promessa de prazo |
| jornada.`outcome.distanceKm` | number | km | sim | objetivo | Distância verificável do objetivo |
| jornada.`outcome.continuousMinutes` | number | min | sim | objetivo | Tempo contínuo-alvo quando aplicável |
| jornada.`behavior` | `Prescription` | — | não | Mission/Progression Engine | Prescrição vigente usada para criar a próxima semana |
| jornada.`baselineId` | string | — | não | servidor | Referência ao snapshot inicial imutável |
| jornada.`createdAt` | ISO-8601 string | instante UTC | não | servidor | Criação da jornada |
| jornada.`updatedAt` | ISO-8601 string | instante UTC | não | servidor | Última transição persistida |
| jornada.`weekStartedAt` | ISO-8601 string | instante UTC | não | servidor | Início da janela semanal vigente |
| jornada.`currentWeek` | integer | semana ordinal | não | Weekly Review Engine | Semana atual, iniciando em 1 |
| jornada.`totalCompleted` | integer | missões | não | atividade verificada | Total cumulativo, idempotente, de missões concluídas |
| jornada.`habitConfidence` | integer | 0–100 | não | Habit Confidence Engine | Indicador de consistência do produto; não diagnóstico |
| jornada.`consolidated` | boolean | — | não | Habit Confidence Engine | Evidência conservadora de base consistente, nunca regra fixa de 21 dias |
| jornada.`availableDays[]` | integer[] | 0=domingo…6=sábado | não | usuário/perfil | Dias civis em que a missão pode ser criada |
| jornada.`timeZone` | IANA string | — | não | dispositivo | Zona usada para datas civis e vencimento semanal |
| jornada.`habit` | `HabitIntervention` | — | não | Habit Engine | Único foco comportamental vigente |
| jornada.`safety` | `SafetyAnswers` | — | não | usuário | Última triagem usada para bloquear/permitir a jornada |
| jornada.`completedAt` | ISO-8601 string | instante UTC | sim | servidor | Momento em que um resultado verificável encerrou o objetivo |
| jornada.`versions.*` | string map | — | não | código | Versões exatas de goal, readiness, mission, progression, habit, weekly review, confidence, next level e safety |
| baseline.`id` | string | — | não | servidor | Sempre `initial` nesta versão |
| baseline.`capturedAt` | ISO-8601 string | instante UTC | não | servidor | Momento do snapshot |
| baseline.`profile` | `ProfileSnapshot` | — | não | perfil/saúde/histórico | Mínimo necessário do contexto existente |
| baseline.`answers` | `ObjectiveAnswers` | — | não | onboarding | Respostas confirmadas que efetivamente alteram a jornada |
| baseline.`startingWeightKg` | number | kg | sim | confirmação do usuário | Peso inicial histórico; nunca sobrescrito |
| baseline.`readinessLevel` | integer | 0–5 | não | Readiness Engine | Capacidade autorrelatada; não equivale a liberação médica |
| perfil.`capturedAt` | ISO-8601 string | instante UTC | não | servidor | Momento da leitura do perfil |
| perfil.`weightKg` | number | kg | sim | saúde/perfil | Sugestão mais recente, sempre confirmável no onboarding |
| perfil.`heightCm` | number | cm | sim | perfil | Altura usada apenas em proteção básica do objetivo de peso |
| perfil.`ageYears` | integer | anos completos | sim | data de nascimento | Idade calculada no snapshot; a jornada exige adulto nesta versão |
| perfil.`strengthDays[]` | integer[] | 0–6 | não | plano ativo | Dias de musculação deduplicados |
| perfil.`source` | literal `users` | — | não | API | Indica o documento-base do perfil |
| perfil.`planId` | string | — | sim | plano ativo | Plano de musculação consultado; nunca modificado |
| perfil.`recentCardioSessions` | integer | sessões/28 dias | sim | `workouts` | `null` significa consulta indisponível, não zero atividade |
| perfil.`recentLongestRunKm` | number | km/28 dias | sim | `workouts` | Maior corrida elegível na janela limitada |
| perfil.`weightSource` | enum | — | sim | saúde/perfil | `apple_health`, `health_connect` ou `profile` |
| perfil.`weightMeasuredAt` | ISO-8601 string | instante UTC | sim | origem da pesagem | Hora real da medição sugerida |
| perfil.`weightSourceId` | string | — | sim | `health_samples` | Rastreabilidade da amostra sem copiá-la inteira |
| perfil.`historyStatus` | enum | — | sim | API | `available` ou `unavailable`; distingue desconhecido de zero |
| perfil.`historyWindowDays` | integer | dias | sim | código | Janela de histórico consultada; 28 nesta versão |
| respostas.`goalType` | `GoalType` | — | não | usuário | Objetivo selecionado |
| respostas.`otherGoal` | string | — | condicional | usuário | Frase curta apenas para objetivo `other` |
| respostas.`walkingMinutes` | enum number | min | não | usuário | Faixa representada por 5, 15, 30 ou 45 |
| respostas.`runningAbility` | enum | — | não | usuário | `none`, `seconds`, `minutes`, `regular` ou `structured` |
| respostas.`availableMinutes` | enum number | min/sessão | não | usuário | Limite realista informado para cada atividade |
| respostas.`availableDays[]` | integer[] | 0–6 | não | usuário/perfil | Pelo menos um dia escolhido |
| respostas.`timeZone` | IANA string | — | não | dispositivo | Zona validada para agenda civil |
| respostas.`preferredMoment` | enum | — | não | usuário/objetivo | Momento preferido em relação à rotina |
| respostas.`preferredActivity` | `Modality` | — | não | usuário | Modalidade inicial preferida |
| respostas.`barrier` | `Barrier` | — | não | usuário | Principal obstáculo usado no primeiro ajuste |
| respostas.`confidenceScore` | integer | 0–10 | não | usuário | Confiança subjetiva antes da primeira semana |
| respostas.`weightConfirmed` | boolean | — | condicional | usuário | Confirma que o peso apresentado ou digitado é atual |
| respostas.`currentWeightKg` | number | kg | condicional | usuário | Obrigatório somente para `lose_weight` |
| respostas.`loseKg` | number | kg | condicional | usuário | Quantidade desejada, sem prazo prometido |
| respostas.`targetDistanceKm` | number | km | condicional | usuário | Distância de prova ou objetivo expansível |
| respostas.`targetContinuousMinutes` | number | min | sim | objetivo futuro | Tempo contínuo verificável quando usado |
| respostas.`safety` | `SafetyAnswers` | — | não | usuário | Triagem determinística curta |
| respostas.`nutrition` | `NutritionAnswers` | — | condicional | usuário | Apenas em perda de peso; hábitos gerais, não dieta |
| respostas.`productConsent` | literal `true` | — | não | consentimento explícito | Autoriza somente operação desta jornada |
| segurança.`screened` | boolean | — | não | usuário | Confirma que a pergunta foi respondida |
| segurança.`signals[]` | `SafetySignal[]` | — | não | usuário | Sinais que acionam proteção determinística |
| segurança.`medicalClearance` | boolean | — | sim | usuário | Declaração de liberação no retorno; ausência nunca é presumida como sim |
| nutrição.`meals` | enum string | refeições/dia aproximadas | não | usuário | `2`, `3`, `4`, `5+` ou `variable` |
| nutrição.`frequencies.*` | enum map | frequência | sim | usuário | `rarely`, `weekly`, `daily` ou `multiple_daily` por hábito informado |
| nutrição.`hardestTime` | enum | — | não | usuário | Período percebido como mais difícil |
| missão.`id` | string | — | não | Mission Engine | ID determinístico por semana/posição; reagendamento recebe sufixo de data |
| missão.`journeyId` | string | — | não | servidor | Jornada proprietária |
| missão.`week` | integer | semana ordinal | não | Mission Engine | Semana para cálculo de adesão |
| missão.`goalType` | `GoalType` | — | não | jornada | Contexto do objetivo no momento da criação |
| missão.`localDate` | `YYYY-MM-DD` | data civil | não | Mission Engine | Dia planejado na zona da jornada |
| missão.`state` | `MissionState` | — | não | API | Estado controlado: locked/available/started/completed/skipped/failed/rescheduled |
| missão.`prescription` | `Prescription` | — | não | Mission Engine | Critério exato; oculto enquanto `locked` |
| missão.`context` | string | — | não | engine | Orientação curta e não clínica |
| missão.`ruleVersion` | string | — | não | código | Versão do Mission Engine que produziu a missão |
| missão.`createdAt` | ISO-8601 string | instante UTC | não | servidor | Criação original ou da substituta |
| missão.`startedAt` | ISO-8601 string | instante UTC | sim | sessão real | Início canônico usado contra replay |
| missão.`completedAt` | ISO-8601 string | instante UTC | sim | servidor | Conclusão validada; skip mantém nulo |
| missão.`sessionId` | string | — | sim | `active_sessions` | Sessão real reclamada uma única vez |
| missão.`activityId` | string | — | sim | `workouts` | Atividade persistida que cumpriu a missão |
| missão.`rescheduledAt` | ISO-8601 string | instante UTC | sim | servidor | Momento do reagendamento |
| missão.`rescheduledFromMissionId` | string | — | sim | API | Origem da missão substituta |
| missão.`rescheduledToMissionId` | string | — | sim | API | Destino preservado na missão antiga |
| prescrição.`modality` | `Modality` | — | não | engines/usuário | Modalidade que deve coincidir com a atividade real |
| prescrição.`targetMetric` | enum | — | não | Goal/Mission Engine | Único eixo verificável: `duration` ou `distance` |
| prescrição.`durationMinutes` | number | min | não | Progression Engine | Duração atual; não progride junto com distância |
| prescrição.`distanceKm` | number | km | sim | Progression Engine | Distância atual quando esse for o eixo |
| prescrição.`sessions` | integer | sessões/semana | não | Mission Engine | Frequência mantida enquanto outro eixo muda |
| prescrição.`intensity` | literal `easy` | talk test | não | Safety Engine | Esforço conversável, sem zonas clínicas |
| prescrição.`runSecondsPerInterval` | integer | s | não | Readiness Engine | Parte corrida do intervalo; zero quando não aplicável |
| prescrição.`walkSecondsPerInterval` | integer | s | não | Readiness Engine | Recuperação caminhando; zero quando não aplicável |
| revisão.`id` | string | — | não | servidor | `week_{n}`; impede duas decisões na mesma semana |
| revisão.`journeyId` | string | — | não | servidor | Jornada revisada |
| revisão.`week` | integer | semana ordinal | não | API | Deve coincidir com `currentWeek` |
| revisão.`createdAt` | ISO-8601 string | instante UTC | não | servidor | Momento da decisão |
| revisão.`completed` | integer | missões | não | banco | Missões concluídas automaticamente |
| revisão.`planned` | integer | missões | não | banco | Missões válidas planejadas na semana |
| revisão.`adherence` | number | proporção 0–1 | não | Weekly Review Engine | `completed / planned`; zero apenas quando conhecido |
| revisão.`answers` | `WeeklyAnswers` | — | não | usuário | Somente percepções não inferíveis |
| revisão.`before` | `Prescription` | — | não | jornada | Estado anterior, preservado para reconstrução |
| revisão.`after` | `Prescription` | — | não | Weekly Review Engine | Estado decidido, alterando no máximo um eixo |
| revisão.`decision` | enum | — | não | Weekly Review Engine | `maintain`, `progress`, `regress` ou `pause` |
| revisão.`reason` | string | — | não | engine | Explicação determinística canônica |
| revisão.`habitConfidence` | integer | 0–100 | não | Habit Confidence Engine | Pontuação após incluir esta revisão |
| revisão.`plateau` | enum | — | não | Weight Trend Engine | insufficient/none/observe/investigate/persistent |
| revisão.`versions.*` | string map | — | não | código | Versões exatas usadas na decisão |
| check-in.`difficulty` | enum | — | não | usuário | Dificuldade percebida |
| check-in.`energy` | enum | — | não | usuário | Energia percebida |
| check-in.`confidenceScore` | integer | 0–10 | não | usuário | Confiança para a semana seguinte |
| check-in.`hunger` | enum | — | sim | usuário | Perguntado somente quando peso é relevante |
| check-in.`habitAdherence` | enum | — | não | usuário | `yes`, `partly` ou `no` para o único foco semanal |
| check-in.`barrier` | `Barrier` | — | não | usuário | Obstáculo percebido na semana |
| check-in.`safety` | `SafetyAnswers` | — | não | usuário | Nova triagem antes de progredir |
| check-in.`weightKg` | number | kg | sim | usuário | Correção manual opcional; saúde confiável sincronizada tem uso automático quando ausente |
| peso.`id` | string | — | não | servidor | `initial` ou `week_{n}` |
| peso.`kg` | number | kg | não | usuário/saúde | Valor validado entre 30 e 350 |
| peso.`measuredAt` | ISO-8601 string | instante UTC | não | origem | Hora da medição, distinta da gravação |
| peso.`recordedAt` | ISO-8601 string | instante UTC | não | servidor | Hora em que entrou na jornada |
| peso.`source` | enum | — | não | origem | confirmed_profile/manual/apple_health/health_connect |
| peso.`sourceId` | string | — | sim | origem | ID da amostra de saúde quando houver |
| intervenção.`id` | string | — | não | Habit Engine | ID imutável do foco |
| intervenção.`target` | enum | — | não | Habit Engine | Um hábito alimentar permitido ou `routine` |
| intervenção.`text` | string | — | não | engine | Pequena ação não clínica e não culpabilizante |
| intervenção.`createdAt` | ISO-8601 string | instante UTC | não | servidor | Início do foco |
| intervenção.`ruleVersion` | string | — | não | código | Versão do Habit Engine |
| conquista.`id` | string | — | não | engine | ID determinístico para idempotência |
| conquista.`journeyId` | string | — | não | servidor | Jornada que produziu a conquista |
| conquista.`label` | string | — | não | engine | Nome mostrado ao usuário |
| conquista.`createdAt` | ISO-8601 string | instante UTC | não | servidor | Momento em que a evidência foi atingida |
| conquista.`evidence` | map escalar | — | não | atividade/revisão | Referências e números mínimos que justificam a conquista |
| conquista.`version` | string | — | não | código | Regra de conquista/Next Level vigente |
| evento.`id` | string | — | não | servidor | UUID ou chave determinística da transição |
| evento.`journeyId` | string | — | não | servidor | Jornada proprietária |
| evento.`type` | string | — | não | API/engine | Transição semântica registrada |
| evento.`occurredAt` | ISO-8601 string | instante UTC | não | servidor | Hora confiável do evento |
| evento.`entityId` | string | — | não | API | Jornada, missão, revisão ou conquista afetada |
| evento.`details` | map escalar | — | não | engine | Contexto mínimo, sem histórico bruto |
| evento.`version` | literal | — | não | código | `JOURNEY_EVENT_V1` |
| evento.`engineVersions` | string map | — | não | código | Regras disponíveis no momento da transição |
| consentimento-produto.`grantedAt` | ISO-8601 string | instante UTC | não | servidor após aceite | Registro da concessão operacional |
| consentimento-produto.`purpose` | literal | — | não | código | `product_operation` |
| consentimento-produto.`version` | literal | — | não | código | `PRODUCT_CONSENT_V1` |
| consentimento-produto.`researchConsent` | literal false | — | não | código | Impede inferir consentimento de pesquisa |
| consentimento-produto.`professionalSharing` | literal false | — | não | código | Impede compartilhamento profissional implícito |
| claim.`journeyId` | string | — | não | servidor | Jornada que consumiu a identidade canônica |
| claim.`missionId` | string | — | não | servidor | Missão que consumiu a identidade canônica |
| claim.`createdAt` | ISO-8601 string | instante UTC | não | servidor | Hora da reclamação permanente |
| session-claim.`recoveredFromActivityId` | string | — | sim | recuperação | Atividade que permitiu recuperar um vínculo atrasado |

## Contratos futuros não ativos

`ProfessionalUnlock` contém `kind`, `eligibleAt`, `status=COMING_SOON`, `partnerId=null`, `canBook=false`, `canShare=false`, `reason` e `version`. `ProfessionalConsent` prevê profissional, campos permitidos, finalidade, concessão e revogação; não é criado enquanto não houver parceiro. `ProfessionalFollowup` prevê observações em 30/60/90 dias com `outcomeIsCausal=false`. `ResearchConsent` é separado e não existe por padrão. `BenchmarkProvider` recebe apenas coorte agregada (`goalType`, `readinessLevel`) e retorna somente amostra observacional; nenhuma recomendação populacional está ativa.

## Privacidade e usos futuros

- Dados brutos de saúde e histórico completo não são copiados para a jornada.
- A Home recebe somente um resumo compacto da jornada e da próxima missão já liberada.
- A Invictus IA recebe somente o resumo da última decisão semanal e pode explicar o texto. Ela não recebe o histórico bruto e não pode alterar decisões, números ou segurança; indisponibilidade usa a explicação determinística.
- Parceiros permanecem `COMING_SOON`, sem agenda, preço, benefício, parceiro fictício ou compartilhamento.
- Compartilhamento profissional futuro exige finalidade, campos, versão, concessão e revogação próprias.
- Consentimento de produto não vale como consentimento de pesquisa. Pesquisa futura deve ser separada, revogável e observacional, sem alegações causais.
- Nenhum conteúdo dessa estrutura substitui avaliação ou atendimento profissional.
