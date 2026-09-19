import type { CSSProperties, ComponentType } from 'react';
import { ArrowRight, CheckCircle2, ChevronRight, Dumbbell, Footprints, Lock, Play, ShieldCheck, Trophy, Users } from 'lucide-react';

const FRIENDS_BANNER = '/assets/championships/friends-banner.png';
const COINS_STACK = '/assets/coins/invictus-coins-stack.png';

type PreviewCardProps = {
  category: string;
  title: string;
  description: string;
  image: string;
  imagePosition: string;
  icon: ComponentType<{ 'aria-hidden'?: boolean }>;
  onPreview: () => void;
  /**
   * Selo de status do card (ex.: "INSCRIÇÕES ABERTAS" ou "COMEÇA EM 1 DE
   * DEZEMBRO"), calculado a partir do calendário real do campeonato. Cai
   * para "EM BREVE" enquanto o catálogo ainda está carregando ou se a data
   * não estiver disponível -- nunca fica travado em "em breve" depois que a
   * inscrição/calendário reais já são conhecidos.
   */
  statusLabel?: string;
};

type ParticipatingCardProps = {
  category: string;
  title: string;
  image: string;
  icon: ComponentType<{ 'aria-hidden'?: boolean }>;
  onOpen: () => void;
  /** Rótulo do selo de status (padrão: "PARTICIPANDO", usado pelos campeonatos pagos). */
  statusLabel?: string;
  statusIcon?: ComponentType<{ 'aria-hidden'?: boolean }>;
  /** Palavra usada no aria-label do botão (padrão: "participando"). */
  ariaStatusWord?: string;
};

export function FriendsChampionshipCard({ onParticipate }: { onParticipate: () => void }) {
  return <section className="ch-friends-card" aria-labelledby="friends-championship-title">
    <img className="ch-friends-card__background" src={FRIENDS_BANNER} alt="" aria-hidden="true" width={1672} height={941} decoding="async" fetchPriority="high" />
    <div className="ch-friends-card__overlay" />
    <div className="ch-friends-card__content">
      <span className="ch-friends-card__free">GRÁTIS</span>
      <h2 id="friends-championship-title">CAMPEONATO <strong>ENTRE AMIGOS</strong></h2>
      <h3>MUSCULAÇÃO + CARDIO</h3>
      <p className="ch-friends-card__description">Compita com a mesma regra de IGA para FREE e PRO. Sem prêmio em dinheiro e sem vínculo comercial com academias.</p>
      <ul className="ch-friends-card__facts" aria-label="Destaques do campeonato">
        <li><Users aria-hidden="true" /><span>Compita entre amigos</span></li>
        <li><Trophy aria-hidden="true" /><span>1º lugar: <b>2.500 Coins</b></span></li>
        <li><ShieldCheck aria-hidden="true" /><span>Top 3 com auditoria reforçada</span></li>
      </ul>
      <div className="ch-friends-card__prize"><img src={COINS_STACK} alt="" aria-hidden="true" width={1374} height={1145} loading="lazy" decoding="async" /><div><small>PREMIAÇÃO</small><strong>5.000 COINS POR CICLO</strong><p>1º: 2.500 · 2º: 1.500 · 3º: 1.000</p><span>Conclusão válida: +50 Coins</span></div></div>
      <button type="button" onClick={onParticipate}>PARTICIPAR GRÁTIS <ArrowRight aria-hidden="true" /></button>
      <p className="ch-friends-card__legal"><ShieldCheck aria-hidden="true" /> 100% GRATUITO · SEM PRÊMIO EM DINHEIRO · SÓ PERFORMANCE</p>
    </div>
  </section>;
}

export function FriendsRankingCard({ onOpen }: { onOpen: () => void }) {
  return <button type="button" className="ch-friends-ranking-card" onClick={onOpen} aria-label="Campeonato Entre Amigos, participando, ver ranking">
    <img className="ch-friends-ranking-card__background" src={FRIENDS_BANNER} alt="" aria-hidden="true" />
    <span className="ch-friends-ranking-card__scrim" aria-hidden="true" />
    <span className="ch-friends-ranking-card__identity"><Users aria-hidden="true" /><span><small>CAMPEONATO</small><strong>ENTRE AMIGOS</strong></span></span>
    <span className="ch-friends-ranking-card__status"><CheckCircle2 aria-hidden="true" /> PARTICIPANDO <small>MUSCULAÇÃO + CARDIO</small></span>
    <span className="ch-friends-ranking-card__ranking">VER RANKING <ChevronRight aria-hidden="true" /></span>
  </button>;
}

