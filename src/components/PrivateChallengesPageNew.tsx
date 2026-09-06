import { createPortal } from 'react-dom';
import { ArrowLeft, Bell, Plus, ShieldCheck, Trophy, UserRound, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PrivateChallengesTab } from './PrivateChallengesTab';
import { InvictusLogo } from './InvictusLogo';
import './ActivityHistoryPageNew.css';

// #255 (pedido do usuario, verbatim: "quero excluir essas telas antigas" ->
// "adicione a entrada na hub nova e refaça a tela de desafios pagos conforme
// o layout novo"): Desafios Privados (beneficio PRO de #124/#325, sem dinheiro
// real) so tinha um ponto de entrada -- dentro do catalogo antigo de
// Challenges.tsx, que o usuario pediu para apagar por ser tela morta/duplicada
// da ChallengesHubNew. Em vez de restaurar aquele catalogo so pra hospedar
// esta funcionalidade, esta tela reusa o MESMO container/rodape ja usado por
// ActivityHistoryPageNew (ah-new-* -- header com voltar/logo/sino e rodape com
// os mesmos 5 atalhos), sem duplicar CSS. A logica de negocio (criar/entrar/
// listar desafios, sempre gratis, ver PrivateChallengesTab.tsx) fica 100%
// intacta -- so o container em volta dela mudou para o padrao visual novo.
export function PrivateChallengesPageNew() {
  const navigate = useNavigate();

  return createPortal(
    <main className="ah-new-screen">
      <div className="ah-new-page">
        <header className="ah-new-header">
          <button onClick={() => navigate('/challenges')} aria-label="Voltar para desafios"><ArrowLeft /></button>
          <div><InvictusLogo size={42} /><span><b>INVICTUS</b><small>PERFORMANCE</small></span></div>
          <button onClick={() => navigate('/notifications')} aria-label="Notificações"><Bell /></button>
        </header>

        <section className="ah-new-title">
          <span><Users /></span>
          <div><small>BENEFÍCIO PRO</small><h1>DESAFIOS PRIVADOS</h1><p>Crie ou entre em uma disputa com seus parceiros de treino usando um código de convite — sem nenhum custo.</p></div>
        </section>

        <div className="ah-new-content"><PrivateChallengesTab /></div>
      </div>

      <nav className="ah-new-footer">
        <button onClick={() => navigate('/')}><InvictusLogo size={24} /><span>Início</span></button>
        <button onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button>
        <button className="is-plus" onClick={() => navigate('/activity')} aria-label="Escolher modalidade"><Plus /></button>
        <button className="is-active" onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button>
        <button onClick={() => navigate('/profile')}><UserRound /><span>Perfil</span></button>
      </nav>
    </main>,
    document.body,
  );
}
