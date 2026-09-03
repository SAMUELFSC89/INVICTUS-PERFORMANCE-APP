import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import './SeasonBanner.css';

interface SeasonBannerSlide {
  image: string;
  position: string;
}

interface SeasonBannerProps {
  eyebrow?: string;
  title: string;
  subtitle: string;
  ctaLabel?: string;
  onCtaClick?: () => void;
}

// #171: banner com fotos reais enviadas pelo usuario (2026-09-03), no mesmo
// padrao visual da Home ja aprovada -- reaproveitado em qualquer tela que
// use <SeasonBanner>. O cavaleiro (slide 3) e a arte original que ja existia
// como unico banner da Home antes desta tarefa; mantida para preservar a
// identidade visual ja validada com o usuario, agora como um dos 4 slides.
const SLIDES: SeasonBannerSlide[] = [
  { image: '/assets/home/home-season-runner-v1.webp', position: '68% 2%' },
  { image: '/assets/home/home-season-dumbbells-v1.webp', position: '70% 55%' },
  { image: '/assets/home/home-season-warrior-v1.png', position: '82% 30%' },
  { image: '/assets/home/home-season-hallway-v1.webp', position: '50% 15%' },
];

const AUTO_ROTATE_MS = 5000;
// #171: limiar minimo de arrasto horizontal para contar como swipe
// intencional (evita trocar de slide num toque que so rolou a tela por
// engano).
const SWIPE_THRESHOLD_PX = 40;

export function SeasonBanner({ eyebrow, title, subtitle, ctaLabel, onCtaClick }: SeasonBannerProps) {
  const [activeSlide, setActiveSlide] = useState(0);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % SLIDES.length);
    }, AUTO_ROTATE_MS);
    return () => window.clearInterval(interval);
  }, []);

  const handleTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLElement>) => {
    if (touchStartX.current === null) return;
    const endX = event.changedTouches[0]?.clientX ?? touchStartX.current;
    const deltaX = endX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX) return;
    setActiveSlide((current) =>
      deltaX < 0 ? (current + 1) % SLIDES.length : (current - 1 + SLIDES.length) % SLIDES.length,
    );
  };

  return (
    <section className="season-banner" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <div
        className="season-banner-bg"
        style={{ backgroundImage: `url('${SLIDES[activeSlide].image}')`, backgroundPosition: SLIDES[activeSlide].position }}
        aria-hidden="true"
      />
      <div className="season-banner-gradient" aria-hidden="true" />
      <div className="season-banner-copy">
        {eyebrow ? <small>{eyebrow}</small> : null}
        <h2>{title}</h2>
        <p>{subtitle}</p>
        {ctaLabel && onCtaClick ? (
          <button type="button" onClick={onCtaClick}>
            {ctaLabel} <ArrowRight size={16} />
          </button>
        ) : null}
      </div>
      <div className="season-banner-dots" role="tablist" aria-label="Selecionar imagem de destaque">
        {SLIDES.map((_, index) => (
          <button
            key={index}
            type="button"
            role="tab"
            aria-selected={index === activeSlide}
            aria-label={`Imagem ${index + 1} de ${SLIDES.length}`}
            className={index === activeSlide ? 'is-active' : ''}
            onClick={() => setActiveSlide(index)}
          />
        ))}
      </div>
    </section>
  );
}

export default SeasonBanner;
