import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ChevronRight, Clock3, RotateCcw, ShieldCheck } from 'lucide-react';
import { auth } from '../firebase';
import { API_CONFIG } from '../config';
import { InvictusLogo } from '../components/InvictusLogo';
import { useUser } from '../UserContext';
import './PaymentSuccessNew.css';

type PaymentStatus = 'pending'|'processing'|'approved'|'rejected'|'cancelled'|'expired'|'revoked'|'refunded'|'charged_back'|'error';
const FINAL = new Set<PaymentStatus>(['approved','rejected','cancelled','expired','revoked','refunded','charged_back']);
const ENTITLEMENT_FINAL = new Set<PaymentStatus>(['approved','expired','revoked','refunded','charged_back']);

export function PaymentSuccess() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refreshUser } = useUser();
  const orderId = params.get('orderId');
  const path = window.location.pathname;
  const failurePage = path.includes('/pagamento/falha');
  const pendingPage = path.includes('/pagamento/pendente');
  const [status,setStatus] = useState<PaymentStatus>(failurePage?'rejected':'pending');
  const [message,setMessage] = useState(failurePage?'Não foi possível aprovar o pagamento. Tente novamente com outro método.':pendingPage?'Seu pagamento está sendo processado. A liberação acontecerá automaticamente após a confirmação.':'Estamos confirmando seu pagamento. Assim que for aprovado, seu acesso será liberado.');
  // Mesmo o redirect de falha é apenas um sinal do provedor. Quando existe um
  // orderId, o backend autenticado continua sendo a fonte canônica do estado.
  const [checking,setChecking] = useState(Boolean(orderId));
  const failures = useRef(0);

  useEffect(()=>{
    if(!orderId){
      if(!failurePage){setStatus('error');setMessage('O retorno não contém um identificador de pedido válido.');}
      setChecking(false);
      return;
    }
    let active=true; let timer:number|undefined;
    const check=async()=>{
      try{
        await auth.authStateReady();
        const account=auth.currentUser;
        if(!account) throw new Error('Sessão ainda indisponível.');
        const expectedUid=account.uid;
        const token=await account.getIdToken();
        if(auth.currentUser?.uid!==expectedUid) return;
        const paymentId=params.get('payment_id')||params.get('paymentId');
        const suffix=paymentId?`?paymentId=${encodeURIComponent(paymentId)}`:'';
        const response=await fetch(`${API_CONFIG.baseUrl}/api/payments/status/${encodeURIComponent(orderId)}${suffix}`,{headers:{Authorization:`Bearer ${token}`}});
        if(!response.ok) throw new Error('Falha ao consultar o pagamento.');
        const data=await response.json();
        if(!active||auth.currentUser?.uid!==expectedUid||!data.success) return;
        const next=data.status as PaymentStatus;
        setStatus(next); setMessage(data.message||'');
        failures.current=0;
        if(FINAL.has(next)){
          // Aprovação, expiração, estorno ou chargeback alteram o entitlement.
          // Não deixe UserContext preso na projeção anterior depois de o
          // servidor já ter confirmado o estado novo.
          if(ENTITLEMENT_FINAL.has(next) && auth.currentUser?.uid===expectedUid){
            try { await refreshUser?.(); } catch (error) { console.warn('[PaymentSuccess] Status confirmado, mas o perfil não pôde ser recarregado:', error); }
          }
          if(active&&auth.currentUser?.uid===expectedUid) setChecking(false);
          return;
        }
      }catch{
        failures.current+=1;
        if(failures.current>=6&&active){setStatus('error');setMessage('Não foi possível verificar o pagamento agora. Consulte seu extrato antes de tentar novamente.');setChecking(false);return;}
      }
      if(active) timer=window.setTimeout(check,3000);
    };
    void check();
    return()=>{active=false;if(timer)window.clearTimeout(timer);};
  },[failurePage,orderId,params,refreshUser]);

  const approved=status==='approved';
  const revoked=status==='expired'||status==='revoked'||status==='refunded'||status==='charged_back';
  const pending=checking&&(status==='pending'||status==='processing'||(failurePage&&status==='rejected'));
  return createPortal(<main className="payn-screen"><section className="payn-card"><header><InvictusLogo size={72}/><b>INVICTUS</b><small>PERFORMANCE</small></header>
    {pending?<><div className="payn-icon is-pending"><Clock3/></div><small className="payn-label">PAGAMENTO EM ANÁLISE</small><h1>CONFIRMANDO PAGAMENTO</h1><p>{failurePage?'O provedor retornou uma falha, mas estamos confirmando o estado real do pedido antes de encerrar.':message}</p>{orderId?<code>Pedido #{orderId}</code>:null}<div className="payn-progress"><i/></div><em>Você pode sair desta tela. A confirmação também ocorre pelo servidor.</em></>:null}
    {approved?<><div className="payn-icon is-approved"><CheckCircle2/></div><small className="payn-label">PAGAMENTO CONFIRMADO</small><h1>ACESSO PRO LIBERADO</h1><p>{message||'Sua assinatura foi ativada. Os benefícios do plano já estão disponíveis.'}</p><div className="payn-note"><ShieldCheck/><span>A assinatura não inscreve automaticamente em campeonatos ou temporadas.</span></div><button onClick={()=>navigate('/')}>IR PARA O INÍCIO <ChevronRight/></button></>:null}
    {!pending&&!approved&&!revoked?<><div className="payn-icon is-failed"><AlertCircle/></div><small className="payn-label">PAGAMENTO NÃO CONCLUÍDO</small><h1>VERIFIQUE O PAGAMENTO</h1><p>{message}</p><button className="is-outline" onClick={()=>navigate('/profile/preferences/subscriptions')}><RotateCcw/> VER PLANOS</button></>:null}
    {revoked?<><div className="payn-icon is-failed"><AlertCircle/></div><small className="payn-label">STATUS DA ASSINATURA</small><h1>ACESSO PRO INATIVO</h1><p>{message||'A assinatura não concede acesso Pro neste momento.'}</p>{status==='charged_back'?<div className="payn-note is-alert"><AlertCircle/><span>A transação está sob revisão de segurança.</span></div>:null}<button className="is-outline" onClick={()=>navigate('/profile/preferences/subscriptions')}>VER ASSINATURA</button></>:null}
  </section></main>,document.body);
}
export default PaymentSuccess;
