from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def replace_count(text: str, old: str, new: str, expected: int, label: str) -> str:
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} matches, found {count}")
    return text.replace(old, new)


# ---------------------------------------------------------------------------
# 1) Cardio finalizado -> editor de compartilhamento direto.
#    A tela de detalhe antiga permanece no Histórico e em musculação.
# ---------------------------------------------------------------------------
challenges_path = Path("src/pages/Challenges.tsx")
challenges = challenges_path.read_text()

challenges = replace_count(
    challenges,
    "              setFinishedActivityItem(finishedItem);",
    "              setFinishedActivityItem(finishedItem);\n"
    "              if (sessionType === 'cardio') {\n"
    "                setShareCardData(buildShareableFromItem(finishedItem));\n"
    "              }",
    2,
    "Challenges direct share after completion",
)

challenges = replace_once(
    challenges,
    "        <RunShareCard session={shareCardData} onClose={() => { setShareCardData(null); if (!finishedActivityItem) closeFlow(); }} />",
    "        <RunShareCard\n"
    "          session={shareCardData}\n"
    "          onClose={() => {\n"
    "            setShareCardData(null);\n"
    "            if (!finishedActivityItem || finishedActivityItem.type === 'cardio') closeFlow();\n"
    "          }}\n"
    "        />",
    "Challenges share close behavior",
)

challenges = replace_once(
    challenges,
    "      {finishedActivityItem && !shareCardData && (",
    "      {finishedActivityItem && !shareCardData && finishedActivityItem.type !== 'cardio' && (",
    "Challenges suppress legacy cardio detail",
)

challenges_path.write_text(challenges)


# ---------------------------------------------------------------------------
# 2) Editor gestual do card.
#    - frases movidas com 1 dedo
#    - pinça para redimensionar frases
#    - arrastar frase para zona de descarte para remover
#    - bloco logo + dados continua arrastável e ganha limite de pinça mais seguro
#    - preferências de frases e bloco de informações persistem localmente
# ---------------------------------------------------------------------------
card_path = Path("src/components/RunShareCard.tsx")
card = card_path.read_text()

card = replace_once(
    card,
    "  Share2,\n  X,",
    "  Share2,\n  Trash2,\n  X,",
    "RunShareCard Trash2 import",
)

card = replace_once(
    card,
    "type LayerTransform = { x: number; y: number; scale: number; rotation: number };\n"
    "type PointerPosition = { x: number; y: number };\n\n"
    "const DEFAULT_MAP_TRANSFORM: LayerTransform = { x: 0, y: 0, scale: 1, rotation: 0 };\n"
    "const DEFAULT_ROUTE_TRANSFORM: LayerTransform = { x: 0, y: 0, scale: 1, rotation: 0 };\n"
    "const DEFAULT_INFO_TRANSFORM: LayerTransform = { x: 0, y: 0, scale: 1, rotation: 0 };",
    "type LayerTransform = { x: number; y: number; scale: number; rotation: number };\n"
    "type PointerPosition = { x: number; y: number };\n"
    "type PhraseId = 'movement' | 'discipline';\n"
    "type PhraseLayer = {\n"
    "  id: PhraseId;\n"
    "  text: string;\n"
    "  transform: LayerTransform;\n"
    "  visible: boolean;\n"
    "};\n\n"
    "const DEFAULT_MAP_TRANSFORM: LayerTransform = { x: 0, y: 0, scale: 1, rotation: 0 };\n"
    "const DEFAULT_ROUTE_TRANSFORM: LayerTransform = { x: 0, y: 0, scale: 1, rotation: 0 };\n"
    "const DEFAULT_INFO_TRANSFORM: LayerTransform = { x: 0, y: 0, scale: 1, rotation: 0 };\n"
    "const DEFAULT_PHRASES: PhraseLayer[] = [\n"
    "  { id: 'movement', text: 'MAIS MOVIMENTO\\nMAIS VIDA', transform: { x: 0, y: 0, scale: 1, rotation: 0 }, visible: true },\n"
    "  { id: 'discipline', text: 'DISCIPLINA\\nCONSTRÓI LIBERDADE', transform: { x: 0, y: 0, scale: 1, rotation: 0 }, visible: true },\n"
    "];",
    "RunShareCard phrase types",
)

