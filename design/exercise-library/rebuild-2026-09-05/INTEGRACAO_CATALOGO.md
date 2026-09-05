# Integração do catálogo de exercícios

Base auditada: `1181433d85da9a389772c70a94a52a4e662e6225` do repositório INVICTUS-PERFORMANCE-APP. Este conjunto altera o catálogo e sua integração com treinos. As instruções gerais do ZIP determinam quais diferenças aplicar na versão atual do projeto.

## O que foi corrigido

- O catálogo passa de 27 para 59 IDs: 8 de Peito, 10 de Costas, 17 de Pernas, 7 de Ombros, 10 de Braços e 7 de Core. Braços contém 5 exercícios de bíceps e 5 de tríceps.
- Os 27 IDs, nomes, grupos e descrições de equipamento existentes foram preservados. A exportação `OFFICIAL_EXERCISES_BATCH_01` e o mapa `OFFICIAL_EXERCISE_BY_ID` continuam disponíveis para os consumidores atuais.
- `src/data/exerciseCatalog.ts` concentra os requisitos de equipamento. O serviço local conserva `FALLBACK_REQUIREMENTS` como alias de compatibilidade, e o servidor passa a consultar a mesma tabela.
- O servidor antes reconhecia apenas 10 IDs e removia silenciosamente os demais do plano. Agora reconhece todos os 59; um ID desconhecido invalida o plano inteiro com HTTP 422 e `INVALID_PLAN`.
- A resposta de geração por IA também é validada contra os equipamentos selecionados. Um exercício oficial que exige uma categoria ausente não é aceito. URLs de imagem ou vídeo vindas da IA não entram no plano normalizado.
- Os arquivos originais da pasta `v1` permanecem preservados. Os novos caminhos são aditivos: `/assets/exercise-library/rebuild-2026-09-05/<id>/thumb.webp`. O estado de cada arquivo deve corresponder à sua existência e revisão real.

## Identidade e equipamentos

Não renomear `barbell_stiff_deadlift`. Embora o texto do ID contenha `barbell`, o repositório usa o nome “Stiff / Romanian Deadlift” e o equipamento **halteres**. Essa associação foi mantida.

Não há aliases inventados. Os 27 IDs legados já são canônicos; `legacy-id-map.json` é um mapa identidade para conferência, não uma migração do banco. `legacy-catalog-snapshot.json` registra os campos anteriores para detectar alterações acidentais.

As categorias usadas são as do questionário existente: `barra_anilhas`, `halteres`, `maquinas`, `kettlebell`, `barra_fixa`, `elasticos`, `banco` e `crossover`. Todos os itens de uma linha de requisitos precisam estar selecionados. IDs desconhecidos e linhas de requisitos ausentes retornam incompatibilidade; não devem virar exercícios sem equipamento por um fallback `|| []`.

O questionário ainda coleta categorias amplas. A seleção de `maquinas` não confirma que existe um Graviton, um Hack ou cada outra máquina da lista; `crossover` não confirma todas as regulagens e puxadores. O nome e a descrição do exercício continuam explicitando o equipamento real. Essa é uma limitação do inventário atual, não uma validação física da academia. Uma próxima evolução pode detalhar os aparelhos e acessórios disponíveis sem alterar os IDs dos exercícios.

Os requisitos de equipamento dos exercícios legados foram mantidos para compatibilidade. Por exemplo, o agachamento livre continua categorizado em `barra_anilhas`; a descrição “barra e rack” explicita que também exige um suporte adequado. A nova biblioteca não amplia a promessa de segurança do gerador.

## Imagens e execução

O fundo preto foi autorizado pelo usuário. Não remover o fundo nem sobrescrever as imagens originais durante a integração. `thumbFallbackUrl`, quando presente, deve apontar somente para uma alternativa local verificada.

Nenhum vídeo foi produzido neste pacote. Os 59 registros usam `demoStatus: 'waiting_for_demo'`, sem `demoUrl` inventada. `demoLoop` é opcional e só deve ser ativado para um vídeo real preparado e revisado para repetição. Uma imagem estática não representa todas as fases do movimento nem comprova validação biomecânica profissional.

Os estados finais e eventuais ressalvas visuais estão no catálogo exportado e no relatório de mídia do pacote. O integrador não deve alterar `waiting_for_thumb` para `ready` sem um arquivo real revisado.

## Verificação reproduzível

Após instalar as dependências já previstas no repositório:

```bash
node --import tsx scripts/export-exercise-catalog.mjs
node --import tsx scripts/sync-exercise-asset-manifest.ts
node --import tsx scripts/export-exercise-catalog.mjs --check
node --import tsx scripts/sync-exercise-asset-manifest.ts --check
node node_modules/jest/bin/jest.js --runInBand src/tests/exerciseCatalog.test.ts api/__tests__/training-plans-catalog.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

O exportador gera Markdown, CSV com BOM UTF-8 e separador ponto e vírgula, JSON e o mapa dos IDs legados a partir da fonte TypeScript. Os testes verificam IDs, compatibilidade legada, requisitos, existência de imagens marcadas como prontas, ausência de vídeos inventados e aceitação/rejeição real de planos pelo endpoint.

Para reconstruir os WebP a partir dos PNG aprovados, use `scripts/build-exercise-webp.py --source-dir <pasta-dos-png> --require-complete`. Os PNG dessa pasta devem ter nomes `<id>.png`. O script permite reaproveitar somente os 13 originais explicitamente listados em `LEGACY_SEEDS`; os outros 46 IDs exigem uma fonte nessa pasta. A ausência de uma imagem gerada não autoriza usar um original com enquadramento, fundo ou associação inadequados.

Esse conversor exige ImageMagick e Pillow. ImageMagick faz apenas a conversão de formato com WebP lossless; Pillow apenas inspeciona metadados e compara os bytes RGBA. O script não recorta, redimensiona ou remove fundos. Ele valida o arquivo candidato antes de substituí-lo atomicamente, verifica novamente o caminho publicado e reaproveita um WebP existente somente quando os pixels continuam idênticos. O relatório `media-build.json` registra hashes, dimensões, bytes, comparação e eventuais falhas; uma execução parcial não equivale à biblioteca completa. O script não altera estados do catálogo nem aprova conteúdo biomecânico.

Não foram alteradas regras de séries, repetições, descanso, progressão, competição, assinatura, Saúde ou relatório neste conjunto de mudanças. A ampliação do catálogo não certifica um plano individual nem substitui a revisão dos exercícios escolhidos para o atleta.
