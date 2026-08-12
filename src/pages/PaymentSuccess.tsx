import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Loader2, Sparkles, ChevronRight, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth } from '../firebase';

export function PaymentSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const orderId = searchParams.get('orderId');

  const path = window.location.pathname;
  const isPendentePage = path.includes('/pagamento/pendente');
  const isFalhaPage = path.includes('/pagamento/falha');

  const [status, setStatus] = useState<'pending' | 'processing' | 'approved' | 'rejected' | 'cancelled' | 'refunded' | 'charged_back' | 'error'>(() => {
    if (isFalhaPage) return 'rejected';
    return 'pending';
  });

  const [message, setMessage] = useState(() => {
    if (isFalhaPage) return 'Não foi possível aprovar o pagamento. Tente novamente com outro método.';
    if (isPendentePage) return 'Seu pagamento está sendo processado. A liberação acontece automaticamente após a confirmação.';
    return 'Estamos confirmando seu pagamento. Assim que for aprovado, seu acesso será liberado.';
  });

  const [loading, setLoading] = useState(!isFalhaPage);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (isFalhaPage) {
      setLoading(false);
      return;
    }

    if (!orderId) {
      setStatus('error');
      setMessage('Nenhum identificador de pedido foi fornecido.');
      setLoading(false);
      return;
    }

    let isMounted = true;
    let pollInterval: NodeJS.Timeout;

    const checkStatus = async () => {
      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) {
          console.warn('[PaymentSuccess] Standard user session token not fetched yet. Retrying...');
          return;
        }

        const paymentIdFromUrl = searchParams.get('payment_id') || searchParams.get('paymentId');
        const queryUrl = `/api/payments/status/${orderId}${paymentIdFromUrl ? `?paymentId=${paymentIdFromUrl}` : ''}`;
        console.log(`[PaymentSuccess] Querying status redundantly: ${queryUrl}`);

        const res = await fetch(queryUrl, {
          headers: {
            'Authorization': `Bearer ${idToken}`
          }
        });

        if (!res.ok) {
          throw new Error('Falha na requisição de consulta de status.');
        }

        const data = await res.json();
        if (!isMounted) return;

        if (data.success) {
          const currentStatus = data.status;
          setStatus(currentStatus);
          setMessage(data.message || '');
          
          if (currentStatus === 'approved' || currentStatus === 'rejected' || currentStatus === 'cancelled' || currentStatus === 'refunded' || currentStatus === 'charged_back') {
            setLoading(false);
            clearInterval(pollInterval);
          }
        }
      } catch (err) {
        console.error('[PaymentSuccess Error] Status polling error:', err);
        if (isMounted && retryCount > 5) {
          setStatus('error');
          setMessage('Ocorreu uma falha de conexão na verificação. Por favor, verifique seu extrato bancário ou carteira.');
          setLoading(false);
          clearInterval(pollInterval);
        }
      }
    };

    // Run first check
    checkStatus();

    // Setup active polling every 3 seconds
    pollInterval = setInterval(() => {
      setRetryCount(prev => prev + 1);
      checkStatus();
    }, 3000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [orderId, retryCount]);

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 bg-background-neutral text-on-surface">
      <div className="w-full max-w-md p-8 rounded-3xl bg-surface-elevation-1 border border-border-neutral shadow-2xl relative overflow-hidden text-center">
        
        {/* Absolute Design Accents */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-primary to-secondary opacity-80" />
        
        <AnimatePresence mode="wait">
          {loading && (status === 'pending' || status === 'processing') && (
            <motion.div
              key="pending-ui"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col items-center space-y-6"
            >
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary relative">
                <Loader2 className="w-8 h-8 animate-spin" />
                <div className="absolute inset-0 rounded-2xl border-2 border-primary/20 animate-ping" />
              </div>

              <div className="space-y-3">
                <h2 className="text-xl font-bold font-sans tracking-tight">Confirmando Pagamento</h2>
                <p className="text-sm text-on-surface-variant font-label max-w-xs mx-auto">
                  {message || 'Estamos confirmando seu pagamento junto ao Mercado Pago. Isso pode levar alguns instantes.'}
                </p>
              </div>

              <div className="text-xs text-on-surface-variant font-mono bg-surface-elevation-2 px-3 py-1.5 rounded-full border border-border-neutral">
                Pedido: #{orderId}
              </div>

              <p className="text-xs text-on-surface-variant italic animate-pulse">
                Aguardando resposta do gateway... Por favor, não feche esta tela.
              </p>
            </motion.div>
          )}

          {status === 'approved' && (
            <motion.div
              key="approved-ui"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', damping: 15 }}
              className="flex flex-col items-center space-y-6"
            >
              <div className="w-20 h-20 rounded-full bg-success/15 border-4 border-success/35 flex items-center justify-center text-success relative">
                <CheckCircle2 className="w-10 h-10" />
                <Sparkles className="absolute -top-1 -right-1 w-5 h-5 text-warning animate-bounce" />
              </div>

              <div className="space-y-3">
                <h2 className="text-2xl font-bold font-sans tracking-tight text-success">Pagamento Confirmado!</h2>
                <h3 className="text-sm font-semibold text-primary uppercase tracking-wider font-sans">Acesso PRO Liberado</h3>
                <p className="text-sm text-on-surface-variant max-w-xs mx-auto">
                  Parabéns! Sua assinatura do Invictus foi ativada com sucesso. Seu ranking oficial, benefícios exclusivos e temporada estão desbloqueados.
                </p>
              </div>

              <div className="w-full pt-4 flex flex-col space-y-3">
                <button
                  id="go-home-btn"
                  onClick={() => navigate('/')}
                  className="w-full py-3.5 bg-primary hover:bg-primary-hover active:scale-[0.98] transition-all text-on-primary rounded-2xl shadow-lg shadow-primary/20 flex items-center justify-center space-x-2 font-semibold text-sm cursor-pointer"
                >
                  <span>Acessar Painel Principal</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {(status === 'rejected' || status === 'cancelled' || status === 'error') && (
            <motion.div
              key="failure-ui"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', damping: 15 }}
              className="flex flex-col items-center space-y-6"
            >
              <div className="w-16 h-16 rounded-2xl bg-error/10 flex items-center justify-center text-error border border-error/20">
                <AlertCircle className="w-8 h-8" />
              </div>

              <div className="space-y-3">
                <h2 className="text-xl font-bold font-sans tracking-tight text-error">Pagamento Não Aprovado</h2>
                <p className="text-sm text-on-surface-variant max-w-xs mx-auto">
                  {message || 'Não foi possível confirmar o recebimento do seu pagamento pelo Mercado Pago. O cartão pode ter sido recusado ou a transação foi cancelada.'}
                </p>
              </div>

              <div className="w-full pt-4">
                <button
                  id="go-settings-btn"
                  onClick={() => navigate('/settings')}
                  className="w-full py-3.5 bg-surface-elevation-2 hover:bg-surface-elevation-3 transition-colors border border-border-neutral text-on-surface rounded-2xl flex items-center justify-center space-x-2 font-semibold text-sm cursor-pointer"
                >
                  <Settings className="w-4 h-4 text-on-surface-variant" />
                  <span>Tentar Novamente (Planos)</span>
                </button>
              </div>
            </motion.div>
          )}

          {(status === 'refunded' || status === 'charged_back') && (
            <motion.div
              key="revocation-ui"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', damping: 15 }}
              className="flex flex-col items-center space-y-6"
            >
              <div className="w-16 h-16 rounded-2xl bg-warning/10 flex items-center justify-center text-warning border border-warning/20">
                <AlertCircle className="w-8 h-8" />
              </div>

              <div className="space-y-2">
                <h2 className="text-xl font-bold font-sans tracking-tight text-warning">Acesso Suspenso</h2>
                <p className="text-sm text-on-surface-variant max-w-sm">
                  Detectamos que este pagamento foi estornado ou que a transação sofreu chargeback. O acesso de sua conta às funcionalidades PRO foi revogado.
                </p>
                {status === 'charged_back' && (
                  <p className="text-xs text-error font-medium mt-1">
                    Sua conta está sob análise em nossa auditoria.
                  </p>
                )}
              </div>

              <div className="w-full pt-4">
                <button
                  id="go-home-revoked-btn"
                  onClick={() => navigate('/')}
                  className="w-full py-3 bg-surface-elevation-2 text-on-surface rounded-2xl text-sm font-semibold border border-border-neutral cursor-pointer"
                >
                  Ir para Painel Comum
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
export default PaymentSuccess;