card = replace_once(
    card,
    '          stroke="#ff9d00"',
    '          stroke="#f3b324"',
    "RunShareCard route gold",
)

card = replace_once(
    card,
    "  const infoPointersRef = useRef(new Map<number, PointerPosition>());\n"
    "  const contentGestureRef = useRef<{",
    "  const infoPointersRef = useRef(new Map<number, PointerPosition>());\n"
    "  const phrasePointersRef = useRef(new Map<PhraseId, Map<number, PointerPosition>>());\n"
    "  const phraseGestureRef = useRef(new Map<PhraseId, {\n"
    "    transform: LayerTransform;\n"
    "    startX: number;\n"
    "    startY: number;\n"
    "    distance?: number;\n"
    "  }>());\n"
    "  const trashArmedRef = useRef<PhraseId | null>(null);\n"
    "  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);\n"
    "  const preferencesHydratedRef = useRef(false);\n"
    "  const contentGestureRef = useRef<{",
    "RunShareCard phrase refs",
)

card = replace_once(
    card,
    "  const [infoTransform, setInfoTransform] = useState(DEFAULT_INFO_TRANSFORM);\n"
    "  const [customizerOpen, setCustomizerOpen] = useState(false);",
    "  const [infoTransform, setInfoTransform] = useState(DEFAULT_INFO_TRANSFORM);\n"
    "  const [phrases, setPhrases] = useState<PhraseLayer[]>(() => DEFAULT_PHRASES.map((phrase) => ({ ...phrase, transform: { ...phrase.transform } })));\n"
    "  const [selectedPhraseId, setSelectedPhraseId] = useState<PhraseId | null>(null);\n"
    "  const [draggingPhraseId, setDraggingPhraseId] = useState<PhraseId | null>(null);\n"
    "  const [trashArmedPhraseId, setTrashArmedPhraseId] = useState<PhraseId | null>(null);\n"
    "  const [customizerOpen, setCustomizerOpen] = useState(false);",
    "RunShareCard phrase states",
)

card = replace_once(
    card,
    "  const currentMapImage = mapImages[mapCacheKey] ?? null;\n\n"
    "  useEffect(() => {\n"
    "    if (!hasRoute",
    "  const currentMapImage = mapImages[mapCacheKey] ?? null;\n"
    "  const preferencesKey = `invictus:share-card-layout:${auth.currentUser?.uid || 'local'}`;\n\n"
    "  useEffect(() => {\n"
    "    preferencesHydratedRef.current = false;\n"
    "    try {\n"
    "      const raw = localStorage.getItem(preferencesKey);\n"
    "      if (raw) {\n"
    "        const parsed = JSON.parse(raw);\n"
    "        if (parsed?.infoTransform) setInfoTransform({ ...DEFAULT_INFO_TRANSFORM, ...parsed.infoTransform });\n"
    "        if (Array.isArray(parsed?.phrases)) {\n"
    "          setPhrases(DEFAULT_PHRASES.map((fallback) => {\n"
    "            const saved = parsed.phrases.find((phrase: PhraseLayer) => phrase?.id === fallback.id);\n"
    "            return saved\n"
    "              ? { ...fallback, visible: saved.visible !== false, transform: { ...fallback.transform, ...saved.transform } }\n"
    "              : { ...fallback, transform: { ...fallback.transform } };\n"
    "          }));\n"
    "        }\n"
    "      }\n"
    "    } catch {\n"
    "      // Preferências locais são best effort; nunca podem bloquear o editor.\n"
    "    } finally {\n"
    "      queueMicrotask(() => { preferencesHydratedRef.current = true; });\n"
    "    }\n"
    "    return () => { if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current); };\n"
    "  }, [preferencesKey]);\n\n"
    "  useEffect(() => {\n"
    "    if (!preferencesHydratedRef.current) return;\n"
    "    try {\n"
    "      localStorage.setItem(preferencesKey, JSON.stringify({ infoTransform, phrases }));\n"
    "    } catch {\n"
    "      // Armazenamento indisponível não impede compartilhamento.\n"
    "    }\n"
    "  }, [infoTransform, phrases, preferencesKey]);\n\n"
    "  useEffect(() => {\n"
    "    if (!hasRoute",
    "RunShareCard preference persistence",
)

