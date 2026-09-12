import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, HeartPulse, ShieldCheck, X } from 'lucide-react';
import {
  COMPETITIVE_HR_CHECKBOX,
  COMPETITIVE_HR_FULL_TEXT,
  COMPETITIVE_HR_MODAL_TITLE,
  COMPETITIVE_HR_SUMMARY,
  buildCompetitiveHrAcknowledgement,
  type CompetitiveHrAcknowledgementInput,
} from '../lib/competitiveHeartRateAcknowledgement';

export function CompetitiveHeartRateAcknowledgement({
  open,
  competitionId,
  competitionRulesVersion,
  busy = false,
  error,
  onDecline,
  onAccept,
}: {
  open: boolean;
  competitionId: string;
  competitionRulesVersion: string;
  busy?: boolean;
  error?: string | null;
  onDecline: () => void;
  onAccept: (acceptance: CompetitiveHrAcknowledgementInput) => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    if (open) {
      setAccepted(false);
      setExpanded(false);
    }
  }, [open, competitionId, competitionRulesVersion]);
  if (!open) return null;

  return createPortal(<div className="fixed inset-0 z-[10030] flex items-end justify-center bg-black/80 p-3 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-labelledby="competitive-hr-title">
    <section className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-[26px] border border-[#F5A623]/35 bg-[#0b0a08] p-5 text-white shadow-2xl">
      <header className="flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[#F5A623]/25 bg-[#F5A623]/10 text-[#F5A623]"><HeartPulse /></span>
        <div className="min-w-0 flex-1"><small className="text-[9px] font-black uppercase tracking-[.2em] text-[#F5A623]">Participação competitiva</small><h2 id="competitive-hr-title" className="mt-1 text-lg font-black uppercase leading-tight">{COMPETITIVE_HR_MODAL_TITLE}</h2></div>
        <button type="button" onClick={onDecline} disabled={busy} aria-label="Não participar" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5"><X size={18} /></button>
      </header>

      <p className="mt-4 text-sm leading-relaxed text-white/75">{COMPETITIVE_HR_SUMMARY}</p>
      <ul className="mt-4 space-y-2 text-xs text-white/70">
        <li className="flex gap-2"><ShieldCheck size={15} className="shrink-0 text-[#F5A623]" /> Existe variabilidade entre sensores, aparelhos, serviços e amostras.</li>
        <li className="flex gap-2"><ShieldCheck size={15} className="shrink-0 text-[#F5A623]" /> A FC pode influenciar intensidade, validação, pontuação, desempate e classificação.</li>
        <li className="flex gap-2"><ShieldCheck size={15} className="shrink-0 text-[#F5A623]" /> Somente dados recebidos e considerados válidos são processados pelas regras oficiais.</li>
        <li className="flex gap-2"><ShieldCheck size={15} className="shrink-0 text-[#F5A623]" /> Você pode contestar possível erro técnico ou aplicação incorreta das regras.</li>
      </ul>

      <button type="button" onClick={() => setExpanded(value => !value)} className="mt-4 flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-xs font-bold text-[#F5A623]" aria-expanded={expanded}>
        Entender como funciona <ChevronDown size={16} className={expanded ? 'rotate-180' : ''} />
      </button>
      {expanded ? <div className="mt-3 whitespace-pre-line rounded-xl border border-white/8 bg-black/35 p-4 text-[11px] leading-relaxed text-white/65">{COMPETITIVE_HR_FULL_TEXT}</div> : null}

      <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-[#F5A623]/25 bg-[#F5A623]/5 p-4 text-xs leading-relaxed">
        <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#F5A623]" />
        <span>{COMPETITIVE_HR_CHECKBOX}</span>
      </label>
      <p className="mt-3 text-[10px] leading-relaxed text-white/45">Este aceite registra ciência das regras competitivas. Ele não concede, amplia nem substitui autorização para tratar dados de saúde.</p>
      {error ? <p className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-300" role="alert">{error}</p> : null}

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={onDecline} disabled={busy} className="min-h-12 rounded-xl border border-white/15 bg-transparent text-xs font-black uppercase text-white/70">NÃO PARTICIPAR</button>
        <button type="button" disabled={!accepted || busy} onClick={() => void onAccept(buildCompetitiveHrAcknowledgement(competitionId, competitionRulesVersion))} className="min-h-12 rounded-xl bg-[#F5A623] text-xs font-black uppercase text-black disabled:cursor-not-allowed disabled:opacity-35">{busy ? 'REGISTRANDO…' : 'ACEITAR E PARTICIPAR'}</button>
      </div>
    </section>
  </div>, document.body);
}
