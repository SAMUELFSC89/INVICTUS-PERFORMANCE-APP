import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BrainCircuit, Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { HealthFooter, HealthReportContent } from './Health';

const concepts = [
  ['HRV', 'É a variação do tempo entre batimentos. Ajuda a observar recuperação e estresse quando comparada à sua própria média.'],
  ['FC em repouso', 'É a frequência cardíaca quando o corpo está descansando. A tendência ao longo dos dias é mais útil que uma leitura isolada.'],
  ['VO₂ máx.', 'É uma estimativa da capacidade de usar oxigênio durante esforço e ajuda a acompanhar o condicionamento aeróbico.'],
  ['Oxigenação', 'Estima o percentual de oxigênio no sangue. Relógios não substituem um oxímetro ou avaliação médica.'],
  ['Cobertura', 'É a quantidade de dias e leituras disponíveis. Pouca cobertura reduz a confiança de qualquer tendência.'],
  ['Calorias ativas', 'É a energia estimada além do gasto básico do corpo durante movimentos e exercícios.']
];

function AiHealthNarrative() {
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const token = await user.getIdToken();
        const response = await fetch('/api/performance-ai', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'health-report',
            queryText: 'Gere meu relatório de saúde em linguagem simples. Resuma os dados disponíveis, explique cada termo técnico usado, indique tendências e próximos passos prudentes. Não diagnostique e deixe claro quando faltarem dados.',
            screenName: 'Relatório de Saúde',
            currentPath: '/health/report',
            includeAudio: false
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (active) setAnswer(response.ok ? String(payload.answer || '') : 'A análise da IA está temporariamente indisponível. As métricas medidas continuam válidas abaixo.');
      } catch {
        if (active) setAnswer('A análise da IA está temporariamente indisponível. As métricas medidas continuam válidas abaixo.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  return <section className="health-ai-report" aria-live="polite"><div className="health-section-name"><BrainCircuit /> ANÁLISE DA INVICTUS IA</div>{loading ? <p>Analisando cobertura, leituras e tendências reais…</p> : <div className="health-ai-report-text">{answer}</div>}<small>Conteúdo educativo. Não é diagnóstico, prescrição nem substituto de atendimento profissional.</small></section>;
}

export function HealthReport() {
  const navigate = useNavigate();
  return createPortal(
    <div className="health-report-shell health-new-shell">
      <HealthReportContent />
      <AiHealthNarrative />
      <section className="health-glossary health-report-glossary">
        <div className="health-section-name">ENTENDA OS TERMOS <Info /></div>
        <div>{concepts.map(([term, text]) => <article key={term}><strong>{term}</strong><p>{text}</p></article>)}</div>
      </section>
      <HealthFooter navigate={navigate} />
    </div>,
    document.body
  );
}