card = replace_once(
    card,
    "        scale: clampScale(start.transform.scale * (pointerDistance(pointers) / start.distance), 0.55, 1.8),",
    "        scale: clampScale(start.transform.scale * (pointerDistance(pointers) / start.distance), 0.55, 1.4),",
    "RunShareCard info pinch limits",
)

insert_before = "  const handlePhotoSelection = async (event: ChangeEvent<HTMLInputElement>, target: 'photo-map' | 'photo-route') => {"
phrase_handlers = r'''  const updatePhrase = useCallback((id: PhraseId, updater: (phrase: PhraseLayer) => PhraseLayer) => {
    setPhrases((current) => current.map((phrase) => phrase.id === id ? updater(phrase) : phrase));
  }, []);

  const schedulePhraseSelectionClear = useCallback((id: PhraseId) => {
    if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);
    setSelectedPhraseId(id);
    selectionTimerRef.current = setTimeout(() => {
      setSelectedPhraseId((current) => current === id ? null : current);
    }, 1100);
  }, []);

  const setTrashArmed = useCallback((id: PhraseId | null) => {
    trashArmedRef.current = id;
    setTrashArmedPhraseId(id);
  }, []);

  const startPhraseGesture = (id: PhraseId, event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);
    setSelectedPhraseId(id);
    setDraggingPhraseId(id);
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const pointerMap = phrasePointersRef.current.get(id) || new Map<number, PointerPosition>();
    pointerMap.set(event.pointerId, { x: event.clientX, y: event.clientY });
    phrasePointersRef.current.set(id, pointerMap);

    const phrase = phrases.find((candidate) => candidate.id === id);
    if (!phrase) return;
    const pointers = Array.from(pointerMap.values());
    phraseGestureRef.current.set(id, {
      transform: phrase.transform,
      startX: event.clientX,
      startY: event.clientY,
      ...(pointers.length === 2 ? { distance: pointerDistance(pointers) } : {}),
    });
  };

  const movePhraseGesture = (id: PhraseId, event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const pointerMap = phrasePointersRef.current.get(id);
    const gesture = phraseGestureRef.current.get(id);
    if (!pointerMap?.has(event.pointerId) || !gesture) return;

    pointerMap.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pointers = Array.from(pointerMap.values());

    if (pointers.length === 1) {
      updatePhrase(id, (phrase) => ({
        ...phrase,
        transform: {
          ...gesture.transform,
          x: gesture.transform.x + event.clientX - gesture.startX,
          y: gesture.transform.y + event.clientY - gesture.startY,
        },
      }));

      const rect = cardRef.current?.getBoundingClientRect();
      const armed = Boolean(rect && event.clientY >= rect.bottom - rect.height * 0.14);
      setTrashArmed(armed ? id : null);
      return;
    }

    if (pointers.length === 2 && gesture.distance) {
      updatePhrase(id, (phrase) => ({
        ...phrase,
        transform: {
          ...gesture.transform,
          scale: clampScale(gesture.transform.scale * (pointerDistance(pointers) / gesture.distance), 0.5, 1.7),
        },
      }));
      setTrashArmed(null);
    }
  };

  const endPhraseGesture = (id: PhraseId, event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const pointerMap = phrasePointersRef.current.get(id);
    pointerMap?.delete(event.pointerId);

    if (!pointerMap || pointerMap.size === 0) {
      if (trashArmedRef.current === id) {
        updatePhrase(id, (phrase) => ({ ...phrase, visible: false }));
      }
      phrasePointersRef.current.delete(id);
      phraseGestureRef.current.delete(id);
      setDraggingPhraseId(null);
      setTrashArmed(null);
      schedulePhraseSelectionClear(id);
      return;
    }

    const remaining = Array.from(pointerMap.values())[0];
    const phrase = phrases.find((candidate) => candidate.id === id);
    if (phrase) {
      phraseGestureRef.current.set(id, {
        transform: phrase.transform,
        startX: remaining.x,
        startY: remaining.y,
      });
    }
  };

  const restorePhrases = () => {
    setPhrases(DEFAULT_PHRASES.map((phrase) => ({
      ...phrase,
      transform: { ...phrase.transform },
      visible: true,
    })));
    setSelectedPhraseId(null);
    setDraggingPhraseId(null);
    setTrashArmed(null);
  };

'''
if card.count(insert_before) != 1:
    raise SystemExit("RunShareCard phrase handler insertion point not found uniquely")
