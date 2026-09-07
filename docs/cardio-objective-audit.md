# Buscar Objetivo — auditoria e plano de integração

Base auditada: `8f4d42d` (main). Branch independente dos lotes de thumbnails.

## Implementação atual

- Cardio: `/challenges/cardio` → `Challenges` → `ChallengeActivityFlow` → `activityService`. Reutilizar esse rastreamento, notificações, retomada e finalização; não criar outro GPS ou cronômetro.
- Atividades: `workouts` é o histórico canônico; `active_sessions` e políticas de atividade têm identidade de sessão. A jornada deve consumir resultados persistidos, nunca duração/distância declaradas no pedido de conclusão. Não modificar antifraude, IGA, campeonatos ou pagamentos.
- Hábitos legados: os documentos `habit_goals` foram preservados como histórico, sem migração ou exclusão silenciosa. O motor e sua integração foram retirados e `/api/habits` é somente um tombstone autenticado com resposta 410.
- Perfil/onboarding: `UserContext`, `users/{uid}`, `/api/profile?action=onboard`. Peso/altura/data de nascimento já existem; confirmação de peso necessária. Não alterar autenticação/cadastro.
- Musculação: `training_plans` e memória privada em `src/core/training`. Apenas leitura do calendário de plano atual quando confiável; não modificar nem enviar memória ao modelo.
- Saúde: `health_samples` contém medições individuais com timestamp, origem e confiança. Reutilizar peso confiável como sugestão confirmável; não duplicar toda a base biométrica, não usar calorias estimadas para prometer emagrecimento.
- Gemini: configuração e logger centralizados; camada antiga usa mensagens opcionais. Nova jornada deve funcionar integralmente sem IA; modelo nunca decide progressão, triagem ou liberação profissional.
- UI: shell interno preto/grafite, componentes existentes, rotas sob `/challenges` evitam menu legado. Uma pergunta por etapa; sem aba principal nova.
- Persistência: Admin SDK autenticado em handlers do router Express; arquivos ESM usam sufixo `.js`. Regras Firestore precisam bloquear escrita direta de decisões e impedir leitura entre usuários.

## Ordem de trabalho

1. Contratos versionados, dicionário e motores puros com testes.
2. Persistência transacional, eventos imutáveis, medições separadas, acesso privado e paginação.
3. Onboarding condicional e jornada mobile; integração com sessão real e reconciliação idempotente.
4. Revisão semanal, conquistas, proteção e infraestrutura profissional inativa.
5. Testes completos, revisão visual/mobile e PR separada.

## Checkpoint de implementação — 2026-09-07

Implementado: cadastro condicional em etapas curtas, API privada, baseline separado, missões semanais, revisão determinística, consentimento operacional, parceiros inativos, início vinculado à sessão real de Cardio, tentativa limitada para sincronização inicial, conclusão por atividade persistida e recuperação transacional quando a publicação inicial da sessão atrasa. Há progressão separada por duração ou distância, encerramento por resultado verificável, reagendamento com histórico, adaptação conservadora de platô, conquistas idempotentes, explicação opcional da IA com fallback determinístico, resumo compacto na Home, histórico paginado e novo objetivo após encerramento. API antiga responde 410 sem apagar dados.

Validação final local: `typecheck`, `lint`, 91 suítes / 961 testes, inicialização ESM serverless, grafo ESM do catálogo e build de produção passaram. Os 38 testes direcionados cobrem engines, API, regras privadas, peso sincronizado e aposentadoria do fluxo legado. A rota foi percorrida pelo login real em viewport de 390 × 844: Home → Cardio → Buscar Objetivo; não houve estouro horizontal nem erro de console da nova função. Sem credencial Firebase Admin no servidor local, a API privada exibiu o fallback controlado em português com ação de nova tentativa, como esperado.

Validação ainda recomendada após deploy: testar em iOS/Android a retomada e a sincronização das duas conclusões reais (direta e presença) com Firebase Admin configurado. Isso depende do runtime nativo e do ambiente implantado, não é substituído pelo navegador local. A integração não altera os motores protegidos de pontuação, pagamento, musculação ou campeonato.

## Override de produto confirmado pelo proprietário

Atualização: proprietário autorizou excluir o fluxo legado. Removidos motor, integração e mutações antigas; `/api/habits` permanece apenas como resposta 410 para versões instaladas. Nenhum documento `habit_goals` é apagado. Pontuação/validação de atividade permanecem intactas; apenas o efeito colateral de progresso legado foi retirado.

Não existem parceiros. Tipos de profissional e critérios de evolução podem ser preparados, mas consultas, descontos, agendamentos e compartilhamento permanecem indisponíveis. `COMING_SOON` não é uma oferta conquistada. Conquistas reais de consistência são independentes de oferta comercial. Não inventar profissional, preço, desconto ou consentimento. Encaminhamento por segurança não é indicação de parceiro.

## Segurança e evidência

Regras numéricas iniciais são limites conservadores do produto, versionados, não protocolos clínicos validados nem predição de perda de peso. Ausência de sintomas não equivale a aptidão médica. Retorno cirúrgico sem liberação e sintomas de alerta bloqueiam progressão; não aguardar parceiros para orientar avaliação externa. Pós-bariátrica não recebe intervenção alimentar automática.

Referências consultadas em 2026-09-07:

- CDC: [intensidade pelo teste da fala](https://www.cdc.gov/physical-activity-basics/measuring/index.html).
- NIDDK: [mudança gradual de hábitos e retomada](https://www.niddk.nih.gov/health-information/diet-nutrition/changing-habits-better-health).
- NIDDK: [seguimento após cirurgia bariátrica](https://www.niddk.nih.gov/health-information/weight-management/bariatric-surgery/definition-facts).

Resultados observacionais não demonstram causalidade. Dados operacionais não autorizam pesquisa; futuras análises exigem separação e consentimento próprio. Nenhum histórico bruto deve ser enviado à IA ou parceiros.
