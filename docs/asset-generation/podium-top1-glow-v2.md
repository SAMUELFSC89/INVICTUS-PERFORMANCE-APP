# Pódio Top 1 — asset aprovado

O asset usado pelo ranking permanece em `public/assets/ranking/podium-top1-glow-v2.png` para preservar o contrato do app e evitar troca de caminho.

Em 2026-09-17, a arte anterior de 800 × 400 com fundo preto foi substituída, sem recompressão, pelo PNG aprovado enviado pelo usuário:

- dimensões: 1254 × 1254;
- formato: PNG RGBA;
- fundo: transparência alpha real;
- identidade preservada: base preta, acabamento dourado, louros e palavra `INVICTUS`;
- o arquivo é renderizado diretamente; não depende mais de `mix-blend-mode: screen` para esconder um fundo preto.

A referência histórica `public/assets/ranking/podium-top1.webp` permanece preservada sem alteração.

## Histórico

A versão de 2026-09-13 havia sido criada a partir da referência com halo ampliado. Como o arquivo final daquela rodada terminou com fundo preto, a interface utilizava composição CSS `screen` para integrá-lo ao fundo escuro.

Esse workaround deixou de ser necessário depois da substituição pelo PNG transparente aprovado em 2026-09-17.
