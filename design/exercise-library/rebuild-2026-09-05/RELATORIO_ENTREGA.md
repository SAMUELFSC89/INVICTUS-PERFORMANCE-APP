# Entrega exclusiva dos exercícios

Base real: `1181433d85da9a389772c70a94a52a4e662e6225`. Este pacote contém apenas a reconstrução do catálogo, biblioteca visual e integração dos exercícios. Não inclui o antigo pacote de Saúde ou relatório.

## Entrega

- 59 exercícios: 27 IDs, nomes e equipamentos legados preservados e 32 adicionados.
- 59 thumbnails vinculadas: 32 novas, 14 refeitas e 13 imagens anteriores mantidas.
- 59 WebP lossless novos em pasta versionada; os 27 PNGs originais em `v1` permanecem intactos.
- Seis consumidores de imagem usam `contain`, margem interna e fallback. Os filtros incluem os seis grupos, bíceps e tríceps.
- A API usa o mesmo catálogo e os mesmos requisitos de equipamento; IDs desconhecidos e exercícios incompatíveis em resposta da IA são rejeitados com 422, sem apagar exercícios silenciosamente.
- 59 vídeos continuam pendentes. `DEMOS_PENDENTES.json` é uma fila de produção, não vídeos ou roteiros profissionalmente aprovados.

## Imagens e limites

O fundo preto opaco foi autorizado pelo usuário. As imagens novas têm pequenas variações próximas do preto; não se trata de transparência. As imagens são ilustrações estáticas de identificação. Não certificam técnica, trajetória, amplitude nem segurança de uma execução.

As 46 imagens produzidas foram inspecionadas estaticamente. Há margens menores que a meta de 8–12%, poses iniciais de Core, partes naturalmente ocultas pelo cabelo e sobreposição em perspectiva entre cabos e braços em Pallof/tríceps unilateral. A revisão independente não identificou fusão física clara que exigisse rejeição dessas duas thumbnails. Rosca concentrada e remada unilateral usam roupa preta com mangas e calça; preservam rosto e paleta, mas diferem do traje das demais. As ressalvas individuais estão em `generated-images-review.json` e `generation-audit/`.

Os 13 originais mantidos também foram inspecionados: nenhum corte de corpo foi observado. Três contêm corte de aparelho secundário ao fundo; `decline_push_up` mantém uma ponta da base do banco cortada, sem ocultar o apoio dos pés. Não afirmar que todas as 59 fontes têm todo o cenário/aparelho completo. `contain` evita novo recorte na interface e não recupera pixels ausentes nas fontes.

A troca histórica entre adutora e panturrilha no leg press foi considerada na geração: as novas imagens ficam na pasta do próprio ID correto. O ID `barbell_stiff_deadlift` continua representando halteres. Nenhum ID foi renomeado.

## Tamanho e integridade

As fontes selecionadas somam 61,570,434 bytes; os WebP somam 36,617,566 bytes. Redução de 40.53% ao servir estes WebP em lugar das fontes. Dimensões e todos os pixels RGBA foram comparados, com zero diferenças; cada arquivo final foi novamente validado após publicação atômica.

O ZIP leva os WebP de produção, sem duplicar os 46 novos PNGs gerados. Os pixels completos desses PNGs são preservados sem perda no WebP. Os 27 PNGs originais já existentes continuam no repositório e não são reenviados. Adicionar WebP ao projeto que preserva PNGs aumenta o conteúdo total empacotado; estes números não medem redução do APK.

## Validação desta reconstrução

- 154 testes em 26 suítes passaram na base atual; 32 deles cobrem catálogo/API/mídia adicionados nesta reconstrução.
- TypeScript, build web/servidor e lint das regras passaram. O lint configurado só cobre `firestore.rules` e `storage.rules`.
- 59 arquivos de mídia íntegros, exportação sincronizada e 27 originais conferidos por hash.
- O patch foi verificado em índice Git isolado contra a base indicada; binários são copiados separadamente conforme manifesto.
- Não foi executada inspeção do app em navegador, build nativo, teste em aparelho, carga, deploy ou revisão profissional de biomecânica nesta reconstrução. A prévia HTML do ZIP é um catálogo de arquivos, não prova de layout do aplicativo.

## Aplicação pelo Claude

Começar por `PROMPT_PARA_CLAUDE.txt` e `INSTRUCOES_PARA_CLAUDE.md` na raiz do ZIP. Aplicar `SOMENTE_EXERCICIOS.patch` após `git apply --check`, e copiar todos os binários indicados no manifesto. Caso os arquivos atuais contenham mudanças posteriores de Saúde, diário, sensores ou batimentos, integrar somente os trechos do diff dos exercícios. Não substituir arquivos compartilhados inteiros por versões de referência antigas.
