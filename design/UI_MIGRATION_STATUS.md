# Migração visual Invictus

Este arquivo é o controle único da migração para o novo sistema visual. Uma rota
só pode ser marcada como concluída depois de: visual novo, dados reais,
navegação funcional, responsividade e ausência de acesso ao visual substituído.

## Assets aprovados para preservação

- `public/ranking-frame-gold-reference.png`
- `public/ranking-frame-silver-reference.png`
- `public/ranking-frame-bronze-reference.png`
- `public/capacete.webp` (logo oficial otimizada usada na interface)
- `public/capacete.png` (fonte oficial em alta resolução/fallback)

As três molduras do Top 1, Top 2 e Top 3 e a logo oficial foram aprovadas
explicitamente e devem ser mantidas nas novas telas.

## Rotas principais

| Rota | Estado | Observação |
| --- | --- | --- |
| `/` | Em revisão | Home nova; asset principal ainda pendente |
| `/musculacao` | Em revisão | Hub e criadores novos; validar fluxo inteiro |
| `/challenges` | Em revisão | Hub novo, missões reais, destaque Power Lift e histórico em shell novo |
| `/power` | Em revisão | CSS único novo em todos os estados; upload, IA fail-closed, auditoria e vídeos preservados |
| `/championships` | Em revisão | Hub, comunidade, prévias e saída do campeonato free para Musculação/Cardio novos |
| `/profile` | Em revisão | Perfil novo com dados reais |
| `/store` | Em revisão | Catálogo vazio; Coin não sacável |
| `/rankings` | Em revisão | Preservar molduras aprovadas do Top 3 |

## Rotas secundárias a migrar

- `/notifications` — shell novo integrado ao sino; somente dados reais
- `/league` e `/league/inscricao` — fluxo antigo encerrado e redirecionado para Campeonatos
- `/profile/:userId`
- `/profile/academy` e subfluxos — shell visual novo; funções preservadas
- `/profile/wearables` — shell visual novo; integrações nativas preservadas
- `/profile/wallet` — shell visual novo; carteira financeira separada dos Invictus Coins
- `/profile/goals` — shell visual novo
- `/profile/security` — shell visual novo
- `/profile/preferences` e documentos — shell visual novo, termos/FAQ/jogo/admin preservados
- `/championships/my` e `/championships/my/:id` — redirecionadas para o campeonato social novo; telas legadas sem acesso
- `/achievements`
- `/performance`
- `/health`, `/health/report` e `/health/report/full`
- telas de retorno de pagamento

As rotas administrativas usam um shell próprio de operação e serão tratadas
depois das rotas do atleta, sem misturar dados administrativos com a UI pública.
