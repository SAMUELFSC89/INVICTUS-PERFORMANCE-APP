import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import {
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  ChevronDown,
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
  X,
} from 'lucide-react';
import { InvictusLogo } from '../../components/InvictusLogo';
import { championshipService, getRegulationSections } from '../../services/championshipService';
import { buildCompetitiveHrAcknowledgement, COMPETITIVE_HR_FULL_TEXT } from '../../lib/competitiveHeartRateAcknowledgement';
import type { Championship, ChampionshipRegistration, UserChampionshipProgress } from '../../types/championships';
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

// Store-submission kill switch. Paid championship registration is intentionally
// disabled in the build sent to App Store / Google Play. Re-enabling it requires
// a separate store/legal review and a new audited release.
const STORE_SUBMISSION_PAID_ENROLLMENT_ENABLED = false;

function brl(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function dateLabel(value?: string): string {
  if (!value) return 'A definir';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return 'A definir';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: 'America/Sao_Paulo' }).format(parsed);
}

function unavailableRegistrationLabel(championship?: Championship | null): string {
  if (!championship) return 'CARREGANDO…';
  const reason = String(championship.registrationReadinessReason || '').toLowerCase();
  return reason.includes('encerrad') ? 'INSCRIÇÕES ENCERRADAS' : 'INSCRIÇÕES AINDA NÃO ABERTAS';
}