card = card.replace(insert_before, phrase_handlers + insert_before, 1)

card = replace_once(
    card,
    "        <div ref={cardRef} className={cn('share-card-art', `share-card-art--${compositionMode}`)}>",
    "        <div ref={cardRef} className={cn('share-card-art', `share-card-art--${compositionMode}`, isGenerating && 'is-exporting')}>",
    "RunShareCard exporting class",
)

info_block = '''          <div className="share-card-info-block" style={layerStyle(infoTransform)} onPointerDown={startInfoGesture} onPointerMove={moveInfoGesture} onPointerUp={endInfoGesture} onPointerCancel={endInfoGesture}>
            <div className="share-card-brand"><img src="/capacete.webp" alt="" draggable={false} /><strong>INVICTUS</strong></div>
            <div className="share-card-activity-name"><small>{title.toUpperCase()}</small></div>
            <div className="share-card-metrics">
              {metrics.map((metric) => <div className="share-card-metric" key={metric.label}><span>{metric.label}</span><strong>{metric.value}{metric.unit ? <small> {metric.unit}</small> : null}</strong></div>)}
            </div>
          </div>'''

phrase_render = info_block + '''

          {phrases.filter((phrase) => phrase.visible).map((phrase) => (
            <div
              key={phrase.id}
              className={cn('share-card-phrase', `share-card-phrase--${phrase.id}`, selectedPhraseId === phrase.id && 'is-selected')}
              style={layerStyle(phrase.transform)}
              onPointerDown={(event) => startPhraseGesture(phrase.id, event)}
              onPointerMove={(event) => movePhraseGesture(phrase.id, event)}
              onPointerUp={(event) => endPhraseGesture(phrase.id, event)}
              onPointerCancel={(event) => endPhraseGesture(phrase.id, event)}
              aria-label={`Editar frase: ${phrase.text.replace(/\n/g, ' ')}`}
            >
              {phrase.text}
            </div>
          ))}

          {draggingPhraseId ? (
            <div className={cn('share-card-trash-zone', trashArmedPhraseId === draggingPhraseId && 'is-armed')} aria-hidden="true">
              <Trash2 size={16} />
              <span>SOLTE PARA REMOVER</span>
            </div>
          ) : null}'''

card = replace_once(card, info_block, phrase_render, "RunShareCard phrase render")

card = replace_once(
    card,
    '        <p className="share-card-gesture-hint">Arraste mapa ou rota. Arraste as informações separadamente e use dois dedos para redimensionar.</p>',
    '        <p className="share-card-gesture-hint">Arraste mapa/rota, frases e informações. Use pinça para redimensionar; arraste uma frase até a área de descarte para remover.</p>',
    "RunShareCard gesture hint",
)

card = replace_once(
    card,
    '<label className="share-customizer-slider"><span>Tamanho das informações</span><input type="range" min="55" max="180" value={Math.round(infoTransform.scale * 100)}',
    '<label className="share-customizer-slider"><span>Tamanho das informações</span><input type="range" min="55" max="140" value={Math.round(infoTransform.scale * 100)}',
    "RunShareCard info slider max",
)

card = replace_once(
    card,
    '<div className="share-customizer-reset"><button type="button" onClick={resetContent}>Recentrar mapa/rota</button><button type="button" onClick={() => setInfoTransform(DEFAULT_INFO_TRANSFORM)}>Recentrar informações</button></div>',
    '<div className="share-customizer-reset"><button type="button" onClick={resetContent}>Recentrar mapa/rota</button><button type="button" onClick={() => setInfoTransform(DEFAULT_INFO_TRANSFORM)}>Recentrar informações</button><button type="button" onClick={restorePhrases}>Restaurar frases</button></div>',
    "RunShareCard restore phrases",
)