export function PaidRankingCard({ category, title, image, icon: Icon, onOpen, statusLabel = 'PARTICIPANDO', statusIcon: StatusIcon = CheckCircle2, ariaStatusWord = 'participando' }: ParticipatingCardProps) {
  return <button type="button" className="ch-friends-ranking-card ch-paid-ranking-card" onClick={onOpen} aria-label={`${title}, ${ariaStatusWord}, ver ranking`}>
    <img className="ch-friends-ranking-card__background" src={image} alt="" aria-hidden="true" />
    <span className="ch-friends-ranking-card__scrim" aria-hidden="true" />
    <span className="ch-friends-ranking-card__identity"><Icon aria-hidden={true} /><span><small>CAMPEONATO OFICIAL</small><strong>{title}</strong></span></span>
    <span className="ch-friends-ranking-card__status"><StatusIcon aria-hidden={true} /> {statusLabel} <small>{category}</small></span>
    <span className="ch-friends-ranking-card__ranking">VER RANKING <ChevronRight aria-hidden="true" /></span>
  </button>;
}

/**
 * Campeonato de força exclusivo do plano PRO: sem inscrição/checkout, o
 * atleta PRO participa assim que envia seu primeiro levantamento em vídeo.
 * Este card mostra como funciona; uma vez que exista pelo menos um registro
 * do atleta, o hub troca este card pelo `PaidRankingCard` compacto (mesma
 * lógica visual de Musculação/Cardio).
 *
 * `onEnroll` sempre navega para `/power` -- a política canônica de acesso
 * (`hasActiveProEntitlement` via `ProFeatureGate`) decide, na própria rota,
 * se o atleta entra ou cai no paywall PRO já existente no app. Este
 * componente não duplica essa checagem: `pro` só controla o selo/CTA
 * exibidos aqui, nunca o que a rota realmente permite.
 */
export function PowerLiftFeatureCard({ onEnroll, pro }: { onEnroll: () => void; pro: boolean }) {
  return <section className="ch-powerlift-feature" aria-labelledby="powerlift-championship-title">
    <span aria-hidden="true"><Trophy /></span>
    <div>
      <small>CAMPEONATO DE FORÇA · PRO</small>
      <h2 id="powerlift-championship-title">INVICTUS POWER LIFT</h2>
      <p>Registre seu levantamento em vídeo, passe pela validação inteligente e mostre sua força no ranking.</p>
      <ul>
        <li><Play aria-hidden="true" /> Vídeo obrigatório</li>
        <li><ShieldCheck aria-hidden="true" /> Antifraude por IA</li>
        <li><Trophy aria-hidden="true" /> Ranking por modalidade</li>
      </ul>
    </div>
    {pro
      ? <button type="button" onClick={onEnroll}>PARTICIPAR <ArrowRight aria-hidden="true" /></button>
      : <button type="button" onClick={onEnroll}>VIRAR PRO <Lock aria-hidden="true" /></button>}
  </section>;
}

export function ChampionshipPreviewCard({ category, title, description, image, imagePosition, icon: Icon, onPreview, statusLabel }: PreviewCardProps) {
  return <article className="ch-paid-card" style={{ '--ch-paid-image-position': imagePosition } as CSSProperties}>
    <img className="ch-paid-card__background" src={image} alt="" aria-hidden="true" width={1672} height={941} loading="lazy" decoding="async" />
    <div className="ch-paid-card__overlay" />
    <div className="ch-paid-card__content"><Icon aria-hidden={true} /><small>{category}</small><h3>{title}</h3><p>{description}</p><strong>{statusLabel || 'EM BREVE'}</strong><button type="button" onClick={onPreview}>CONHECER A PRÉVIA <ArrowRight aria-hidden="true" /></button></div>
  </article>;
}

export const strengthPreviewCard = { category: 'MUSCULAÇÃO', title: 'CAMPEONATO DE FORÇA', description: 'Conheça a proposta e como será a validação das atividades.', image: '/assets/championships/strength-banner.png', imagePosition: 'center right', icon: Dumbbell };
export const cardioPreviewCard = { category: 'CARDIO', title: 'CAMPEONATO DE CARDIO', description: 'Veja o formato planejado e como o antifraude protegerá a competição.', image: '/assets/championships/cardio-banner.png', imagePosition: 'center right', icon: Footprints };
export const powerLiftRankingCard = { category: 'FORÇA', title: 'INVICTUS POWER LIFT', image: '/assets/challenges/powerlift-banner-v2.jpg', icon: Trophy };
