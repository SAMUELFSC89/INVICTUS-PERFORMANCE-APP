import type { RankingEntry } from '../../types';
import './PodiumTopThree.css';

const CROWN_ASSETS: Record<number, string> = {
  1: '/ranking-frame-gold-reference.png',
  2: '/ranking-frame-silver-reference.png',
  3: '/ranking-frame-bronze-reference.png',
};
const PODIUM_BASE_ASSETS: Record<number, string> = {
  1: '/assets/ranking/podium-top1.webp',
  2: '/assets/ranking/podium-top2.webp',
  3: '/assets/ranking/podium-top3.webp',
};
const fallbackAvatar = '/capacete.webp';

function Crown({ rank, photoURL, empty = false }: { rank: number; photoURL?: string; empty?: boolean }) {
  return <span className={`academy-podium-avatar${empty ? ' academy-podium-avatar--empty' : ''}`}>
    {!empty ? <img className="academy-podium-photo" src={photoURL || fallbackAvatar} alt="" onError={(event) => { event.currentTarget.src = fallbackAvatar; }} /> : null}
    <img className="academy-podium-crown" src={CROWN_ASSETS[rank]} alt="" aria-hidden="true" />
  </span>;
}

function PodiumBase({ rank }: { rank: number }) {
  return <img className="academy-podium-base" src={PODIUM_BASE_ASSETS[rank]} alt="" aria-hidden="true" />;
}

function PodiumAthlete({ entry, currentUserId, onSelect, cleanSeasonLayout = false }: {
  entry: RankingEntry;
  currentUserId?: string;
  onSelect?: (uid: string) => void;
  cleanSeasonLayout?: boolean;
}) {
  const isCurrent = entry.uid === currentUserId;
  const athleteClass = `academy-podium-athlete academy-podium-athlete--${entry.rank}${isCurrent ? ' is-current' : ''}${cleanSeasonLayout ? ' academy-podium-athlete--clean' : ''}`;

  if (cleanSeasonLayout) {
    return <button
      type="button"
      className={athleteClass}
      onClick={() => onSelect?.(entry.uid)}
      aria-label={`${entry.rank}º lugar, ${entry.displayName}, ${entry.score} pontos IGA${isCurrent ? ', você' : ''}`}
    >
      <span className="academy-podium-visual">
        <Crown rank={entry.rank} photoURL={entry.photoURL} />
        <PodiumBase rank={entry.rank} />
      </span>
      <span className="academy-podium-meta">
        <strong>{entry.displayName || 'Atleta Invictus'}{isCurrent ? <em>VOCÊ</em> : null}</strong>
        <b>{Number(entry.score || 0).toLocaleString('pt-BR')} <small>IGA</small></b>
        {Number(entry.streak) > 0 ? <span className="academy-podium-streak">{entry.streak} dias em sequência</span> : null}
      </span>
    </button>;
  }

  return <button
    type="button"
    className={athleteClass}
    onClick={() => onSelect?.(entry.uid)}
    aria-label={`${entry.rank}º lugar, ${entry.displayName}, ${entry.score} pontos IGA${isCurrent ? ', você' : ''}`}
  >
    <span className="academy-podium-panel">
      <Crown rank={entry.rank} photoURL={entry.photoURL} />
      <strong>{entry.displayName || 'Atleta Invictus'}{isCurrent ? <em>VOCÊ</em> : null}</strong>
      <b>{Number(entry.score || 0).toLocaleString('pt-BR')} <small>IGA</small></b>
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

export function PodiumTopThree({ entries, currentUserId, onSelect, showEmptySlots = false, cleanSeasonLayout = false }: {
  entries: RankingEntry[];
  currentUserId?: string;
  onSelect?: (uid: string) => void;
  showEmptySlots?: boolean;
  cleanSeasonLayout?: boolean;
}) {
  // Ordem visual clássica de pódio: 2º à esquerda, 1º no centro, 3º à direita.
  const slots = [2, 1, 3].map((rank) => ({ rank, entry: entries.find((entry) => entry.rank === rank) }));
  if (!showEmptySlots && !slots.some((slot) => Boolean(slot.entry))) return null;

  return <section className={`academy-podium${cleanSeasonLayout ? ' academy-podium--clean-season' : ''}`} aria-label="Pódio da academia">
    {slots.map(({ rank, entry }) => entry
      ? <PodiumAthlete key={entry.uid} entry={entry} currentUserId={currentUserId} onSelect={onSelect} cleanSeasonLayout={cleanSeasonLayout} />
      : showEmptySlots ? <EmptyPodiumSlot key={`empty-${rank}`} rank={rank} cleanSeasonLayout={cleanSeasonLayout} /> : null)}
  </section>;
}
