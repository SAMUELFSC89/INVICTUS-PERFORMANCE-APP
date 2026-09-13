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

const EMPTY_SLOT_COPY: Record<number, { title: string; subtitle: string }> = {
  1: { title: 'AGUARDANDO LÍDER', subtitle: 'SEU NOME PODE ESTAR AQUI' },
  2: { title: 'VAGA ABERTA', subtitle: 'TREINE E CONQUISTE ESTA POSIÇÃO' },
  3: { title: 'VAGA ABERTA', subtitle: 'MOSTRE SUA EVOLUÇÃO E SUBA NO RANKING' },
};

function PodiumAthlete({ entry, currentUserId, onSelect }: {
  entry: RankingEntry;
  currentUserId?: string;
  onSelect?: (uid: string) => void;
}) {
  const isCurrent = entry.uid === currentUserId;
  return <button
    type="button"
    className={`academy-podium-athlete academy-podium-athlete--${entry.rank}${isCurrent ? ' is-current' : ''}`}
    onClick={() => onSelect?.(entry.uid)}
    aria-label={`${entry.rank}º lugar, ${entry.displayName}, ${entry.score} pontos IGA${isCurrent ? ', você' : ''}`}
  >
    <span className="academy-podium-panel">
      <span className="academy-podium-avatar">
        <img className="academy-podium-photo" src={entry.photoURL || fallbackAvatar} alt="" onError={(event) => { event.currentTarget.src = fallbackAvatar; }} />
        <img className="academy-podium-crown" src={CROWN_ASSETS[entry.rank]} alt="" aria-hidden="true" />
      </span>
      <strong>{entry.displayName || 'Atleta Invictus'}{isCurrent ? <em>VOCÊ</em> : null}</strong>
      <b>{Number(entry.score || 0).toLocaleString('pt-BR')} <small>IGA</small></b>
      {Number(entry.streak) > 0 ? <span className="academy-podium-streak">{entry.streak} dias em sequência</span> : null}
    </span>
    <img className="academy-podium-base" src={PODIUM_BASE_ASSETS[entry.rank]} alt="" aria-hidden="true" />
  </button>;
}

function EmptyPodiumSlot({ rank }: { rank: number }) {
  const copy = EMPTY_SLOT_COPY[rank];
  return <div
    className={`academy-podium-athlete academy-podium-athlete--${rank} is-empty`}
    aria-label={`${rank}º lugar ainda disponível`}
  >
    <span className="academy-podium-panel">
      <span className="academy-podium-avatar">
        <span className="academy-podium-photo academy-podium-photo--empty" aria-hidden="true" />
        <img className="academy-podium-crown" src={CROWN_ASSETS[rank]} alt="" aria-hidden="true" />
      </span>
      <strong>{copy.title}</strong>
      <span className="academy-podium-empty-copy">{copy.subtitle}</span>
    </span>
    <img className="academy-podium-base" src={PODIUM_BASE_ASSETS[rank]} alt="" aria-hidden="true" />
  </div>;
}

export function PodiumTopThree({ entries, currentUserId, onSelect, showEmptySlots = false }: {
  entries: RankingEntry[];
  currentUserId?: string;
  onSelect?: (uid: string) => void;
  showEmptySlots?: boolean;
}) {
  const slots = [2, 1, 3].map((rank) => ({ rank, entry: entries.find((entry) => entry.rank === rank) }));
  if (!showEmptySlots && !slots.some((slot) => Boolean(slot.entry))) return null;

  return <section className="academy-podium" aria-label="Pódio da academia">
    {slots.map(({ rank, entry }) => entry
      ? <PodiumAthlete key={entry.uid} entry={entry} currentUserId={currentUserId} onSelect={onSelect} />
      : showEmptySlots ? <EmptyPodiumSlot key={`empty-${rank}`} rank={rank} /> : null)}
  </section>;
}
