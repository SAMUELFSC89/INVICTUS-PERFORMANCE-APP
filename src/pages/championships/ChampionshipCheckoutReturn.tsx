import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BadgeCheck, Clock3, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { championshipService } from '../../services/championshipService';
import { InvictusLogo } from '../../components/InvictusLogo';
import './PaidChampionship.css';

const VALID_IDS = new Set(['invictus_strength_v1', 'invictus_cardio_v1']);
const VALID_STATUS = new Set(['success', 'cancelled', 'expired']);

export function ChampionshipCheckoutReturn() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const championshipId = VALID_IDS.has(params.get('championshipId') || '') ? String(params.get('championshipId')) : '';
  const status = VALID_STATUS.has(params.get('status') || '') ? String(params.get('status')) : 'cancelled';
  const [checking, setChecking] = useState(status === 'success');
  const [paid, setPaid] = useState(false);
  const [message, setMessage] = useState(status === 'success' ? 'Confirmando o pagamento com o servidor…' : 'Nenhuma inscrição foi confirmada.');

  const previewPath = useMemo(() => championshipId === 'invictus_strength_v1'
    ? '/championships/preview/musculacao'
    : '/championships/preview/cardio', [championshipId]);

  const checkRegistration = async (): Promise<boolean> => {
    if (!championshipId) return false;
    const registration = await championshipService.getRegistration(championshipId);
    const confirmed = registration?.status === 'ACTIVE' && registration.paymentStatus === 'PAID';
    setPaid(confirmed);
    if (confirmed) setMessage('Pagamento confirmado. Sua inscrição está ativa.');
    return confirmed;
  };

  useEffect(() => {
    if (status !== 'success' || !championshipId) {
      setChecking(false);
      return;
    }
    let disposed = false;
    void (async () => {
      for (let attempt = 0; attempt < 8 && !disposed; attempt += 1) {
        if (await checkRegistration()) {
          setChecking(false);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
      if (!disposed) {
        setChecking(false);
        setMessage('O checkout foi concluído, mas a confirmação financeira ainda não chegou. Você pode atualizar o status sem pagar novamente.');
      }
    })();
    return () => { disposed = true; };
  }, [championshipId, status]);

  const Icon = paid ? BadgeCheck : status === 'success' ? Clock3 : XCircle;
  const title = paid ? 'INSCRIÇÃO CONFIRMADA' : status === 'expired' ? 'CHECKOUT EXPIRADO' : status === 'cancelled' ? 'CHECKOUT CANCELADO' : 'AGUARDANDO CONFIRMAÇÃO';

  return createPortal(<main className="ch-new-screen paid-return-screen"><section className="paid-return-card">
    <InvictusLogo size={58} />
    <Icon className={paid ? 'is-paid' : ''} />
    <small>INVICTUS PERFORMANCE</small>
    <h1>{title}</h1>
    <p>{message}</p>
    {status === 'success' && !paid && <button disabled={checking} onClick={() => void checkRegistration()}>{checking ? <RefreshCw className="spin" /> : <RefreshCw />} ATUALIZAR STATUS</button>}
    <button className="secondary" onClick={() => navigate(previewPath, { replace: true })}><ShieldCheck /> VOLTAR AO CAMPEONATO</button>
    <span>O retorno do navegador não confirma pagamento. A inscrição só é ativada após a confirmação do Asaas recebida pelo servidor.</span>
  </section></main>, document.body);
}
