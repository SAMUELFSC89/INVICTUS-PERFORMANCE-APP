import React, { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, QrCode, Copy, Check, CreditCard, ShieldCheck, ArrowLeft, RefreshCw } from 'lucide-react';
import { championshipService } from '../../services/championshipService';
import { useUser } from '../../UserContext';

export const ChampionshipCheckoutAsaas: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useUser();
  const champ = championshipService.getChampionshipById(id || 'invictus_arena_30d');

  const [paymentType, setPaymentType] = useState<'pix' | 'card'>('pix');
  const [copied, setCopied] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);

  const pixCode = '00020126580014BR.GOV.BCB.PIX0136123e4567-e89b-12d3-a456-426614174000520400005303986540549.905802BR5925INVICTUS FIT PARTICIPACOE6009SAO PAULO62070503***6304E8A2';

  const handleCopyPix = () => {
    navigator.clipboard.writeText(pixCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const handleSimulatePaymentApproval = async () => {
    if (!champ || !user) return;
    setIsSimulating(true);

    try {
      // 1. Trigger server-side webhook simulation
      await fetch('/api/championships/webhook-asaas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'PAYMENT_CONFIRMED',
          payment: {
            id: `pay_asaas_live_${Date.now()}`,
            externalReference: `CHAMPIONSHIP_REGISTRATION:${user.uid}:${champ.id}`,
            value: champ.registrationPrice,
            status: 'RECEIVED'
          }
        })
      });

      // 2. Activate registration in client storage
      championshipService.confirmPaymentMock(champ.id, user.uid);

      // 3. Navigate to Confirmation Screen
      navigate(`/championships/${champ.id}/confirmed`);
    } catch (e) {
      console.error('Error simulating approval', e);
      championshipService.confirmPaymentMock(champ.id, user.uid);
      navigate(`/championships/${champ.id}/confirmed`);
    } finally {
      setIsSimulating(false);
    }
  };

  return (
    <div className="w-full min-h-screen bg-[#07090e] text-white pb-20 max-w-md mx-auto select-none flex flex-col justify-between">
      <div>
        {/* Browser Mock Header */}
        <div className="bg-[#0f1422] border-b border-zinc-800 px-4 py-2.5 flex items-center justify-between text-zinc-400 text-[11px] font-sans">
          <button onClick={() => navigate(`/championships/${id}/register`)} className="text-zinc-400 hover:text-white flex items-center gap-1">
            <ArrowLeft size={14} />
          </button>
          <div className="flex items-center gap-1.5 bg-[#07090e] px-3 py-1 rounded-full border border-zinc-800 text-zinc-300">
            <Lock size={11} className="text-emerald-400" />
            <span className="font-mono text-[10px]">checkout.asaas.com</span>
          </div>
          <div className="w-4" />
        </div>

        {/* Asaas Brand Header */}
        <div className="p-5 text-center border-b border-zinc-800/80 bg-gradient-to-b from-[#0e172e] to-[#07090e]">
          <div className="inline-flex items-center justify-center mb-3">
            <span className="text-[26px] font-black tracking-tight text-[#004bf7] font-sans">
              as<span className="text-[#00c0f3]">aas</span>
            </span>
          </div>

          <h1 className="text-[17px] font-bold font-sans text-white">
            {champ?.title || 'Invictus Arena 30D'}
          </h1>
          <p className="text-[11px] text-zinc-400 font-sans mt-0.5">
            Inscrição oficial no campeonato
          </p>

          <div className="text-[24px] font-extrabold font-bebas tracking-wide text-white mt-2">
            R$ {champ?.registrationPrice.toFixed(2).replace('.', ',') || '49,90'}
          </div>
        </div>

        {/* Payment Tabs: PIX / CARTÃO */}
        <div className="px-5 pt-4">
          <div className="grid grid-cols-2 gap-2 p-1 bg-[#121624] border border-zinc-800 rounded-xl mb-4">
            <button
              onClick={() => setPaymentType('pix')}
              className={`py-2 rounded-lg text-[12px] font-bold font-sans flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                paymentType === 'pix'
                  ? 'bg-[#004bf7] text-white shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <QrCode size={14} />
              <span>Pix</span>
            </button>
            <button
              onClick={() => setPaymentType('card')}
              className={`py-2 rounded-lg text-[12px] font-bold font-sans flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                paymentType === 'card'
                  ? 'bg-[#004bf7] text-white shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <CreditCard size={14} />
              <span>Cartão</span>
            </button>
          </div>

          {/* PIX CONTENT */}
          {paymentType === 'pix' && (
            <div className="bg-[#121624] border border-zinc-800 rounded-2xl p-5 text-center space-y-4 shadow-xl">
              {/* QR Code Container */}
              <div className="w-48 h-48 mx-auto bg-white rounded-xl p-3 flex flex-col items-center justify-center shadow-lg">
                <svg viewBox="0 0 100 100" className="w-full h-full text-black">
                  {/* Stylized QR Code Matrix */}
                  <rect width="100" height="100" fill="white" />
                  {/* Position squares */}
                  <rect x="5" y="5" width="28" height="28" fill="black" />
                  <rect x="9" y="9" width="20" height="20" fill="white" />
                  <rect x="13" y="13" width="12" height="12" fill="black" />

                  <rect x="67" y="5" width="28" height="28" fill="black" />
                  <rect x="71" y="9" width="20" height="20" fill="white" />
                  <rect x="75" y="13" width="12" height="12" fill="black" />

                  <rect x="5" y="67" width="28" height="28" fill="black" />
                  <rect x="9" y="71" width="20" height="20" fill="white" />
                  <rect x="13" y="75" width="12" height="12" fill="black" />

                  {/* QR Data Dots */}
                  <rect x="38" y="8" width="6" height="6" fill="black" />
                  <rect x="48" y="14" width="6" height="6" fill="black" />
                  <rect x="40" y="24" width="8" height="8" fill="black" />
                  <rect x="54" y="22" width="6" height="6" fill="black" />

                  <rect x="8" y="38" width="8" height="8" fill="black" />
                  <rect x="22" y="44" width="6" height="6" fill="black" />
                  <rect x="36" y="38" width="12" height="12" fill="black" />
                  <rect x="52" y="42" width="8" height="8" fill="black" />
                  <rect x="66" y="38" width="8" height="8" fill="black" />
                  <rect x="80" y="44" width="10" height="10" fill="black" />

                  <rect x="38" y="56" width="8" height="8" fill="black" />
                  <rect x="50" y="54" width="10" height="10" fill="black" />
                  <rect x="68" y="58" width="6" height="6" fill="black" />
                  <rect x="82" y="66" width="8" height="8" fill="black" />

                  <rect x="38" y="72" width="10" height="10" fill="black" />
                  <rect x="52" y="76" width="8" height="8" fill="black" />
                  <rect x="66" y="74" width="10" height="10" fill="black" />
                  <rect x="80" y="82" width="8" height="8" fill="black" />
                </svg>
                <span className="text-[9px] font-extrabold font-sans text-zinc-900 tracking-wider mt-1 block">
                  PAGUE COM PIX
                </span>
              </div>

              {/* Copy Pix Button */}
              <button
                onClick={handleCopyPix}
                className="w-full py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 text-[12px] font-bold font-sans flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                <span>{copied ? 'Código Pix Copiado!' : 'Copiar código Pix'}</span>
              </button>

              <p className="text-[11px] text-zinc-400 font-sans">
                O pagamento será processado e homologado pelo Asaas.
              </p>
            </div>
          )}

          {/* CARD CONTENT */}
          {paymentType === 'card' && (
            <div className="bg-[#121624] border border-zinc-800 rounded-2xl p-4 text-center space-y-3 shadow-xl">
              <p className="text-[12px] text-zinc-300 font-sans">
                Checkout de Cartão Seguro Asaas (Sem armazenamento local de dados).
              </p>
              <div className="p-3 bg-zinc-900/80 rounded-xl border border-zinc-800 text-left space-y-2 text-[11px] text-zinc-400 font-sans">
                <div>• Número do Cartão: **** **** **** 4022</div>
                <div>• Validade: 12/28</div>
                <div>• Titular: {user?.name || 'Atleta Invictus'}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer Safety & Sandbox Confirmation Action */}
      <div className="p-5 space-y-3 bg-[#07090e] border-t border-zinc-800/80">
        <div className="flex items-center justify-center gap-1.5 text-emerald-400 text-[11px] font-sans">
          <ShieldCheck size={14} />
          <span>Asaas · Ambiente 100% seguro</span>
        </div>

        {/* Sandbox Test Trigger to simulate Webhook Confirmation */}
        <button
          onClick={handleSimulatePaymentApproval}
          disabled={isSimulating}
          className="w-full py-3 rounded-xl bg-[#004bf7] hover:bg-blue-600 text-white font-sans text-[13px] font-bold flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition-all cursor-pointer"
        >
          {isSimulating ? (
            <>
              <RefreshCw size={15} className="animate-spin" />
              <span>Confirmando via Webhook Asaas...</span>
            </>
          ) : (
            <>
              <Check size={16} />
              <span>Simular Pagamento Aprovado (Asaas)</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
