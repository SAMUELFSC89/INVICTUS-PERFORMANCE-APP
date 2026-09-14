# Pódio Top 1 — luz ampliada

Criado em 2026-09-13 com a habilidade imagegen, ferramenta integrada (sem CLI).

Asset aplicado: `public/assets/ranking/podium-top1-glow-v2.png` (800 × 400).
Referência: `public/assets/ranking/podium-top1.webp`, preservada sem alteração.

A ferramenta retornou fundo quadriculado na primeira edição. A segunda edição trocou esse fundo por preto puro. O componente usa composição CSS `screen` para integrar a luz ao fundo escuro, sem afirmar que o PNG possui transparência real. O arquivo final foi somente reduzido, sem cortar a arte.

## Prompt inicial

```text
Use case: precise-object-edit
Asset type: first-place podium base for the Invictus fitness ranking mobile app.
Input image 1: reference and edit target, the existing small black marble podium with gold trim and INVICTUS lettering.
Recreate this SAME first-place pedestal at high resolution with a substantially more prominent, wider and taller black marble body, polished gold rims, elegant gold laurels on both sides of the front word "INVICTUS". Keep the same straight-on slightly elevated viewpoint and oval top.
Upgrade the golden lighting: brighter luminous top and bottom rims, a much broader warm golden halo underneath and around the sides, beautiful larger soft golden light flares rising just behind the two outer edges. Preserve sharp readable marble body, gold details and word INVICTUS. Luxury sports champion visual, not fireworks.
Composition: landscape 2:1 image; entire pedestal and all major glow visible, pedestal body occupies approximately 85% of image width and 45% of image height, centered in lower-middle. Compact safe margins, no vast empty square canvas. No crown, athlete, number, scene, stage or extra text. Outside the podium and its soft semi-transparent gold light must be a genuinely transparent alpha background. Deliver an isolated cutout suitable to place on a nearly black UI. Preserve INVICTUS exactly.
```

## Ajuste do fundo

```text
Edit target: this newly recreated first-place Invictus podium. Replace ONLY the gray checkered background with solid pure black (#000000). The gold halo and larger rising side lights must smoothly fade all the way to pure black. Preserve the entire black marble podium, front INVICTUS word, gold laurels and gold rims exactly, with the same dimensions and framing. No checkerboard and no gray pixels in the background. Keep all the golden lighting and full uncropped silhouette. This will be composited over a black app interface.
```

