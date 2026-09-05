import { renderToStaticMarkup } from 'react-dom/server';
import type { OfficialExercise } from '../data/exerciseCatalog';
import {
  ExerciseDemoDialog,
  OfficialExerciseMedia,
  resolveOfficialExerciseMedia,
  selectOfficialExerciseThumbnail,
} from '../components/OfficialExerciseMedia';

jest.mock('../components/OfficialExerciseMedia.css', () => ({}));

const exercise: OfficialExercise = {
  id: 'test_exercise', name: 'Exercício com Halteres', muscleGroup: 'bracos', equipment: 'halteres',
  thumbUrl: '/assets/test/thumb.webp', thumbFallbackUrl: '/assets/test/thumb.png',
  thumbStatus: 'ready', demoStatus: 'waiting_for_demo',
};

describe('Mídia oficial dos exercícios', () => {
  test('seleciona a imagem oficial WebP antes do fallback', () => {
    expect(selectOfficialExerciseThumbnail(resolveOfficialExerciseMedia(exercise))).toBe('/assets/test/thumb.webp');
  });
  test('tenta o PNG somente após falha do WebP', () => {
    expect(selectOfficialExerciseThumbnail(resolveOfficialExerciseMedia(exercise), new Set(['/assets/test/thumb.webp']))).toBe('/assets/test/thumb.png');
  });
  test('para de tentar depois que as duas fontes falham', () => {
    expect(selectOfficialExerciseThumbnail(resolveOfficialExerciseMedia(exercise), new Set(['/assets/test/thumb.webp', '/assets/test/thumb.png']))).toBeNull();
  });
  test('não repete a mesma URL se cadastrada também como fallback', () => {
    const resolved = resolveOfficialExerciseMedia({ ...exercise, thumbFallbackUrl: exercise.thumbUrl });
    expect(selectOfficialExerciseThumbnail(resolved, new Set([exercise.thumbUrl]))).toBeNull();
  });
  test('status pendente nunca requisita a URL reservada para a futura imagem', () => {
    const resolved = resolveOfficialExerciseMedia({ ...exercise, thumbStatus: 'waiting_for_thumb' });
    expect(resolved.thumbnailUrl).toBeNull();
    expect(resolved.thumbnailFallbackUrl).toBeNull();
  });
  test('exercício não encontrado não ganha imagem de outro ID', () => {
    const resolved = resolveOfficialExerciseMedia(undefined, 'ID antigo');
    expect(resolved.name).toBe('ID antigo');
    expect(selectOfficialExerciseThumbnail(resolved)).toBeNull();
  });
  test.each(['javascript:alert(1)', '//unknown.example/thumb.webp', 'data:image/svg+xml,x', 'https://name:secret@example.com/a.webp'])('rejeita URL fora do contrato: %s', (thumbUrl) => {
    expect(resolveOfficialExerciseMedia({ ...exercise, thumbUrl }).thumbnailUrl).toBeNull();
  });
  test('permite HTTPS sem credenciais para um CDN oficial', () => {
    expect(resolveOfficialExerciseMedia({ ...exercise, thumbUrl: 'https://cdn.example.com/thumb.webp' }).thumbnailUrl).toBe('https://cdn.example.com/thumb.webp');
  });
  test('demo pendente não se torna disponível por conter uma URL', () => {
    expect(resolveOfficialExerciseMedia({ ...exercise, demoUrl: '/demo.mp4' }).demoUrl).toBeNull();
  });
  test('demo exige tanto ready quanto uma URL válida', () => {
    expect(resolveOfficialExerciseMedia({ ...exercise, demoStatus: 'ready' }).demoUrl).toBeNull();
    expect(resolveOfficialExerciseMedia({ ...exercise, demoStatus: 'ready', demoUrl: '/demo.mp4' }).demoUrl).toBe('/demo.mp4');
  });
  test('lista usa carregamento sob demanda e texto alternativo específico', () => {
    const html = renderToStaticMarkup(<OfficialExerciseMedia exercise={exercise} />);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('alt="Ilustração de Exercício com Halteres"');
    expect(html).toContain('src="/assets/test/thumb.webp"');
  });
  test('imagem do exercício atual pode ser priorizada explicitamente', () => {
    expect(renderToStaticMarkup(<OfficialExerciseMedia exercise={exercise} priority />)).toContain('loading="eager"');
  });
  test('ausência de imagem produz alternativa acessível, sem img quebrada', () => {
    const html = renderToStaticMarkup(<OfficialExerciseMedia exercise={{ ...exercise, thumbStatus: 'waiting_for_thumb' }} />);
    expect(html).not.toContain('<img');
    expect(html).toContain('role="img"');
    expect(html).toContain('Imagem indisponível para Exercício com Halteres');
  });
  test('modal fechado não monta vídeo nem imagem em segundo plano', () => {
    expect(renderToStaticMarkup(<ExerciseDemoDialog exercise={exercise} open={false} onClose={() => {}} />)).toBe('');
  });
});
