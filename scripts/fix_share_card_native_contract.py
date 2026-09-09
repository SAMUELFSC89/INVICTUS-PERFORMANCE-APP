from pathlib import Path

path = Path('src/tests/shareCardNativeContract.test.ts')
text = path.read_text(encoding='utf-8')
old = """  it('remove do card o modelo antigo com velocidade, divisórias e ícones de métricas', () => {\n    const card = read('src/components/RunShareCard.tsx');\n    expect(card).not.toContain('VELOCIDADE');\n    expect(card).not.toContain('share-card-divider');\n    expect(card).not.toContain('share-card-metric-icon');\n  });"""
new = """  it('remove velocidade e divisórias antigas, mas mantém os ícones do layout aprovado', () => {\n    const card = read('src/components/RunShareCard.tsx');\n    expect(card).not.toContain('VELOCIDADE');\n    expect(card).not.toContain('share-card-divider');\n    expect(card).toContain('share-card-metric-icon');\n  });"""
if text.count(old) != 1:
    raise SystemExit(f'expected one legacy share-card contract block, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('share-card native contract updated')
