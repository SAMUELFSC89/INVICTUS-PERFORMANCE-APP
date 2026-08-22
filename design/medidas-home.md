# Home — medidas extraídas de `referencia-home.png`

Arte: **864 × 1536**, proporção 9:16, desenhada em **2x**.
Regra: **medida da arte ÷ 2 = px CSS**.

---

## Card de saudação

| item | arte (px) | CSS (px) | hoje no app |
|---|---|---|---|
| topo | y 334 | 167 | ~68 |
| base | y 587 | 293,5 | — |
| altura | 253 | **126,5** | — |
| borda esquerda | x 125 → 101 | 62,5 → 50,5 | vertical |
| borda direita | x 755 → 724 | 377,5 → 362 | vertical |
| espessura da linha | 1 | **0,5** | 1 |
| cor da linha | — | **#F1BE22** | #F5A623 a 35% |

### A moldura é um paralelogramo

As duas bordas laterais inclinam **para a esquerda conforme descem**, no mesmo
sentido e em ângulo praticamente igual:

- esquerda: −24 px em 110 px → 0,218 → **12,3°** da vertical
- direita: −31 px em 160 px → 0,194 → **11,0°** da vertical

Não é canto chanfrado, é o card inteiro inclinado — cerca de **11,5°**.

**O conteúdo NÃO acompanha a inclinação.** "BOA NOITE," e "SAMUEL" estão
perfeitamente na horizontal. Então `transform: skewX()` no container está
descartado: ele inclinaria o texto junto.

Caminho correto: desenhar a moldura como polígono — `clip-path` em duas camadas
(externa dourada, interna escura recuada 0,5px), ou um `path` de SVG ao fundo.

### A linha fina

**0,5 px CSS**, ou seja 1 pixel físico em tela 2x. É um fio de verdade, e está
em dourado quase cheio (#F1BE22).

Confirma o diagnóstico: fino **e** forte. O app fazia 1px a 35% de opacidade —
o dobro da espessura com um terço da cor, que é a receita do traço sujo.

---

## Barra de progresso

| item | arte | CSS | hoje |
|---|---|---|---|
| altura | 16 | **8** | 10 |

Gradiente amostrado no preenchimento:

| posição | cor |
|---|---|
| 0% | `#E39607` |
| 20% | `#F89602` |
| 40% | `#FEC604` |
| 100% | `#F4D101` |

Laranja quente abrindo para amarelo forte. O `#C8791A` que estava no app é
dourado amarronzado — outro material.

---

## Card da Liga

| item | arte | CSS |
|---|---|---|
| largura | 788 | 394 |
| altura | 307 | **153,5** |
| topo | y 754 | 377 |
| base | y 1060 | 530 |

Confere com o cálculo feito antes da medição (~157). O troféu ocupa 37,6% da
largura e ~89% da altura → **120 × 140 CSS**, sangrando ~10px no padding
vertical. O card não precisa crescer.

---

## Margens e ritmo vertical

- margem lateral: 36 na arte = **18 CSS**
- card de saudação começa a **21,7%** da altura da tela
- capacete do topo: y 19 → ~130 na arte = **9,5 → 65 CSS**

O respiro do topo é o que deixa o espartano aparecer. Hoje o app começa o
conteúdo a ~68px; a arte começa a 167px.

---

## Diferenças de cor

| onde | arte | app |
|---|---|---|
| linha do card | `#F1BE22` | `#F5A623` |
| início da barra | `#E39607` | `#C8791A` |
| fim da barra | `#F4D101` | `#FFD65A` |

O dourado da arte é mais **amarelo**; o do app puxa mais para o âmbar.
