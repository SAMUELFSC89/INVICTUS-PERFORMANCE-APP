import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import {
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  CreditCard,
  Dumbbell,
  ExternalLink,
  Footprints,
  Landmark,
  LockKeyhole,
  Medal,
  RefreshCw,
  ShieldCheck,
  Trophy,
} from 'lucide-react';
import { InvictusLogo } from '../../components/InvictusLogo';
import { VerifiedPresenceModal } from '../../components/VerifiedPresenceModal';
import { championshipService, getRegulationSections } from '../../services/championshipService';
import { buildCompetitiveHrAcknowledgement, COMPETITIVE_HR_FULL_TEXT } from '../../lib/competitiveHeartRateAcknowledgement';
import type { Championship, ChampionshipRegistration } from '../../types/championships';
import {
  ANDROID_EXTERNAL_ENROLLMENT_NOTICE,
  APPLE_CHAMPIONSHIP_DISCLAIMER,
  CHAMPIONSHIP_ORGANIZER,
  PAID_CHAMPIONSHIP_ENTRY_PRICE_BRL,
  PAID_CHAMPIONSHIP_OFFERS,
} from '../../../shared/paidChampionshipPolicy';
import './ChampionshipsNew.css';
import './PaidChampionship.css';

type ChampionshipPreviewProps = { modality: 'musculacao' | 'cardio' };

type PresenceState = {
  id: string;
  prompt: string;
  message: string;
} | null;

function brl(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function dateLabel(value?: string): string {
  if (!value) return 'A definir';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return 'A definir';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: 'America/Sao_Paulo' }).format(parsed);
}