card_path.write_text(card)


# ---------------------------------------------------------------------------
# 3) Estilos das frases e da zona temporária de descarte.
# ---------------------------------------------------------------------------
css_path = Path("src/components/RunShareCard.css")
css = css_path.read_text()
marker = ".share-card-info-block:active { cursor: grabbing; }\n"
phrase_css = r'''

.share-card-phrase {
  position: absolute;
  z-index: 7;
  max-width: 42%;
  color: rgba(255, 255, 255, .9);
  font-size: 8px;
  font-weight: 600;
  line-height: 1.55;
  letter-spacing: .26em;
  white-space: pre-line;
  text-shadow: 0 2px 10px rgba(0, 0, 0, .94);
  transform-origin: center;
  touch-action: none;
  cursor: grab;
  user-select: none;
  will-change: transform;
}

.share-card-phrase:active { cursor: grabbing; }
.share-card-phrase--movement { top: 5.5%; left: 5.5%; text-align: left; }
.share-card-phrase--discipline { top: 5.5%; right: 5.5%; text-align: right; }

.share-card-phrase.is-selected::after {
  content: '';
  position: absolute;
  inset: -7px -9px;
  border: 1px solid rgba(243, 179, 36, .72);
  border-radius: 9px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .25);
  pointer-events: none;
}

.share-card-trash-zone {
  position: absolute;
  z-index: 30;
  left: 50%;
  bottom: 2.5%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 11px;
  border: 1px solid rgba(255, 255, 255, .22);
  border-radius: 999px;
  color: rgba(255, 255, 255, .78);
  background: rgba(8, 8, 8, .78);
  backdrop-filter: blur(8px);
  font-size: 7px;
  font-weight: 800;
  letter-spacing: .12em;
  transform: translateX(-50%);
  pointer-events: none;
  transition: .15s ease;
}

.share-card-trash-zone.is-armed {
  border-color: rgba(244, 63, 94, .72);
  color: #fff;
  background: rgba(127, 29, 29, .86);
  transform: translateX(-50%) scale(1.05);
}

.share-card-art.is-exporting .share-card-phrase.is-selected::after,
.share-card-art.is-exporting .share-card-trash-zone { display: none; }
'''

if css.count(marker) != 1:
    raise SystemExit("RunShareCard.css insertion marker not found uniquely")
css = css.replace(marker, marker + phrase_css, 1)

css = replace_once(
    css,
    ".share-customizer-reset button { min-height: 40px; color: #f3b324; }",
    ".share-customizer-reset button { min-height: 40px; color: #f3b324; }\n"
    ".share-customizer-reset button:last-child:nth-child(3) { grid-column: 1 / -1; }",
    "RunShareCard.css restore phrase button",
)

css_path.write_text(css)


# ---------------------------------------------------------------------------
# 4) Teste de contrato do novo fluxo.
# ---------------------------------------------------------------------------
test_path = Path("src/tests/cardioShareDirectFlow.test.ts")
test_path.write_text(
    r'''import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('fluxo direto do editor de compartilhamento de cardio', () => {
  it('abre o editor direto após concluir cardio e não reapresenta o detalhe legado', () => {
    const challenges = read('src/pages/Challenges.tsx');
    expect(challenges).toContain("if (sessionType === 'cardio')");
    expect(challenges).toContain('setShareCardData(buildShareableFromItem(finishedItem))');
    expect(challenges).toContain("finishedActivityItem.type !== 'cardio'");
  });

  it('permite mover, pinçar e remover frases por gesto', () => {
    const card = read('src/components/RunShareCard.tsx');
    expect(card).toContain('startPhraseGesture');
    expect(card).toContain('movePhraseGesture');
    expect(card).toContain('SOLTE PARA REMOVER');
    expect(card).toContain('scale: clampScale');
    expect(card).toContain('preferencesKey');
  });
});
'''
)

print("Cardio share editor patch applied successfully.")
