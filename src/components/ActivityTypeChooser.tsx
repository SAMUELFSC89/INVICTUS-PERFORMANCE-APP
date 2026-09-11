import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowLeft, ChevronRight, Dumbbell, Footprints, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { InvictusLogo } from './InvictusLogo';
import { verifyActiveSessionBeforeStart } from '../services/activeSessionStartGuard';

export function ActivityTypeChooser() {
  const navigate = useNavigate();
  const [checkingActiveSession, setCheckingActiveSession] = useState(true);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const checkActiveSession = async () => {
    setCheckingActiveSession(true);
    setRestoreError(null);
    try {
      const session = await verifyActiveSessionBeforeStart();
      if (session) {
        navigate('/activity/ongoing', { replace: true });
        return;
      }
      setCheckingActiveSession(false);
    } catch (error: any) {
      setRestoreError(error?.message || 'Não foi possível verificar sua atividade em andamento. Confira a conexão antes de iniciar outra atividade.');
      setCheckingActiveSession(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setCheckingActiveSession(true);
    setRestoreError(null);

    void verifyActiveSessionBeforeStart()
      .then((session) => {
        if (cancelled) return;
        if (session) navigate('/activity/ongoing', { replace: true });
        else setCheckingActiveSession(false);
      })
      .catch((error: any) => {
        if (!cancelled) {
          setRestoreError(error?.message || 'Não foi possível verificar sua atividade em andamento. Confira a conexão antes de iniciar outra atividade.');
          setCheckingActiveSession(false);
        }
      });

    return () => { cancelled = true; };
  }, [navigate]);

  const blocked = checkingActiveSession || Boolean(restoreError);

  return createPortal(
    <main className="activity-type-screen">
      <div className="activity-type-page">
        <header className="activity-type-header">
          <button type="button" onClick={() => navigate('/')} aria-label="Voltar para o início">
            <ArrowLeft />
          </button>
          <div>
            <InvictusLogo size={40} />
            <span><b>INVICTUS</b><small>PERFORMANCE</small></span>
          </div>
          <span aria-hidden="true" />
        </header>

        <section className="activity-type-heading" aria-labelledby="activity-type-title">
          <small>INICIAR ATIVIDADE</small>
          <h1 id="activity-type-title">{checkingActiveSession ? 'VERIFICANDO ATIVIDADE…' : restoreError ? 'CONFIRME SUA SESSÃO' : 'O QUE VOCÊ VAI TREINAR?'}</h1>
          <p>{checkingActiveSession ? 'Estamos conferindo se existe um treino em andamento antes de abrir uma nova atividade.' : restoreError || 'Escolha uma modalidade para continuar.'}</p>
        </section>

        {restoreError ? <section role="alert" className="activity-type-note"><AlertTriangle size={18} /><span>{restoreError}</span><button type="button" onClick={() => void checkActiveSession()}><RefreshCw size={16} /> TENTAR NOVAMENTE</button></section> : null}

        <section className="activity-type-options" aria-label="Escolha da modalidade" aria-busy={checkingActiveSession}>
          <button type="button" className="activity-type-option" disabled={blocked} onClick={() => navigate('/musculacao')}>
            <span className="activity-type-icon"><Dumbbell /></span>
            <span className="activity-type-copy">
              <small>FORÇA E HIPERTROFIA</small>
              <strong>MUSCULAÇÃO</strong>
              <em>Seu plano, cargas e evolução.</em>
            </span>
            <ChevronRight />
          </button>

          <button type="button" className="activity-type-option" disabled={blocked} onClick={() => navigate('/challenges/cardio')}>
            <span className="activity-type-icon"><Footprints /></span>
            <span className="activity-type-copy">
              <small>RESISTÊNCIA E CONDICIONAMENTO</small>
              <strong>CARDIO</strong>
              <em>Corrida, bike e atividades ao ar livre.</em>
            </span>
            <ChevronRight />
          </button>
        </section>

        <p className="activity-type-note">Se a atividade contar para o IGA, inicie também um treino no seu relógio antes de começar e mantenha-o ativo até finalizar. Isso melhora a coleta de frequência cardíaca usada para medir a intensidade do esforço. Você poderá escolher o tipo específico de cardio na próxima tela.</p>
      </div>
    </main>,
    document.body,
  );
}
