import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { ArrowLeft, Brain, Dumbbell, HeartPulse, Plus, Send, ShieldCheck, Sparkles, Target, Trophy, UserRound } from 'lucide-react';
import { InvictusLogo } from '../components/InvictusLogo';
import { useUser } from '../UserContext';
import { invictusAiService, type InvictusAiMessage } from '../services/invictusAiService';
import './InvictusAI.css';

const suggestions = [
  { icon: <Dumbbell />, label: 'Meu treino', prompt: 'Analise meu objetivo e me ajude a organizar meu próximo treino.' },
  { icon: <Target />, label: 'Minha evolução', prompt: 'Como posso melhorar minha consistência e acompanhar minha evolução no Invictus?' },
  { icon: <HeartPulse />, label: 'Recuperação', prompt: 'Explique como equilibrar treino e recuperação com segurança.' },
  { icon: <ShieldCheck />, label: 'Regras Invictus', prompt: 'Explique de forma simples como funcionam validação, desafios e pontuação.' },
];

const now = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function InvictusAI() {
  const navigate = useNavigate();
  const { user } = useUser();
  const endRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<InvictusAiMessage[]>([{
    id: 'welcome', sender: 'ai', timestamp: now(), confidence: 'SISTEMA INVICTUS',
    text: `Olá, ${(user?.displayName || user?.name || 'Atleta').split(' ')[0]}! Sou a Invictus IA. Posso explicar seus dados, ajudar a organizar treinos e orientar o uso do aplicativo sem inventar métricas ausentes.`,
  }]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const send = async (text: string) => {
    const clean = text.trim();
    if (!clean || loading) return;
    const userMessage: InvictusAiMessage = { id: `user-${Date.now()}`, sender: 'user', text: clean, timestamp: now() };
    const history = [...messages, userMessage];
    setMessages(history);
    setInput('');
    setLoading(true);
    try {
      const result = await invictusAiService.ask({
        queryText: clean,
        history,
        userProfile: { ...(user || {}), uid: user?.uid },
      });
      setMessages(current => [...current, {
        id: `ai-${Date.now()}`, sender: 'ai', text: result.answer, timestamp: now(),
        confidence: result.confidence, sources: result.sources,
      }]);
    } catch (error: unknown) {
      setMessages(current => [...current, {
        id: `error-${Date.now()}`, sender: 'ai', timestamp: now(), confidence: 'INDISPONÍVEL',
        text: error instanceof Error ? error.message : 'Não foi possível consultar a Invictus IA agora.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  const submit = (event: FormEvent) => { event.preventDefault(); void send(input); };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(input); }
  };

  return createPortal(<main className="iai-screen"><div className="iai-page">
    <header className="iai-header"><button onClick={() => navigate(-1)} aria-label="Voltar"><ArrowLeft /></button><div><InvictusLogo size={44} /><span><b>INVICTUS</b><small>PERFORMANCE</small></span></div><i><Brain /></i></header>
    <section className="iai-intro"><small><Sparkles /> INTELIGÊNCIA INVICTUS</small><h1>CONVERSE COM A <span>INVICTUS IA</span></h1><p>Orientação personalizada com base nos dados reais disponíveis na sua conta.</p></section>
    <section className="iai-suggestions" aria-label="Sugestões de conversa">{suggestions.map(item => <button key={item.label} onClick={() => void send(item.prompt)} disabled={loading}>{item.icon}<span>{item.label}</span></button>)}</section>
    <section className="iai-chat" aria-live="polite">{messages.map(message => <article key={message.id} className={`iai-message is-${message.sender}`}>
      {message.sender === 'ai' ? <span className="iai-message-icon"><InvictusLogo size={24} /></span> : null}
      <div><header><b>{message.sender === 'ai' ? 'INVICTUS IA' : 'VOCÊ'}</b><time>{message.timestamp}</time></header><ReactMarkdown>{message.text}</ReactMarkdown>{message.confidence ? <small>{message.confidence}</small> : null}</div>
    </article>)}{loading ? <div className="iai-thinking"><i /><i /><i /><span>Analisando com segurança…</span></div> : null}<div ref={endRef} /></section>
    <form className="iai-composer" onSubmit={submit}><textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={handleKeyDown} maxLength={4000} rows={1} placeholder="Pergunte sobre treino, evolução ou o aplicativo…" aria-label="Mensagem para a Invictus IA" /><button disabled={loading || !input.trim()} aria-label="Enviar mensagem"><Send /></button></form>
    <p className="iai-disclaimer">A Invictus IA não substitui orientação médica ou profissional presencial.</p>
  </div><nav className="iai-footer"><button onClick={() => navigate('/')}><InvictusLogo size={24} /><span>Início</span></button><button onClick={() => navigate('/championships')}><Trophy /><span>Campeonatos</span></button><button className="is-plus" onClick={() => navigate('/activity')} aria-label="Escolher modalidade"><Plus /></button><button onClick={() => navigate('/challenges')}><ShieldCheck /><span>Desafios</span></button><button onClick={() => navigate('/profile')}><UserRound /><span>Perfil</span></button></nav>
  </main>, document.body);
}

export default InvictusAI;
