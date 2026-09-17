import type { RankingEntry } from '../../types';
import './PodiumTopThree.css';

const CROWN_ASSETS: Record<number, string> = {
  1: '/ranking-frame-gold-reference.png',
  2: '/ranking-frame-silver-reference.png',
  3: '/assets/ranking/crown-bronze-complete-v1.png',
};
const PODIUM_BASE_ASSETS: Record<number, string> = {
  1: '/assets/ranking/podium-top1-glow-v2.png',
  2: '/assets/ranking/podium-top2.webp',
  3: '/assets/ranking/podium-top3.webp',
};
const fallbackAvatar = '/capacete.webp';

const MASTER_PODIUM_ASSETS = {
  academy: '/assets/ranking/podium-academy-v1.webp',
  musculacao: '/assets/ranking/podium-musculacao-v1.webp',
  cardio: '/assets/ranking/podium-cardio-v1.webp',
} as const;

type PodiumTheme = keyof typeof MASTER_PODIUM_ASSETS;

function Crown({ rank, photoURL, empty = false }: { rank: number; photoURL?: string; empty?: boolean }) {
  return <span className={`academy-podium-avatar${empty ? ' academy-podium-avatar--empty' : ''}`}>
    {!empty ? <img className="academy-podium-photo" src={photoURL || fallbackAvatar} alt="" onError={(event) => { event.currentTarget.src = fallbackAvatar; }} /> : null}
    <img className="academy-podium-crown" src={CROWN_ASSETS[rank]} alt="" aria-hidden="true" />
  </span>;
}

function PodiumBase({ rank }: { rank: number }) {
  return <img className="academy-podium-base" src={`${PODIUM_BASE_ASSETS[rank]}?v=20260917`} alt="" aria-hidden="true" />;
}

function PodiumAthlete({ entry, currentUserId, onSelect, cleanSeasonLayout = false, scoreUnit }: {
  entry: RankingEntry;
  currentUserId?: string;
  onSelect?: (uid: string) => void;
  cleanSeasonLayout?: boolean;
  scoreUnit: string;
}) {
  const isCurrent = entry.uid === currentUserId;
  const athleteClass = `academy-podium-athlete academy-podium-athlete--${entry.rank}${isCurrent ? ' is-current' : ''}${cleanSeasonLayout ? ' academy-podium-athlete--clean' : ''}`;

  if (cleanSeasonLayout) {
    return <button
      type="button"
      className={athleteClass}
      onClick={() => onSelect?.(entry.uid)}
      aria-label={`${entry.rank}º lugar, ${entry.displayName}, ${entry.score} pontos ${scoreUnit}${isCurrent ? ', você' : ''}`}
    >
      <span className="academy-podium-visual">
        <Crown rank={entry.rank} photoURL={entry.photoURL} />
        <PodiumBase rank={entry.rank} />
      </span>
      <span className="academy-podium-meta">
        <strong>{entry.displayName || 'Atleta Invictus'}{isCurrent ? <em>VOCÊ</em> : null}</strong>
        <b>{Number(entry.score || 0).toLocaleString('pt-BR')} <small>{scoreUnit}</small></b>
        {Number(entry.streak) > 0 ? <span className="academy-podium-streak">{entry.streak} dias em sequência</span> : null}
      </span>
    </button>;
  }

  return <button
    type="button"
    className={athleteClass}
    onClick={() => onSelect?.(entry.uid)}
    aria-label={`${entry.rank}º lugar, ${entry.displayName}, ${entry.score} pontos ${scoreUnit}${isCurrent ? ', você' : ''}`}
  >
    <span className="academy-podium-panel">
      <Crown rank={entry.rank} photoURL={entry.photoURL} />
      <strong>{entry.displayName || 'Atleta Invictus'}{isCurrent ? <em>VOCÊ</em> : null}</strong>
      <b>{Number(entry.score || 0).toLocaleString('pt-BR')} <small>{scoreUnit}</small></b>
      {Number(entry.streak) > 0 ? <span className="academy-podium-streak">{entry.streak} dias em sequência</span> : null}
    </span>
    <PodiumBase rank={entry.rank} />
  </button>;
}

