import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { Sparkles, X, Send, ShieldCheck, Cpu, RefreshCw } from 'lucide-react';
import { UserPerformanceState } from '../../core/performance/performanceEngine';
import { auth } from '../../firebase';
import { API_CONFIG } from '../../config';

interface PerformanceAIModalProps {
  isOpen: boolean;
  onClose: () => void;
  perfState: UserPerformanceState;
}

interface Message {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  confidence?: string;
  sources?: string[];
  timestamp: string;
}

export function PerformanceAIModal({ isOpen, onClose, perfState }: PerformanceAIModalProps) {
  const [inputQuery, setInputQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'init_msg',
      sender: 'ai',
      text: `Olá, ${perfState.userName}! Sou a Invictus Performance IA, sua especialista em ciência do exercício, saúde, fisiologia e análise de dados.

Posso ajudar a interpretar os registros validados disponíveis e explicar o funcionamento do Invictus. Dados ausentes não serão estimados.

Como posso ajudar na sua jornada hoje?`,
      confidence: perfState.overallReliability.toUpperCase(),
      sources: ['Registros validados do Invictus'],
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    }
  ]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSend = async (queryText?: string) => {
    const textToSend = queryText || inputQuery;
    if (!textToSend.trim()) return;

    const userMsg: Message = {
      id: `usr_${Date.now()}`,
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    if (!queryText) setInputQuery('');
    setLoading(true);
    let failureMessage = '';

    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error('Sessão não autenticada.');
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`${API_CONFIG.baseUrl}/api/performance-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          queryText: textToSend,
          history: messages.slice(-6),
          perfState
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.answer) {
          const aiMsg: Message = {
            id: `ai_${Date.now()}`,
            sender: 'ai',
            text: data.answer,
            confidence: data.confidence || perfState.overallReliability.toUpperCase(),
            sources: data.sources || ['Coleção Workouts (Firestore)', 'Algoritmo IGA Engine', 'Biometria'],
            timestamp: data.timestamp || new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          };
          setMessages(prev => [...prev, aiMsg]);
          setLoading(false);
          return;
        }
      }
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || 'A IA não retornou uma resposta válida.');
    } catch (e) {
      console.warn('[Performance AI Client] Servidor indisponível:', e);
      failureMessage = e instanceof Error ? e.message : '';
    }

    // Nunca substitua a IA autenticada por aconselhamento clínico/fitness
    // fabricado no dispositivo.
    setMessages(prev => [...prev, {
      id: `ai_${Date.now()}`,
      sender: 'ai',
      text: failureMessage || 'Não foi possível consultar a IA agora. Nenhuma métrica ou recomendação foi estimada localmente. Tente novamente quando a conexão estiver disponível.',
      confidence: 'INDISPONÍVEL',
      sources: ['Servidor Invictus IA indisponível'],
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    }]);
    setLoading(false);

    /* Código de fallback local removido funcionalmente: recomendações só são
       emitidas pelo serviço autenticado. Mantido temporariamente como histórico
       até a limpeza mecânica do arquivo nesta revisão. */
    /* setTimeout(() => {
      const qLower = textToSend.toLowerCase();
      let aiResponseText = '';

      if (qLower.includes('iga') || qLower.includes('pontuação') || qLower.includes('ranking') || qLower.includes('perdi pontos')) {
        const weeklyScore = perfState.computedMetrics['iga_weekly_score']?.currentValue || 0;
        aiResponseText = `O seu IGA (Índice de Aderência Geral) atual no ranking é de **${weeklyScore} pontos**.

O IGA do Invictus não é um simples contador de passos. Ele utiliza uma equação que cruza:
1. **Frequência Semanal Auditada**: número de sessões validadas sem duplicidade.
2. **Volume de Tempo (Duração)**: minutos efetivos de treino na janela ativa (${perfState.computedMetrics['total_volume_time']?.currentValue || 0} min acumulados).
3. **Intensidade Biométrica**: equivalência metabólica (METs) multiplicada pela Frequência Cardíaca média e pico.
4. **Portão de Calorias & Antifraude**: travamento de sessões com gasto calórico biologicamente impossível.

*Se você notou queda na pontuação:* O ranking semanal é resetado no início da temporada ou ajustado caso sessões não passem na validação geográfica de geofencing ou na leitura do relógio.`;
      } else if (qLower.includes('valida') || qLower.includes('antifraude') || qLower.includes('gps') || qLower.includes('strava') || qLower.includes('health')) {
        aiResponseText = `A validação de treinos no Invictus opera com um sistema anti-fraude de 3 camadas:
- **Biometria em Tempo Real**: Leitura contínua da Frequência Cardíaca (BPM) via Apple Health, Health Connect ou relógio. Treinos sem elevação de batimentos são desqualificados.
- **Geofencing & Presença**: Confirmação da localização física em academias e parceiros credenciados.
- **Análise Telemétrica de GPS/Strava**: Checagem de velocidade média e aceleração para barrar atividades simuladas em veículos.

Se um treino não for validado, verifique se a sincronização de permissões de saúde no seu celular está ativa antes de iniciar a atividade.`;
      } else if (qLower.includes('cardio') || qLower.includes('frequência') || qLower.includes('batimento') || qLower.includes('vo2') || qLower.includes('hrv') || qLower.includes('zona')) {
        const avgHR = perfState.computedMetrics['avg_heart_rate']?.currentValue || 'N/A';
        const maxHR = perfState.computedMetrics['max_heart_rate_session']?.currentValue || 'N/A';
        aiResponseText = `Análise Cardiovascular Científica:
- **FC Média Registrada**: ${avgHR} bpm
- **FC Máxima Efetiva**: ${maxHR} bpm
- **Confiabilidade Biométrica**: ${perfState.overallReliability.toUpperCase()}

Seu perfil indica predominância na **Zona 3 (Aeróbica Moderada)**, excelente para aprimoramento da eficiência mitocôndrial e oxidação de gorduras. Para otimizar seu VO₂ Máx, a literatura científica recomenda intercalar 1 a 2 sessões semanais em Zona 4/5 (Treinamento Intervalado de Alta Intensidade - HIIT).`;
      } else if (qLower.includes('prontidão') || qLower.includes('recuperação') || qLower.includes('hoje') || qLower.includes('treinar')) {
        if (perfState.readinessScore >= 80) {
          aiResponseText = `Seu índice de Prontidão Biométrica é **${perfState.readinessScore}/100 (${perfState.readinessStatus})**.

Seus marcadores de carga acumulada e descanso indicam que você está no momento ideal da **supercompensação fisiológica**.
**Recomendação Técnica**: Hoje é o dia ideal para aplicar uma carga elevada (treino de hipertrofia com carga pesada ou sessão intensa de corrida/HIIT). Suas reservas glicogênicas e sistema nervoso estão regenerados.`;
        } else {
          aiResponseText = `Seu índice de Prontidão Biométrica é **${perfState.readinessScore}/100 (${perfState.readinessStatus})**.

Sua carga fisiológica acumulada sugere fadiga do Sistema Nervoso Central ou muscular.
**Recomendação Técnica**: Realize um treino regenerativo (caminhada leve, mobilidade ou musculação com volume reduzido). Isso evitará picos de cortisol e promoverá a supercompensação.`;
        }
      } else if (qLower.includes('evoluí') || qLower.includes('evoluçao') || qLower.includes('melhorei') || qLower.includes('histórico')) {
        const totalMin = perfState.computedMetrics['total_volume_time']?.currentValue || 0;
        const totalTreinos = perfState.computedMetrics['workout_count']?.currentValue || 0;
        aiResponseText = `Análise de Evolução Histórica:
- **Treinos Auditados Concluídos**: ${totalTreinos} sessões (${perfState.allWorkouts.length} acumuladas em todo o histórico).
- **Volume Efetivo de Treino**: ${totalMin} minutos.
- **Projeção Mensal**: ${perfState.computedMetrics['projected_monthly_workouts']?.currentValue || 0} treinos.
- **Pontuação IGA**: ${perfState.computedMetrics['iga_weekly_score']?.currentValue || 0} pts.

Sua curva de consistência demonstra um padrão positivo. A manutenção dessa frequência de treinos é o principal fator adaptativo para o ganho de massa muscular, densidade óssea e saúde cardiovascular sustentável.`;
      } else {
        aiResponseText = `Analisando seu contexto com base na Ciência do Exercício:
- **Histórico**: ${perfState.allWorkouts.length} sessões registradas no ecossistema Invictus.
- **Status Biométrico Atual**: Recuperação estimada em ${perfState.readinessScore}/100 (${perfState.readinessStatus}).
- **Pontuação Semanal IGA**: ${perfState.computedMetrics['iga_weekly_score']?.currentValue || 0} pts.

Para aprofundar qualquer aspecto específico, você pode me perguntar sobre:
1. Métricas de Frequência Cardíaca, VO₂ Max ou Zonas Aeróbias.
2. Como funciona o IGA, Ranking e Antifraude do Invictus.
3. Recomendações de treino, recuperação ou nutrição baseadas na ciência.`;
      }

      const aiMsg: Message = {
        id: `ai_${Date.now()}`,
        sender: 'ai',
        text: aiResponseText,
        confidence: perfState.overallReliability.toUpperCase(),
        sources: ['Banco Invictus Workouts', 'Motor IGA Engine', 'Fisiologia do Exercício'],
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      };

      setMessages(prev => [...prev, aiMsg]);
      setLoading(false);
    }, 600); */
  };

  const quickPrompts = [
    'Como meu IGA e pontuação do ranking são calculados?',
    'O que diz a ciência sobre minha frequência cardíaca e zonas?',
    'Qual a minha prontidão e recuperação para treinar hoje?',
    'Por que um treino pode não ser validado pelo Invictus?',
    'Como está minha evolução histórica e projeção de treinos?'
  ];

  return (
    <AnimatePresence>
      <div
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto cursor-pointer select-none"
      >
        <motion.div
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.5 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 100 || info.velocity.y > 300) {
              onClose();
            }
          }}
          className="relative w-full max-w-2xl bg-zinc-950 border border-emerald-500/40 rounded-3xl p-6 md:p-8 shadow-2xl text-white space-y-6 my-8 max-h-[85vh] flex flex-col cursor-default select-auto"
        >
          {/* Top Drag & Pull Handle */}
          <div
            onClick={onClose}
            className="w-full -mt-3 -mb-2 flex flex-col items-center justify-center cursor-pointer group shrink-0 py-1"
            title="Pressione Esc, puxe para baixo ou clique para fechar"
          >
            <div className="w-12 h-1.5 bg-zinc-700 group-hover:bg-emerald-400 group-active:scale-95 transition-all rounded-full" />
            <span className="text-[9px] text-zinc-500 group-hover:text-emerald-400 font-medium tracking-wide mt-1 transition-colors">
              Pressione Esc, puxe ou toque para fechar
            </span>
          </div>

          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 pb-4 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <Sparkles size={22} />
              </div>
              <div>
                <h3 className="font-headline italic font-black text-xl uppercase tracking-tight text-white flex items-center gap-2">
                  <span>Invictus Performance AI</span>
                  <span className="text-[10px] bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold px-2 py-0.5 rounded-full not-italic">
                    IA Científica
                  </span>
                </h3>
                <p className="text-xs text-zinc-400">
                  Especialista em Fisiologia, Ciência do Esporte e Sistema Invictus
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Fechar conversa"
              className="h-9 px-3 rounded-full bg-zinc-900 hover:bg-rose-500/20 border border-zinc-800 hover:border-rose-500/40 text-zinc-400 hover:text-rose-300 flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-sm active:scale-95"
              title="Fechar conversa (Esc ou puxar)"
            >
              <X size={18} />
              <span className="text-xs font-bold hidden xs:inline">Fechar</span>
            </button>
          </div>

          {/* Chat Messages Log */}
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] p-4 rounded-2xl text-xs leading-relaxed ${
                    m.sender === 'user'
                      ? 'bg-emerald-500 text-black font-medium rounded-tr-none'
                      : 'bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-tl-none space-y-2'
                  }`}
                >
                  {m.sender === 'user' ? (
                    <p className="whitespace-pre-line">{m.text}</p>
                  ) : (
                    <div className="markdown-body space-y-2 text-xs leading-relaxed text-zinc-200 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_h1]:text-sm [&_h1]:font-bold [&_h2]:text-xs [&_h2]:font-bold [&_h3]:text-xs [&_h3]:font-bold [&_h3]:text-emerald-400 [&_strong]:font-semibold [&_strong]:text-emerald-300 [&_code]:bg-zinc-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded">
                      <Markdown>{m.text}</Markdown>
                    </div>
                  )}

                  {m.sender === 'ai' && m.sources && (
                    <div className="pt-2 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-[10px] text-zinc-400">
                      <div className="flex items-center gap-1 text-emerald-400 font-bold">
                        <ShieldCheck size={12} />
                        <span>Confiabilidade: {m.confidence}</span>
                      </div>
                      <div className="flex items-center gap-1 text-zinc-500">
                        <Cpu size={12} />
                        <span>{m.sources.join(' • ')}</span>
                      </div>
                    </div>
                  )}
                </div>
                <span className="text-[9px] text-zinc-600 mt-1 font-mono">{m.timestamp}</span>
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono animate-pulse">
                <RefreshCw size={14} className="animate-spin" />
                <span>Analisando fisiologia, biometria e regras do ecossistema Invictus...</span>
              </div>
            )}
          </div>

          {/* Quick Prompts */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 shrink-0">
            {quickPrompts.map((prompt, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(prompt)}
                className="text-[10px] font-bold bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-emerald-500/40 text-zinc-300 hover:text-white px-3 py-1.5 rounded-xl whitespace-nowrap transition-all cursor-pointer"
              >
                {prompt}
              </button>
            ))}
          </div>

          {/* Input Bar */}
          <div className="flex items-center gap-2 pt-2 border-t border-zinc-900 shrink-0">
            <input
              type="text"
              placeholder="Pergunte sobre seu desempenho, IGA, biometria ou fisiologia..."
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50"
            />
            <button
              onClick={() => handleSend()}
              disabled={loading || !inputQuery.trim()}
              className="w-11 h-11 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black flex items-center justify-center cursor-pointer transition-colors disabled:opacity-50"
            >
              <Send size={18} />
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