export function ChampionshipPreview({ modality }: ChampionshipPreviewProps) {
  const navigate = useNavigate();
  const isStrength = modality === 'musculacao';
  const championshipId = isStrength ? 'invictus_strength_v1' : 'invictus_cardio_v1';
  const offer = PAID_CHAMPIONSHIP_OFFERS[championshipId];
  const ModalityIcon = isStrength ? Dumbbell : Footprints;
  const [championship, setChampionship] = useState<Championship | null>(null);
  const [registration, setRegistration] = useState<ChampionshipRegistration | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [hrAccepted, setHrAccepted] = useState(false);
  const [presence, setPresence] = useState<PresenceState>(null);

  const platform = Capacitor.getPlatform();
  const isNativeIOS = Capacitor.isNativePlatform() && platform === 'ios';
  const isNativeAndroid = Capacitor.isNativePlatform() && platform === 'android';
  const rules = useMemo(() => getRegulationSections(championshipId), [championshipId]);

  const refresh = async () => {
    setLoading(true);
    try {
      const [catalogItem, currentRegistration] = await Promise.all([
        championshipService.getChampionshipById(championshipId, true),
        championshipService.getRegistration(championshipId),
      ]);
      setChampionship(catalogItem || null);
      setRegistration(currentRegistration || null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [championshipId]);

  const startEnrollment = async () => {
    if (!championship || busy) return;
    setError('');
    if (!isNativeIOS) {
      setError(isNativeAndroid
        ? ANDROID_EXTERNAL_ENROLLMENT_NOTICE
        : 'A inscrição web será habilitada junto com o site oficial.');
      return;
    }
    if (!championship.registrationOpen) {
      setError(championship.registrationReadinessReason || 'As inscrições ainda não estão abertas.');
      return;
    }
    if (!rulesAccepted || !hrAccepted) {
      setError('Leia e marque os dois aceites obrigatórios antes de continuar.');
      return;
    }

    setBusy(true);
    try {
      const acknowledgement = buildCompetitiveHrAcknowledgement(championshipId, championship.regulationVersion);
      const accepted = await championshipService.acceptRegulation(
        championshipId,
        championship.regulationVersion,
        championship.regulationHash,
        acknowledgement,
      );
      const check = await championshipService.createPayment(championshipId, accepted.acceptanceId, 'ios_native');
      setPresence({ id: check.presenceCheckId, prompt: check.livenessPrompt, message: check.userMessage });
    } catch (err: any) {
      setError(err?.message || 'Não foi possível iniciar a inscrição.');
    } finally {
      setBusy(false);
    }
  };

  const onPresenceSuccess = async (result: { commitResult?: any; userMessage: string }) => {
    setPresence(null);
    const checkoutUrl = String(result.commitResult?.checkoutUrl || '');
    if (!/^https:\/\//i.test(checkoutUrl)) {
      setError('A presença foi confirmada, mas o checkout não ficou disponível. Tente novamente.');
      await refresh();
      return;
    }
    await Browser.open({ url: checkoutUrl, presentationStyle: 'popover' });
  };

  const paid = registration?.status === 'ACTIVE' && registration.paymentStatus === 'PAID';
  const pending = registration?.status === 'PENDING_PAYMENT';
  const price = championship?.registrationPrice ?? PAID_CHAMPIONSHIP_ENTRY_PRICE_BRL;

  return createPortal(
    <main className="ch-new-screen paid-championship-screen">
      <div className="ch-new-page ch-preview paid-championship-page">
        <header className="ch-detail-header">
          <button onClick={() => navigate('/championships')} aria-label="Voltar aos campeonatos"><ArrowLeft /></button>
          <div><InvictusLogo size={40} /><b>INVICTUS</b><small>PERFORMANCE</small></div><span />
        </header>

        <section className={`ch-preview-hero paid-championship-hero ${isStrength ? 'is-strength' : 'is-cardio'}`}>
          <span className="ch-preview-icon"><ModalityIcon /></span>
          <small>CAMPEONATO ESPORTIVO POR DESEMPENHO</small>
          <h1>{offer.title.toUpperCase()}</h1>
          <p>{offer.performanceDescription}</p>
          <strong>{brl(price)} <em>POR INSCRIÇÃO</em></strong>
          <div className="paid-championship-tags"><span>18+</span><span>PIX OU CARTÃO</span><span>COBRANÇA ÚNICA</span><span>SEM SORTEIO</span></div>
        </section>

        {paid && <section className="paid-status is-paid"><BadgeCheck /><div><b>INSCRIÇÃO CONFIRMADA</b><p>Seu pagamento foi confirmado pelo servidor e esta edição está vinculada à sua conta.</p></div></section>}
        {!paid && pending && <section className="paid-status is-pending"><RefreshCw /><div><b>PAGAMENTO EM PROCESSAMENTO</b><p>O checkout já foi criado. A inscrição só será ativada após a confirmação financeira do Asaas.</p></div></section>}

        <h2 className="ch-new-title">COMO FUNCIONA</h2>
        <section className="paid-championship-grid">
          <article><CreditCard /><b>INSCRIÇÃO</b><span>{brl(price)} por campeonato, pagamento avulso. Não é assinatura.</span></article>
          <article><ModalityIcon /><b>ATIVIDADE REAL</b><span>O resultado vem de desempenho físico real dentro do período oficial.</span></article>
          <article><ShieldCheck /><b>VALIDAÇÃO</b><span>Somente atividades elegíveis e homologadas pelo servidor entram no ranking.</span></article>
          <article><Trophy /><b>RESULTADO</b><span>Classificação final após as validações e revisões previstas no regulamento.</span></article>
        </section>

        <h2 className="ch-new-title">EDIÇÃO E PREMIAÇÃO</h2>
        <section className="paid-edition-card">
          <div><CalendarClock /><span><small>INSCRIÇÕES</small><b>{dateLabel(championship?.registrationOpensAt)} — {dateLabel(championship?.registrationClosesAt)}</b></span></div>
          <div><Trophy /><span><small>COMPETIÇÃO</small><b>{dateLabel(championship?.startAt)} — {dateLabel(championship?.endAt)}</b></span></div>
          <div><Medal /><span><small>PREMIAÇÃO PUBLICADA</small><b>{championship?.prizePool ? brl(championship.prizePool) : 'A definir antes da abertura'}</b></span></div>
          {!!championship?.prizeDistribution?.length && <div className="paid-prize-list">{championship.prizeDistribution.map((prize) => <span key={prize.rank}>{prize.rank}º — {brl(prize.amount)}</span>)}</div>}
        </section>

        <h2 className="ch-new-title">REGULAMENTO OFICIAL</h2>
        <section className="paid-rules" aria-label="Regulamento oficial do campeonato">
          {rules.map((section) => <article key={section.id}><h3>{section.title}</h3><p>{section.content}</p></article>)}
        </section>

        <section className="paid-legal-highlight">
          <Landmark /><div><b>ORGANIZADOR</b><p>{CHAMPIONSHIP_ORGANIZER.legalName}<br />CNPJ {CHAMPIONSHIP_ORGANIZER.cnpj}<br />{CHAMPIONSHIP_ORGANIZER.address}<br />{CHAMPIONSHIP_ORGANIZER.contactEmail}</p></div>
        </section>

        <section className="paid-apple-disclaimer"><LockKeyhole /><div><b>APPLE / APP STORE</b><p>{APPLE_CHAMPIONSHIP_DISCLAIMER}</p></div></section>

        {!paid && <section className="paid-acceptance">
          <label><input type="checkbox" checked={rulesAccepted} onChange={(event) => setRulesAccepted(event.target.checked)} /><span><b>ACEITO O REGULAMENTO OFICIAL</b>Li as regras desta edição, incluindo elegibilidade, desempenho, antifraude, premiação, revisão, cancelamento e privacidade.</span></label>
          <label><input type="checkbox" checked={hrAccepted} onChange={(event) => setHrAccepted(event.target.checked)} /><span><b>CIÊNCIA SOBRE FREQUÊNCIA CARDÍACA</b>{COMPETITIVE_HR_FULL_TEXT}</span></label>
        </section>}

        {isNativeAndroid && !paid && <section className="paid-platform-notice"><ExternalLink /><div><b>INSCRIÇÃO NO ANDROID</b><p>{ANDROID_EXTERNAL_ENROLLMENT_NOTICE}</p></div></section>}
        {!Capacitor.isNativePlatform() && !paid && <section className="paid-platform-notice"><ExternalLink /><div><b>INSCRIÇÃO PELO SITE</b><p>O fluxo web usará a mesma conta e o mesmo backend. O botão de pagamento será habilitado quando o site oficial estiver pronto.</p></div></section>}

        {error && <p className="paid-error" role="alert">{error}</p>}

        {isNativeIOS && !paid && <button
          className="paid-enroll-button"
          disabled={loading || busy || !championship?.registrationOpen}
          onClick={() => void startEnrollment()}
        >
          {busy ? 'PREPARANDO INSCRIÇÃO…' : championship?.registrationOpen ? `INSCREVER-SE — ${brl(price)}` : 'INSCRIÇÕES AINDA NÃO ABERTAS'}
          {!busy && championship?.registrationOpen && <ExternalLink />}
        </button>}

        {!paid && championship && !championship.registrationOpen && <p className="paid-readiness"><ShieldCheck /> {championship.registrationReadinessReason || 'A edição será aberta quando calendário e premiação estiverem publicados.'}</p>}

        <button className="ch-preview-back" onClick={() => navigate('/championships')}><ArrowLeft /> VOLTAR AOS CAMPEONATOS</button>
      </div>

      <VerifiedPresenceModal
        isOpen={!!presence}
        presenceCheckId={presence?.id || ''}
        livenessPrompt={presence?.prompt || ''}
        userMessage={presence?.message}
        onClose={() => setPresence(null)}
        onSuccess={(result) => void onPresenceSuccess(result)}
      />
    </main>,
    document.body,
  );
}
