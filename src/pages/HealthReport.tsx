import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BrainCircuit, Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { HealthFooter, HealthReportContent } from './Health';
import { healthSummaryService, HealthSummaryResponse } from '../services/healthSummaryService';
import { API_CONFIG } from '../config';

const concepts = [
  ['HRV', 'É a variação do tempo entre batimentos. Ajuda a observar recuperação e estresse quando comparada à sua própria média.'],
  ['FC em repouso', 'É a frequência cardíaca quando o corpo está descansando. A tendência ao longo dos dias é mais útil que uma leitura isolada.'],
  ['VO₂ máx.', 'É uma estimativa da capacidade de usar oxigênio durante esforço e ajuda a acompanhar o condicionamento aeróbico.'],
  ['Oxigenação', 'Estima o percentual de oxigênio no sangue. Relógios não substituem um oxímetro ou avaliação médica.'],
  ['Cobertura', 'É a quantidade de dias e leituras disponíveis. Pouca cobertura reduz a confiança de qualquer tendência.'],
  ['Gasto energético estimado', 'É uma estimativa de energia além do gasto básico. Não representa um valor exato e pode variar entre dispositivos e contextos.']
];

// #291: a análise por IA do relatório NÃO dispara mais sozinha ao montar a
// tela (isso violava a regra "abrir uma tela de Saúde não chama Gemini" --
// o relatório é alcançado por um clique em "GERAR RELATÓRIO"/"VER ANÁLISE
// COMPLETA", mas a chamada à IA em si precisa ser uma ação própria e
// explícita). Agora só chama /api/performance-ai depois que o usuário toca
// em "ANALISAR COM IA".
function AiHealthNarrative() {
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);

  const solicitarAnalise = async () => {
    setRequested(true);
    setLoading(true);
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      const response = await fetch(`${API_CONFIG.baseUrl}/api/performance-ai`, {
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
      setAnswer(response.ok ? String(payload.answer || '') : 'A análise da IA está temporariamente indisponível. As métricas medidas continuam válidas abaixo.');
    } catch {
      setAnswer('A análise da IA está temporariamente indisponível. As métricas medidas continuam válidas abaixo.');
    } finally {
      setLoading(false);
    }
  };

  return <section className="health-ai-report" aria-live="polite">
    <div className="health-section-name"><BrainCircuit /> ANÁLISE DA INVICTUS IA</div>
    {!requested && <><p>Gere uma leitura em linguagem simples dos seus dados medidos neste período.</p><button type="button" className="health-inline-link" onClick={solicitarAnalise}>ANALISAR COM IA</button></>}
    {requested && loading && <p>Analisando cobertura, leituras e tendências reais…</p>}
    {requested && !loading && <div className="health-ai-report-text">{answer}</div>}
    <small>Conteúdo educativo. Não é diagnóstico, prescrição nem substituto de atendimento profissional.</small>
  </section>;
}

function HealthDataQuality() {
  const [summary, setSummary] = useState<HealthSummaryResponse | null>(null);
  useEffect(() => { let active = true; void healthSummaryService.fetchSummary(30).then((value) => { if (active) setSummary(value); }); return () => { active = false; }; }, []);
  const rows = Object.entries(summary?.latest || {}).filter((entry) => entry[1]);
  if (!rows.length) return null;
  return <section className="health-report-quality"><div className="health-section-name">SOBRE A QUALIDADE DOS DADOS <Info /></div><div className="health-quality-table"><div className="is-head"><span>Métrica</span><span>Dispositivo / integração</span><span>Confiança</span><span>Período</span></div>{rows.map(([metric, sample]) => {
    if (!sample) return null;
    const confidence = sample.confidenceAtMeasurement || sample.currentEvidenceConfidence;
    return <div key={metric}><span>{metric.replaceAll('_', ' ')}</span><span>{sample.device || 'Não identificado'} · {sample.provenance?.integration || sample.source || 'Origem desconhecida'}</span><span className={`health-confidence-badge level-${confidence?.confidenceLevel || 'E'}`}>{confidence?.confidenceLevel || 'E'} · {confidence?.confidenceScore ?? '—'}/100</span><span>{new Date(sample.timestamp).toLocaleString('pt-BR')}</span></div>;
  })}</div><p>Classificação preservada no momento da medição. Mudanças futuras na evidência não apagam o histórico.</p><small>Confiança da medição não é diagnóstico, precisão clínica nem avaliação do seu estado de saúde.</small></section>;
}

export function HealthReport() {
  const navigate = useNavigate();
  return createPortal(
    <div className="health-report-shell health-new-shell">
      <HealthReportContent />
      <HealthDataQuality />
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