export function ChampionshipPreview({ modality }: ChampionshipPreviewProps) {
  const navigate = useNavigate();
  const isStrength = modality === 'musculacao';
  const championshipId = isStrength ? 'invictus_strength_v1' : 'invictus_cardio_v1';
  const offer = PAID_CHAMPIONSHIP_OFFERS[championshipId];
  const ModalityIcon = isStrength ? Dumbbell : Footprints;
  const [championship, setChampionship] = useState<Championship | null>(null);
  const [registration, setRegistration] = useState<ChampionshipRegistration | null>(null);
  const [progress, setProgress] = useState<UserChampionshipProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentError, setConsentError] = useState('');
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [hrAccepted, setHrAccepted] = useState(false);

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
      if (currentRegistration?.status === 'ACTIVE' && currentRegistration.paymentStatus === 'PAID') {
        setProgress(await championshipService.getUserProgress(championshipId));
      } else {
        setProgress(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [championshipId]);

  const openEnrollmentConsent = () => {
    if (!STORE_SUBMISSION_PAID_ENROLLMENT_ENABLED) {
      setError('As inscrições pagas não estão disponíveis nesta versão do aplicativo.');
      return;
    }
    if (!championship || busy) return;
    setError('');
    setConsentError('');
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
    setConsentOpen(true);
  };

  const confirmEnrollment = async () => {
    if (!STORE_SUBMISSION_PAID_ENROLLMENT_ENABLED) {
      setConsentError('As inscrições pagas não estão disponíveis nesta versão do aplicativo.');
      return;
    }
    if (!championship || busy) return;
    setConsentError('');
    if (!rulesAccepted || !hrAccepted) {
      setConsentError('Aceite os dois termos obrigatórios para continuar ao pagamento.');
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
      const checkout = await championshipService.createPayment(championshipId, accepted.acceptanceId, 'ios_native');
      const checkoutUrl = String(checkout.checkoutUrl || '');
      if (!/^https:\/\//i.test(checkoutUrl)) {
        throw new Error('O checkout foi criado, mas o endereço de pagamento não ficou disponível. Tente novamente.');
      }
      setConsentOpen(false);
      await Browser.open({ url: checkoutUrl, presentationStyle: 'popover' });
    } catch (err: any) {
      setConsentError(err?.message || 'Não foi possível abrir o checkout da inscrição.');
    } finally {
      setBusy(false);
    }
  };

  const paid = registration?.status === 'ACTIVE' && registration.paymentStatus === 'PAID';
  const reconciliation = registration?.status === 'REJECTED'
    || registration?.paymentStatus === 'RECONCILIATION_REQUIRED'
    || registration?.paymentStatus === 'PAYMENT_PARTIALLY_REFUNDED'
    || registration?.paymentStatus === 'PAYMENT_REFUND_IN_PROGRESS'
    || registration?.paymentStatus === 'PAYMENT_CHARGEBACK_REQUESTED'
    || registration?.paymentStatus === 'PAYMENT_CHARGEBACK_DISPUTE'
    || registration?.paymentStatus === 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL';
  const refunded = registration?.status === 'REFUNDED' || registration?.paymentStatus === 'REFUNDED';
  const enrollmentBlocked = reconciliation || refunded;
  const pending = registration?.status === 'PENDING_PAYMENT' && !reconciliation;
  const canStartEnrollment = STORE_SUBMISSION_PAID_ENROLLMENT_ENABLED && !paid && !enrollmentBlocked;
  const price = championship?.registrationPrice ?? PAID_CHAMPIONSHIP_ENTRY_PRICE_BRL;
  const finalized = progress?.settlementStatus === 'FINALIZED';
  const finalResult = progress?.finalResult || null;
  const prizeRevealed = typeof championship?.revealedPrizePool === 'number';
  const displayedPrizePool = prizeRevealed ? championship!.revealedPrizePool! : championship?.prizePool;
  const displayedPrizeDistribution = prizeRevealed ? (championship!.revealedPrizeDistribution || []) : (championship?.prizeDistribution || []);

  const moreToggle = (
    <span className="champ-info-toggle flex shrink-0 items-center gap-1 font-black tracking-[.06em] text-amber-300">
      <span className="group-open:hidden">VER MAIS</span>
      <span className="hidden group-open:inline">VER MENOS</span>
      <ChevronDown className="h-5 w-5 transition-transform group-open:rotate-180" />
    </span>
  );

  return createPortal(
    <>
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
            {STORE_SUBMISSION_PAID_ENROLLMENT_ENABLED ? <>
              <strong>{brl(price)} <em>POR INSCRIÇÃO</em></strong>
              <div className="paid-championship-tags"><span>18+</span><span>PIX OU CARTÃO</span><span>COBRANÇA ÚNICA</span><span>SEM SORTEIO</span></div>
            </> : <>
              <strong>EM BREVE</strong>
              <div className="paid-championship-tags"><span>18+</span><span>SEM INSCRIÇÃO NESTA VERSÃO</span><span>EDIÇÃO FUTURA</span></div>
            </>}
          </section>

          {!STORE_SUBMISSION_PAID_ENROLLMENT_ENABLED && <section className="paid-status is-pending"><ShieldCheck /><div><b>EDIÇÃO PAGA AINDA NÃO DISPONÍVEL</b><p>Esta tela é apenas informativa. A versão submetida às lojas não permite inscrição, cobrança ou acesso a premiação paga nestas modalidades.</p></div></section>}

          {paid && !finalized && <section className="paid-status is-paid"><BadgeCheck /><div><b>INSCRIÇÃO CONFIRMADA</b><p>Seu pagamento foi confirmado pelo servidor e esta edição está vinculada à sua conta. Homologação prevista para {dateLabel(championship?.settlementAt)}.</p></div></section>}
          {paid && finalized && finalResult && <section className="paid-status is-paid"><Trophy /><div><b>RESULTADO HOMOLOGADO</b><p>{finalResult.finalRank}º lugar de {finalResult.totalParticipants} participante{finalResult.totalParticipants === 1 ? '' : 's'}{finalResult.prizeWon ? ` · ${brl(finalResult.prizeWon)} creditados na carteira sacável.` : ' · sem premiação em dinheiro nesta colocação.'}</p></div></section>}
          {paid && finalized && !finalResult && <section className="paid-status is-paid"><ShieldCheck /><div><b>EDIÇÃO HOMOLOGADA</b><p>O resultado final foi fechado pelo servidor. Sua conta não entrou no ranking final elegível desta edição.</p></div></section>}
          {!paid && pending && <section className="paid-status is-pending"><RefreshCw /><div><b>PAGAMENTO EM PROCESSAMENTO</b><p>O checkout já foi criado. A inscrição só será ativada após a confirmação financeira do Asaas.</p></div></section>}
          {!paid && reconciliation && <section className="paid-status is-pending"><LockKeyhole /><div><b>CONCILIAÇÃO FINANCEIRA</b><p>Esta inscrição possui uma pendência financeira em análise. Um novo checkout fica bloqueado nesta edição até a conciliação ser resolvida.</p></div></section>}
          {!paid && refunded && <section className="paid-status is-pending"><RefreshCw /><div><b>REEMBOLSO REGISTRADO</b><p>O pagamento desta edição foi reembolsado. Este mesmo registro não pode ser reutilizado para uma nova cobrança.</p></div></section>}

          <section className="mt-6 space-y-3" aria-label="Informações do campeonato">
            <details className="group overflow-hidden rounded-2xl border border-zinc-700 bg-[#101012]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0"><b className="block font-black text-white">COMO FUNCIONA</b><small className="mt-1 block leading-relaxed text-zinc-200">Atividade real, validação e resultado.</small></span>
                {moreToggle}
              </summary>
              <div className="border-t border-zinc-700 p-3">
                <section className="paid-championship-grid">
                  <article><CreditCard /><b>INSCRIÇÃO</b><span>{STORE_SUBMISSION_PAID_ENROLLMENT_ENABLED ? `${brl(price)} por campeonato, pagamento avulso. Não é assinatura.` : 'Inscrições pagas não estão disponíveis nesta versão.'}</span></article>
                  <article><ModalityIcon /><b>ATIVIDADE REAL</b><span>O resultado decorre de desempenho físico real dentro do período oficial de uma futura edição publicada.</span></article>
                  <article><ShieldCheck /><b>VALIDAÇÃO</b><span>Somente atividades elegíveis e homologadas pelo servidor podem entrar em um ranking competitivo.</span></article>
                  <article><Trophy /><b>RESULTADO</b><span>Uma edição futura só será aberta depois da publicação das regras e informações obrigatórias.</span></article>
                </section>
              </div>
            </details>

            <details className="group overflow-hidden rounded-2xl border border-zinc-700 bg-[#101012]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0"><b className="block font-black text-white">EDIÇÃO E PREMIAÇÃO</b><small className="mt-1 block leading-relaxed text-zinc-200">{STORE_SUBMISSION_PAID_ENROLLMENT_ENABLED ? `${championship?.edition || 'Edição atual'} · ${displayedPrizePool ? `${brl(displayedPrizePool)}${prizeRevealed ? ' em premiação final' : ' garantidos'}` : 'premiação publicada antes da abertura'}.` : 'Informações comerciais serão publicadas apenas quando uma edição futura for oficialmente aberta.'}</small></span>
                {moreToggle}
              </summary>
              <div className="border-t border-zinc-700 p-3">
                {STORE_SUBMISSION_PAID_ENROLLMENT_ENABLED ? <section className="paid-edition-card">
                  <div><CalendarClock /><span><small>INSCRIÇÕES</small><b>{dateLabel(championship?.registrationOpensAt)} — {dateLabel(championship?.registrationClosesAt)}</b></span></div>
                  <div><Trophy /><span><small>COMPETIÇÃO</small><b>{dateLabel(championship?.startAt)} — {dateLabel(championship?.endAt)}</b></span></div>
                  <div><ShieldCheck /><span><small>HOMOLOGAÇÃO DO RESULTADO</small><b>{dateLabel(championship?.settlementAt)}</b></span></div>
                  <div><Medal /><span><small>{prizeRevealed ? 'PREMIAÇÃO FINAL' : 'PRÊMIO MÍNIMO GARANTIDO'}</small><b>{displayedPrizePool ? brl(displayedPrizePool) : 'A definir antes da abertura'}</b></span></div>
                  {!prizeRevealed && !!displayedPrizePool && <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">Este valor é garantido independentemente do número de inscritos. O valor final é revelado quando as inscrições fecharem em {dateLabel(championship?.registrationClosesAt)}.</p>}
                  {!!displayedPrizeDistribution.length && <div className="paid-prize-list">{displayedPrizeDistribution.map((prize) => <span key={prize.rank}>{prize.rank}º — {brl(prize.amount)}</span>)}</div>}
                </section> : <section className="paid-edition-card">
                  <div><ShieldCheck /><span><small>STATUS DA VERSÃO SUBMETIDA</small><b>EM BREVE — SEM EDIÇÃO PAGA ATIVA</b></span></div>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">Nenhuma taxa, janela de inscrição ou premiação em dinheiro está ativa nesta versão. Uma edição futura exigirá nova publicação das condições antes de qualquer inscrição.</p>
                </section>}
              </div>
            </details>

            <details className="group overflow-hidden rounded-2xl border border-zinc-700 bg-[#101012]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0"><b className="block font-black text-white">REGULAMENTO OFICIAL</b><small className="mt-1 block leading-relaxed text-zinc-200">{STORE_SUBMISSION_PAID_ENROLLMENT_ENABLED ? `${rules.length} tópicos oficiais. Abra apenas quando quiser consultar todos.` : 'O regulamento específico será publicado antes da abertura de uma futura edição paga.'}</small></span>
                {moreToggle}
              </summary>
              <div className="border-t border-zinc-700 p-3">
                <section className="paid-rules" aria-label="Regulamento oficial do campeonato">
                  {STORE_SUBMISSION_PAID_ENROLLMENT_ENABLED ? <>{rules.map((section) => <article key={section.id}><h3>{section.title}</h3><p>{section.content}</p></article>)}<article><h3>APPLE / APP STORE</h3><p>{APPLE_CHAMPIONSHIP_DISCLAIMER}</p></article></> : <article><h3>EDIÇÃO FUTURA</h3><p>A modalidade paga não está aberta nesta versão. Antes de uma futura abertura, a Invictus publicará o regulamento aplicável, elegibilidade, calendário e demais condições da edição.</p></article>}
                </section>
              </div>
            </details>
          </section>

          <section className="paid-legal-highlight">
            <Landmark /><div><b>ORGANIZADOR</b><p>{CHAMPIONSHIP_ORGANIZER.legalName}<br />CNPJ {CHAMPIONSHIP_ORGANIZER.cnpj}<br />{CHAMPIONSHIP_ORGANIZER.contactEmail}</p></div>
          </section>

          {isNativeAndroid && canStartEnrollment && <section className="paid-platform-notice"><ExternalLink /><div><b>INSCRIÇÃO NO ANDROID</b><p>{ANDROID_EXTERNAL_ENROLLMENT_NOTICE}</p></div></section>}
          {!Capacitor.isNativePlatform() && canStartEnrollment && <section className="paid-platform-notice"><ExternalLink /><div><b>INSCRIÇÃO PELO SITE</b><p>O fluxo web usará a mesma conta e o mesmo backend. O botão de pagamento será habilitado quando o site oficial estiver pronto.</p></div></section>}

          {error && <p className="paid-error" role="alert">{error}</p>}

          {isNativeIOS && canStartEnrollment && <button
            className="paid-enroll-button"
            disabled={loading || busy || !championship?.registrationOpen}
            onClick={openEnrollmentConsent}
          >
            {busy ? 'PREPARANDO INSCRIÇÃO…' : championship?.registrationOpen ? `INSCREVER-SE — ${brl(price)}` : unavailableRegistrationLabel(championship)}
            {!busy && championship?.registrationOpen && <ExternalLink />}
          </button>}

          {canStartEnrollment && championship && !championship.registrationOpen && <p className="paid-readiness"><ShieldCheck /> {championship.registrationReadinessReason || 'A edição será aberta quando calendário e premiação estiverem publicados.'}</p>}

          <button className="ch-preview-back" onClick={() => navigate('/championships')}><ArrowLeft /> VOLTAR AOS CAMPEONATOS</button>
        </div>
      </main>

      {consentOpen && <div className="fixed inset-0 z-[10040] flex items-end justify-center bg-black/75 p-3 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-label="Aceites obrigatórios da inscrição">
        <div className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-[28px] border border-zinc-800 bg-[#0b0b0c] p-5 text-white shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <small className="font-bold uppercase tracking-[.16em] text-amber-400">Antes do pagamento</small>
              <h2 className="mt-1 text-xl font-black">Confirme os aceites</h2>
              <p className="mt-1 text-xs leading-relaxed text-zinc-400">Dois aceites rápidos. Depois você será levado diretamente ao checkout seguro.</p>
            </div>
            <button type="button" onClick={() => !busy && setConsentOpen(false)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-300" aria-label="Fechar"><X className="h-5 w-5" /></button>
          </div>

          <div className="mt-5 space-y-3">
            <label className="flex cursor-pointer gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
              <input type="checkbox" checked={rulesAccepted} onChange={(event) => setRulesAccepted(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-amber-400" />
              <span className="min-w-0"><b className="block text-sm">Li e aceito o Regulamento Oficial</b><small className="mt-1 block text-xs leading-relaxed text-zinc-400">Inclui elegibilidade, desempenho, antifraude, premiação, revisão, cancelamento e privacidade.</small></span>
            </label>
            <details className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-xs text-zinc-400">
              <summary className="cursor-pointer font-bold text-zinc-200">Ver regulamento completo</summary>
              <div className="mt-3 space-y-3">
                {rules.map((section) => <div key={section.id}><b className="text-zinc-200">{section.title}</b><p className="mt-1 whitespace-pre-line leading-relaxed">{section.content}</p></div>)}
                <div><b className="text-zinc-200">APPLE / APP STORE</b><p className="mt-1 whitespace-pre-line leading-relaxed">{APPLE_CHAMPIONSHIP_DISCLAIMER}</p></div>
              </div>
            </details>

            <label className="flex cursor-pointer gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
              <input type="checkbox" checked={hrAccepted} onChange={(event) => setHrAccepted(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-amber-400" />
              <span className="min-w-0"><b className="block text-sm">Estou ciente sobre frequência cardíaca</b><small className="mt-1 block text-xs leading-relaxed text-zinc-400">Entendi as condições de uso dos dados cardíacos nas regras competitivas.</small></span>
            </label>
            <details className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-xs text-zinc-400">
              <summary className="cursor-pointer font-bold text-zinc-200">Ver aviso completo de frequência cardíaca</summary>
              <p className="mt-3 whitespace-pre-line leading-relaxed">{COMPETITIVE_HR_FULL_TEXT}</p>
            </details>
          </div>

          {consentError && <p className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-300" role="alert">{consentError}</p>}

          <button
            type="button"
            onClick={() => void confirmEnrollment()}
            disabled={busy || !rulesAccepted || !hrAccepted}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-300 to-amber-500 px-4 py-4 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'ABRINDO CHECKOUT…' : `ACEITAR E PAGAR ${brl(price)}`}<ExternalLink className="h-4 w-4" />
          </button>
          <p className="mt-3 text-center text-[10px] leading-relaxed text-zinc-500">A inscrição só é confirmada após a confirmação financeira do Asaas.</p>
        </div>
      </div>}
    </>,
    document.body,
  );
}
