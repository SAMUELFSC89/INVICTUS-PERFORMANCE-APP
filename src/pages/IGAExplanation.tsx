import React from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Trophy, Plus, ShieldCheck, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { InvictusLogo } from '../components/InvictusLogo';
import './ProfileSecondary.css';

/**
 * Explicação oficial e legível do IGA 2.0. Mantida separada da tela gigante de
 * Perfil para que a documentação da fórmula possa evoluir sem tocar nos fluxos
 * de academia, wearables, segurança ou assinatura.
 */
export function IGAExplanation() {
  const navigate = useNavigate();
  const go = (path: string) => navigate(path);

  return createPortal(
    <main className="profile-flow-screen profile-flow-screen-new">
      <header>
        <button onClick={() => navigate('/profile/preferences/game')} aria-label="Voltar"><ArrowLeft /></button>
        <div><InvictusLogo size={40}/><span><b>INVICTUS</b><small>PERFORMANCE</small></span></div>
        <span />
      </header>

      <section className="profile-flow-heading">
        <small>ENTENDA O JOGO</small>
        <h1>PONTUAÇÃO IGA</h1>
      </section>

      <div className="profile-flow-content">
        <section className="profile-flow-document">
          <h2>IGA 2.0</h2>
          <p>O IGA transforma treinos válidos em uma pontuação de ranking usando três pilares: consistência, tempo suficiente e qualidade do esforço. Assinatura Free ou Pro não aumenta nem reduz a pontuação.</p>

          <h3>A FÓRMULA</h3>
          <p>IGA = ∛(F × T × I)</p>
          <p>F é Frequência, T é Tempo e I é Intensidade. A raiz cúbica equilibra os três fatores: um único fator muito alto não compensa totalmente outro muito baixo. O IGA não possui teto artificial de 100; 100 é uma referência de equilíbrio, não a nota máxima.</p>

          <h3>FREQUÊNCIA — F</h3>
          <p>Conta sessões válidas na semana. A curva é: 1 treino = 15; 2 = 30; 3 = 55; 4 = 80; 5 ou mais = 100. O IGA considera no máximo as 5 melhores sessões válidas da semana. A 6ª sessão e as seguintes podem continuar sendo registradas normalmente, mas não aumentam F, T ou I e não geram vantagem competitiva.</p>

          <h3>TEMPO — T</h3>
          <p>O tempo é avaliado por sessão com retorno decrescente: 20 min = 70; 30 = 85; 45 = 95; 60 = 100; 75 = 102; 90 = 104. Entre esses pontos, o cálculo é gradual. Depois de 60 minutos, o ganho é pequeno, para não favorecer quem simplesmente dispõe de mais tempo para treinar. Acima de 90 minutos não há ganho adicional em T.</p>

          <h3>INTENSIDADE — I</h3>
          <p>A intensidade usa frequência cardíaca relativa à FC máxima e, quando existe uma série confiável de leituras, considera a distribuição do esforço nas zonas ao longo do treino. A frequência cardíaca funciona como sinal fisiológico do esforço realizado durante a sessão para estimar a intensidade relativa no IGA. Z1 vale menos, Z2 é intermediária, Z3 é a referência, Z4 recebe o maior bônus útil e Z5 não vale mais que Z4. Assim, manter a FC excessivamente alta não vira uma estratégia para acumular IGA.</p>

          <h3>USE O RELÓGIO DURANTE O TREINO</h3>
          <p>Nas atividades que contam para o IGA, recomendamos iniciar também uma atividade no relógio antes de começar o treino no Invictus e mantê-la ativa até o encerramento. Isso favorece uma coleta mais frequente de frequência cardíaca ao longo da sessão e melhora a qualidade da série usada para medir a intensidade.</p>
          <p>O Invictus cruza o horário do treino registrado no aplicativo com os dados disponibilizados pelo Apple Health, Health Connect ou outra fonte conectada. Quando houver uma série confiável de FC dentro da janela do treino, ela tem prioridade no cálculo da intensidade. Se as leituras forem insuficientes, o sistema usa o fallback previsto na metodologia e registra a limitação de cobertura; o aplicativo não inventa nem interpola leituras ausentes.</p>

          <h3>TRANSIÇÃO ENTRE ZONAS</h3>
          <p>As fronteiras Z1/Z2, Z2/Z3, Z3/Z4 e Z4/Z5 têm uma transição contínua de ±5 bpm. Exemplo: se a fronteira Z3/Z4 for 160 bpm, leituras próximas desse valor misturam gradualmente as duas zonas em vez de mudar a pontuação bruscamente por apenas 1 bpm.</p>

          <h3>SUAVIZAÇÃO DA FC</h3>
          <p>Quando há uma série de frequência cardíaca, o motor suaviza oscilações curtas antes de pontuar as zonas. Isso reduz o efeito de picos isolados, ruído óptico e pequenas diferenças entre relógios.</p>

          <h3>FC MÁXIMA</h3>
          <p>O motor prioriza uma FC máxima confiável cadastrada ou medida. Se ela não existir, pode usar uma FC máxima histórica validada; a estimativa por idade fica como fallback.</p>

          <h3>CALORIAS</h3>
          <p>Calorias não participam do IGA. Elas não somam pontos, não reduzem pontos e não alteram a posição no ranking. Podem continuar sendo usadas em saúde, relatórios e auditoria, mas não decidem quem fica acima de quem.</p>

          <h3>SESSÃO VÁLIDA</h3>
          <p>Musculação e força precisam ter pelo menos 30 minutos. Corrida e cardio precisam ter pelo menos 20 minutos. A atividade também precisa passar pelas validações de integridade aplicáveis; sessão reprovada não entra na pontuação.</p>

          <h3>ATUALIZAÇÃO</h3>
          <p>O ranking usa o cálculo oficial do servidor e é recalculado quando atividades válidas são processadas. Semana, mês e temporada usam a mesma base de IGA; períodos maiores são formados pela média das semanas correspondentes.</p>
        </section>
      </div>

      <nav className="profile-flow-footer">
        <button onClick={() => go('/')}><InvictusLogo size={23}/><span>Início</span></button>
        <button onClick={() => go('/championships')}><Trophy/><span>Campeonatos</span></button>
        <button className="is-plus" onClick={() => go('/musculacao')}><Plus/></button>
        <button onClick={() => go('/challenges')}><ShieldCheck/><span>Desafios</span></button>
        <button className="is-active" onClick={() => go('/profile')}><UserRound/><span>Perfil</span></button>
      </nav>
    </main>,
    document.body,
  );
}