function EmptyPodiumSlot({ rank, cleanSeasonLayout = false }: { rank: number; cleanSeasonLayout?: boolean }) {
  const slotClass = `academy-podium-athlete academy-podium-athlete--${rank} is-empty${cleanSeasonLayout ? ' academy-podium-athlete--clean' : ''}`;

  // O pódio vazio da temporada é propositalmente visual: coroa + base, sem
  // frases motivacionais, placeholders ou copy entre as duas artes.
  if (cleanSeasonLayout) {
    return <div className={slotClass} aria-label={`${rank}º lugar ainda disponível`}>
      <span className="academy-podium-visual">
        <Crown rank={rank} empty />
        <PodiumBase rank={rank} />
      </span>
    </div>;
  }

  return <div className={slotClass} aria-label={`${rank}º lugar ainda disponível`}>
    <span className="academy-podium-panel">
      <Crown rank={rank} empty />
    </span>
    <PodiumBase rank={rank} />
  </div>;
}

export function PodiumTopThree({ entries, currentUserId, onSelect, showEmptySlots = false, cleanSeasonLayout = false, scoreUnit = 'IGA', theme = 'academy' }: {
  entries: RankingEntry[];
  currentUserId?: string;
  onSelect?: (uid: string) => void;
  showEmptySlots?: boolean;
  cleanSeasonLayout?: boolean;
  scoreUnit?: string;
  theme?: PodiumTheme;
}) {
  // Ordem visual clássica de pódio: 2º à esquerda, 1º no centro, 3º à direita.
  const slots = [2, 1, 3].map((rank) => ({ rank, entry: entries.find((entry) => entry.rank === rank) }));
  if (!showEmptySlots && !slots.some((slot) => Boolean(slot.entry))) return null;

  // Nas telas principais de ranking usamos um único asset de cenário+pódio.
  // Apenas as fotos dos atletas ficam dinâmicas por cima dos três círculos,
  // garantindo alinhamento idêntico em academia, musculação e cardio.
  if (cleanSeasonLayout) {
    const entriesByRank = new Map(entries.map((entry) => [entry.rank, entry]));
    return <section className={`academy-podium academy-podium--master academy-podium--master-${theme}`} aria-label="Pódio do ranking">
      <img className="academy-podium-master-image" src={MASTER_PODIUM_ASSETS[theme]} alt="" aria-hidden="true" />
      {[1, 2, 3].map((rank) => {
        const entry = entriesByRank.get(rank);
        if (!entry) return null;
        const isCurrent = entry.uid === currentUserId;
        return <button
          key={entry.uid}
          type="button"
          className={`academy-podium-master-slot academy-podium-master-slot--${rank}${isCurrent ? ' is-current' : ''}`}
          onClick={() => onSelect?.(entry.uid)}
          aria-label={`${rank}º lugar, ${entry.displayName || 'Atleta Invictus'}, ${Number(entry.score || 0).toLocaleString('pt-BR')} ${scoreUnit}`}
        >
          <img src={entry.photoURL || fallbackAvatar} alt="" onError={(event) => { event.currentTarget.src = fallbackAvatar; }} />
        </button>;
      })}
    </section>;
  }

  return <section className="academy-podium" aria-label="Pódio da academia">
    {slots.map(({ rank, entry }) => entry
      ? <PodiumAthlete key={entry.uid} entry={entry} currentUserId={currentUserId} onSelect={onSelect} cleanSeasonLayout={false} scoreUnit={scoreUnit} />
      : showEmptySlots ? <EmptyPodiumSlot key={`empty-${rank}`} rank={rank} cleanSeasonLayout={false} /> : null)}
  </section>;
}
