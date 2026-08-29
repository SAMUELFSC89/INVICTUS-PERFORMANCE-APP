import React, { useState, useEffect } from 'react';
import {
  Check, Trophy, RefreshCw, Plus, CheckCircle, AlertCircle,
  Copy, ShieldAlert, Crown, Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { useUser } from '../UserContext';

// #325/#124 (pedido do usuario): Desafios Privados deixou de ser uma disputa
// com dinheiro real (taxa de entrada, pool, premio em R$) e virou um
// beneficio exclusivo do plano PRO -- sem nenhum valor monetario envolvido.
// So o TOP 1 leva reconhecimento (destaque/badge). Usuarios Free nao tem
// acesso ao recurso (nem visualizam desafios de terceiros), so a tela de
// upsell abaixo.
export function PrivateChallengesTab() {
  const { user: profile, refreshUser } = useUser();
  const navigate = useNavigate();
  const isPro = profile?.subscriptionTier === 'performance';

  const [activeSubTab, setActiveSubTab] = useState<'ativos' | 'criar' | 'entrar'>('ativos');

  // List states
  const [challenges, setChallenges] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states - Create
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [durationDays, setDurationDays] = useState<7 | 15 | 30>(7);
  const [isCreating, setIsCreating] = useState(false);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  // Form states - Join
  const [inviteCode, setInviteCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [joinSuccess, setJoinSuccess] = useState<string | null>(null);

  // Copied code feedback
  const [copiedCodeCode, setCopiedCodeCode] = useState<string | null>(null);

  const fetchChallenges = async () => {
    setLoading(true);
    setError(null);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Operação requer autenticação.');

      const response = await fetch('/api/private-challenges?action=list', {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Erro ao carregar desafios.');
      }
      setChallenges(data.challenges || []);
    } catch (err: any) {
      console.error('Fetch errors private-challenges:', err);
      setError(err.message || 'Falha ao buscar desafios privados.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isPro) fetchChallenges();
  }, [isPro]);

  const handleCreateChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setIsCreating(true);
    setError(null);
    setCreateSuccess(null);

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Não autenticado.');

      const response = await fetch('/api/private-challenges?action=create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ title, description, durationDays })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Não foi possível criar o desafio.');
      }

      setCreateSuccess(`Desafio "${title}" criado com sucesso! Código de convite: ${data.inviteCode}`);
      setTitle('');
      setDescription('');
      await refreshUser();
      await fetchChallenges();
      setActiveSubTab('ativos');
    } catch (err: any) {
      setError(err.message || 'Erro ao criar desafio privado.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;
    setIsJoining(true);
    setError(null);
    setJoinSuccess(null);

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Não autenticado.');

      const response = await fetch('/api/private-challenges?action=join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ inviteCode: inviteCode.trim() })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Não foi possível entrar no desafio.');
      }

      setJoinSuccess('Você entrou no desafio privado com sucesso! Comece a treinar para pontuar.');
      setInviteCode('');
      await refreshUser();
      await fetchChallenges();
      setActiveSubTab('ativos');
    } catch (err: any) {
      setError(err.message || 'Erro ao entrar no desafio privado.');
    } finally {
      setIsJoining(false);
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCodeCode(code);
    setTimeout(() => {
      setCopiedCodeCode(null);
    }, 2500);
  };

  // Free: recurso totalmente bloqueado -- nao mostra nem a lista de desafios
  // de terceiros. Mesmo padrao visual de gate ja usado em Performance.tsx.
  if (!isPro) {
    return (
      <div className="bg-surface-container-low border border-outline-variant/35 rounded-[32px] p-10 text-center max-w-lg mx-auto space-y-5">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/25 flex items-center justify-center text-primary mx-auto">
          <Lock size={28} />
        </div>
        <div className="space-y-2">
          <h3 className="font-headline italic font-black text-2xl uppercase tracking-tight text-on-surface">Benefício Exclusivo PRO</h3>
          <p className="text-on-surface-variant font-label text-[10px] uppercase tracking-wider leading-relaxed max-w-sm mx-auto">
            Desafios Privados são para assinantes do plano PRO: crie ou entre em disputas com seus parceiros de treino usando um código de convite, sem nenhum custo por desafio. Apenas reconhecimento para quem terminar em 1º lugar.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/profile')}
          className="bg-primary text-black font-label font-black text-[10px] uppercase tracking-wider px-6 py-3.5 rounded-xl shadow-lg hover:brightness-110 active:scale-95 transition-all inline-flex items-center gap-2"
        >
          <Crown size={14} />
          Assinar Invictus PRO
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Top action header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-surface-container-low p-6 rounded-[24px] border border-outline-variant/35 shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <Trophy size={24} />
          </div>
          <div>
            <span className="font-label text-[9px] font-black text-on-surface-variant uppercase tracking-[0.25em] flex items-center gap-1.5">
              <Crown size={11} className="text-primary" /> BENEFÍCIO PRO
            </span>
            <h4 className="font-headline italic font-black text-xl text-on-surface leading-tight">
              Desafios Privados
            </h4>
          </div>
        </div>

        <div className="flex bg-surface-container-high p-1 rounded-xl gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setActiveSubTab('ativos')}
            className={`px-4 py-2 text-[10px] font-black font-label rounded-lg transition-all uppercase tracking-wider ${activeSubTab === 'ativos' ? 'bg-primary text-black' : 'text-on-surface-variant hover:text-on-surface'}`}
          >
            DESAFIOS ATIVOS
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('criar')}
            className={`px-4 py-2 text-[10px] font-black font-label rounded-lg transition-all uppercase tracking-wider ${activeSubTab === 'criar' ? 'bg-primary text-black' : 'text-on-surface-variant hover:text-on-surface'}`}
          >
            CRIAR NOVO
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('entrar')}
            className={`px-4 py-2 text-[10px] font-black font-label rounded-lg transition-all uppercase tracking-wider ${activeSubTab === 'entrar' ? 'bg-primary text-black' : 'text-on-surface-variant hover:text-on-surface'}`}
          >
            USAR CÓDIGO
          </button>
        </div>
      </div>

      {/* Global alert or error message */}
      {error && (
        <div className="bg-error/15 border-2 border-error/20 p-4 rounded-2xl flex items-start gap-3">
          <AlertCircle size={18} className="text-error shrink-0 mt-0.5" />
          <p className="text-error text-xs font-bold uppercase leading-relaxed">{error}</p>
        </div>
      )}

      {createSuccess && (
        <div className="bg-primary/10 border-2 border-primary/25 p-4 rounded-2xl flex items-start gap-3">
          <CheckCircle size={18} className="text-primary shrink-0 mt-0.5" />
          <p className="text-primary text-xs font-bold uppercase leading-relaxed">{createSuccess}</p>
        </div>
      )}

      {joinSuccess && (
        <div className="bg-primary/10 border-2 border-primary/25 p-4 rounded-2xl flex items-start gap-3">
          <CheckCircle size={18} className="text-primary shrink-0 mt-0.5" />
          <p className="text-primary text-xs font-bold uppercase leading-relaxed">{joinSuccess}</p>
        </div>
      )}

      <AnimatePresence mode="wait">
        {/* TAB 1: ACTIVE CHALLENGES LIST */}
        {activeSubTab === 'ativos' && (
          <motion.div
            key="list"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="space-y-6"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-headline italic font-black text-xl uppercase text-on-surface tracking-wide flex items-center gap-2">
                <Trophy size={18} className="text-primary" />
                DESAFIOS DISPONÍVEIS
              </h3>
              <button
                type="button"
                onClick={fetchChallenges}
                className="w-10 h-10 rounded-xl bg-surface-container-high text-on-surface flex items-center justify-center border border-outline-variant/20 hover:text-primary transition-all"
                title="Recarregar"
              >
                <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              </button>
            </div>

            {loading && challenges.length === 0 ? (
              <div className="py-12 text-center text-on-surface-variant font-label text-[10px] uppercase tracking-widest font-black flex flex-col items-center gap-3">
                <RefreshCw size={24} className="animate-spin text-primary" />
                Carregando desafios privados...
              </div>
            ) : challenges.length === 0 ? (
              <div className="bg-surface-container-low p-10 rounded-[32px] text-center border border-outline-variant/35">
                <Trophy size={48} className="mx-auto mb-4 text-on-surface-variant opacity-25" />
                <h4 className="font-headline italic font-black text-lg text-on-surface uppercase mb-1">Nenhum Desafio Encontrado</h4>
                <p className="text-on-surface-variant font-label text-[9px] uppercase tracking-wider max-w-sm mx-auto mb-6 leading-relaxed">
                  Crie seu próprio desafio e convide amigos para disputar o topo do ranking!
                </p>
                <button
                  type="button"
                  onClick={() => setActiveSubTab('criar')}
                  className="bg-primary text-black font-label font-black text-[10px] uppercase tracking-wider px-6 py-3 rounded-xl shadow-lg hover:brightness-110 active:scale-95 transition-all"
                >
                  Criar Primeiro Desafio
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {challenges.map((challenge) => {
                  const neededToMin = 2 - challenge.participantsCount;
                  // Desafios criados antes da migracao pra modelo PRO sem
                  // dinheiro (ver #325) ainda podem existir no historico com
                  // entryFee/netPrizePool reais -- exibidos como registro
                  // fiel do que aconteceu, nunca inventado.
                  const isLegacyMoney = challenge.isLegacyMoneyChallenge && typeof challenge.entryFee === 'number' && challenge.entryFee > 0;

                  return (
                    <motion.div
                      key={challenge.id}
                      className="bg-surface-container-low border border-outline-variant/35 rounded-[32px] p-6 space-y-6 shadow-xl relative overflow-hidden"
                    >
                      {/* Background decorations */}
                      <div className="absolute top-0 right-0 p-12 opacity-[0.015] pointer-events-none text-primary scale-150 rotate-12">
                        <Trophy size={110} />
                      </div>

                      {/* Header header row */}
                      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            {challenge.status === 'forming' && (
                              <span className="bg-alert-orange/15 text-alert-orange border border-alert-orange/20 px-2.5 py-0.5 rounded-full font-label font-bold text-[8px] uppercase tracking-wider animate-pulse">
                                AGUARDANDO ADVERSÁRIOS
                              </span>
                            )}
                            {challenge.status === 'active' && (
                              <span className="bg-primary/20 text-primary border border-primary/30 px-2.5 py-0.5 rounded-full font-label font-bold text-[8px] uppercase tracking-wider">
                                DESAFIO ATIVO
                              </span>
                            )}
                            {challenge.status === 'completed' && (
                              <span className="bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2.5 py-0.5 rounded-full font-label font-bold text-[8px] uppercase tracking-wider">
                                FINALIZADO 🏆
                              </span>
                            )}
                            {challenge.status === 'cancelled' && (
                              <span className="bg-on-surface-variant/20 text-on-surface-variant border border-outline-variant/30 px-2.5 py-0.5 rounded-full font-label font-bold text-[8px] uppercase tracking-wider">
                                CANCELADO
                              </span>
                            )}

                            <span className="bg-surface-container-high text-on-surface-variant px-2.5 py-0.5 rounded-full font-label font-bold text-[8px] uppercase tracking-wider">
                              {challenge.durationDays} DIAS
                            </span>

                            {challenge.isMember && (
                              <span className="bg-primary text-black px-2 py-0.5 rounded-full font-label font-bold text-[8px] uppercase tracking-wider flex items-center gap-1">
                                <CheckCircle size={8} fill="currentColor" /> INSCRITO
                              </span>
                            )}
                          </div>

                          <h3 className="font-headline italic font-black text-2xl text-on-surface uppercase tracking-tight leading-none leading-tight pt-1">
                            {challenge.title}
                          </h3>

                          {challenge.description && (
                            <p className="text-on-surface-variant font-sans text-xs italic opacity-85 mt-1 border-l-2 border-primary/40 pl-2 leading-relaxed max-w-xl">
                              "{challenge.description}"
                            </p>
                          )}

                          <div className="flex items-center gap-1.5 text-on-surface-variant font-label text-[8px] uppercase tracking-widest leading-none pt-1">
                            <span>Criado por: <strong>{challenge.creatorName}</strong></span>
                          </div>
                        </div>

                        {/* Copy invite code container */}
                        {['forming', 'active'].includes(challenge.status) && (
                          <button
                            type="button"
                            onClick={() => handleCopyCode(challenge.inviteCode)}
                            className="bg-surface-container-high border border-outline-variant/30 px-3.5 py-2.5 rounded-2xl flex items-center justify-between gap-3 text-on-surface-variant hover:text-primary transition-all shrink-0 w-full sm:w-auto"
                          >
                            <div className="text-left font-mono">
                              <span className="block font-label text-[7px] uppercase tracking-[0.2em] opacity-40 leading-none mb-1">CÓDIGO DE CONVITE</span>
                              <span className="font-bold text-xs uppercase tracking-widest text-on-surface leading-none">{challenge.inviteCode}</span>
                            </div>
                            <div className="w-8 h-8 rounded-xl bg-surface-container-low flex items-center justify-center text-primary border border-outline-variant/20">
                              {copiedCodeCode === challenge.inviteCode ? <Check size={14} className="text-primary" /> : <Copy size={12} />}
                            </div>
                          </button>
                        )}
                      </div>

                      {/* Info grid row -- sem valores em dinheiro no modelo novo;
                          desafios legados (com dinheiro real) mostram os campos
                          originais como registro historico. */}
                      <div className={`grid grid-cols-2 ${isLegacyMoney ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-4 pt-1`}>
                        {isLegacyMoney ? (
                          <>
                            <div className="bg-surface-container-high/60 p-4 rounded-2xl border border-outline-variant/20">
                              <span className="block font-label text-[7px] uppercase tracking-[0.25em] text-on-surface-variant opacity-45 mb-1 leading-none">PRÊMIO (LEGADO)</span>
                              <span className="font-headline italic font-black text-lg text-primary">R$ {(challenge.netPrizePool || 0).toFixed(2)}</span>
                            </div>
                            <div className="bg-surface-container-high/60 p-4 rounded-2xl border border-outline-variant/20">
                              <span className="block font-label text-[7px] uppercase tracking-[0.25em] text-on-surface-variant opacity-45 mb-1 leading-none">TAXA (LEGADO)</span>
                              <span className="font-headline italic font-black text-lg text-on-surface">R$ {(challenge.entryFee || 0).toFixed(2)}</span>
                            </div>
                          </>
                        ) : (
                          <div className="bg-surface-container-high/60 p-4 rounded-2xl border border-outline-variant/20">
                            <span className="block font-label text-[7px] uppercase tracking-[0.25em] text-on-surface-variant opacity-45 mb-1 leading-none">PRÊMIO</span>
                            <span className="font-headline italic font-black text-sm text-primary flex items-center gap-1"><Trophy size={13} /> TOP 1 leva o troféu</span>
                          </div>
                        )}

                        <div className="bg-surface-container-high/60 p-4 rounded-2xl border border-outline-variant/20">
                          <span className="block font-label text-[7px] uppercase tracking-[0.25em] text-on-surface-variant opacity-45 mb-1 leading-none">PARTICIPANTES CONFIRMADOS</span>
                          <span className="font-headline italic font-black text-lg text-on-surface uppercase">{challenge.participantsCount} ATLETAS</span>
                        </div>

                        <div className="bg-surface-container-high/60 p-4 rounded-2xl border border-outline-variant/20">
                          <span className="block font-label text-[7px] uppercase tracking-[0.25em] text-on-surface-variant opacity-45 mb-1 leading-none">ENCERRA EM</span>
                          <span className="font-headline italic font-black text-md text-on-surface truncate leading-none pt-0.5 uppercase block">
                             {new Date(challenge.endDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                          </span>
                        </div>
                      </div>

                      {/* Status rules specific logic */}
                      {challenge.status === 'forming' && (
                        <div className="bg-alert-orange/10 border border-alert-orange/20 p-4 rounded-2xl flex items-start gap-3">
                          <ShieldAlert size={16} className="text-alert-orange shrink-0 mt-0.5" />
                          <p className="text-alert-orange font-bold text-[9px] uppercase tracking-wider leading-relaxed">
                            {neededToMin > 0
                              ? `Falta ${neededToMin} participante para ativar este desafio privado.`
                              : `Desafio ativo! A disputa começará oficialmente em breve.`}
                          </p>
                        </div>
                      )}

                      {challenge.status === 'completed' && challenge.winnerId && (
                        <div className="bg-purple-500/10 border border-purple-500/25 p-4 rounded-2xl flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            {challenge.winnerPhoto ? (
                              <img src={challenge.winnerPhoto} alt={challenge.winnerName} className="w-10 h-10 rounded-xl object-cover border border-purple-500/30" />
                            ) : (
                              <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center border border-purple-500/30">
                                <Trophy size={16} />
                              </div>
                            )}
                            <div>
                              <span className="block font-label text-[7px] uppercase tracking-widest text-on-surface-variant opacity-50 mb-0.5">Vencedor Absoluto</span>
                              <span className="font-headline italic font-black text-md text-purple-400 uppercase">{challenge.winnerName}</span>
                            </div>
                          </div>
                          {isLegacyMoney && (
                            <div className="text-right">
                              <span className="block font-label text-[7px] uppercase tracking-widest text-on-surface-variant opacity-50 mb-0.5">Prêmio (legado)</span>
                              <span className="font-headline italic font-black text-lg text-primary">R$ {(challenge.netPrizePool || 0).toFixed(2)}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Challenge member list leaderboard */}
                      <div className="space-y-3">
                        <span className="block font-label text-[8px] uppercase tracking-widest text-on-surface-variant opacity-45 font-black">
                          CLASSICAÇÃO / RANKING DO DESAFIO
                        </span>

                        <div className="space-y-2 bg-surface-container-high/30 p-2.5 rounded-2xl border border-outline-variant/15">
                          {challenge.members?.length === 0 ? (
                            <span className="text-[8px] font-bold text-on-surface-variant uppercase p-2 block text-center">Nenhum membro inscrito</span>
                          ) : (
                            challenge.members.map((member: any, index: number) => {
                              const isMe = member.userId === auth.currentUser?.uid;
                              return (
                                <div
                                  key={member.userId}
                                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl border transition-all ${
                                    isMe
                                      ? 'bg-primary/10 border-primary/35'
                                      : 'bg-surface-container-low border-outline-variant/15'
                                  }`}
                                >
                                  <div className="flex items-center gap-3">
                                    <span className={`font-headline italic font-black text-xs min-w-[20px] text-center ${
                                      index === 0 ? 'text-primary' : index === 1 ? 'text-alert-orange' : 'text-on-surface-variant'
                                    }`}>
                                      {index + 1}º
                                    </span>
                                    {member.userPhoto ? (
                                      <img src={member.userPhoto} alt={member.userName} className="w-6 h-6 rounded-md object-cover" />
                                    ) : (
                                      <div className="w-6 h-6 rounded-md bg-white/5 flex items-center justify-center font-label text-[8px]">
                                        {member.userName?.charAt(0).toUpperCase()}
                                      </div>
                                    )}
                                    <span className={`font-headline text-xs uppercase ${isMe ? 'text-primary font-black' : 'text-on-surface'}`}>
                                      {member.userName} {isMe && '(Você)'}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-4 text-right">
                                    <div className="font-mono">
                                      <span className="block font-label text-[6px] text-on-surface-variant opacity-40 uppercase leading-none mb-[2px]">ATIVIDADES</span>
                                      <span className="font-bold text-[9px] text-on-surface">{member.workoutsCount || 0}</span>
                                    </div>
                                    <div className="font-mono">
                                      <span className="block font-label text-[6px] text-on-surface-variant opacity-40 uppercase leading-none mb-[2px]">PONTUAÇÃO</span>
                                      <span className="font-black text-[11px] text-primary">{member.points || 0} PTS</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

        {/* TAB 2: CREATE CHALLENGE */}
        {activeSubTab === 'criar' && (
          <motion.div
            key="create"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="bg-surface-container-low border border-outline-variant/35 rounded-[32px] p-6 md:p-8 shadow-xl max-w-xl mx-auto space-y-6"
          >
            <div>
              <h3 className="font-headline italic font-black text-2xl uppercase tracking-tight text-on-surface">CRIAR DESAFIO PRIVADO</h3>
              <p className="text-on-surface-variant font-label text-[9px] uppercase tracking-wider leading-relaxed">
                Desafie seus parceiros de treino e dispute o topo do ranking com base no rendimento físico real verificado — sem nenhum custo.
              </p>
            </div>

            <form onSubmit={handleCreateChallenge} className="space-y-6">
              <div className="space-y-2">
                <label className="block font-label font-black text-[9px] text-on-surface-variant uppercase tracking-widest leading-none">
                  TÍTULO DO DESAFIO
                </label>
                <input
                  type="text"
                  required
                  placeholder="EX: DESAFIO DE RESISTÊNCIA DOS PARCEIROS"
                  value={title}
                  onChange={(e) => setTitle(e.target.value.toUpperCase())}
                  className="w-full bg-surface-container-high border-2 border-outline-variant/30 text-on-surface rounded-2xl px-4 py-3.5 text-xs uppercase tracking-widest font-label focus:border-primary transition-all focus:outline-none"
                />
              </div>

              <div className="space-y-2">
                <label className="block font-label font-black text-[9px] text-on-surface-variant uppercase tracking-widest leading-none">
                  DESCRIÇÃO DO DESAFIO (OPCIONAL)
                </label>
                <textarea
                  rows={2}
                  placeholder="EX: QUEM SOMAR MAIS PONTOS DE CARDIO EM 15 DIAS LEVA O RECONHECIMENTO."
                  value={description}
                  onChange={(e) => setDescription(e.target.value.toUpperCase())}
                  className="w-full bg-surface-container-high border-2 border-outline-variant/30 text-on-surface rounded-2xl px-4 py-3.5 text-xs uppercase tracking-widest font-label focus:border-primary transition-all focus:outline-none resize-none"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2 col-span-3">
                  <label className="block font-label font-black text-[9px] text-on-surface-variant uppercase tracking-widest leading-none">
                    DURAÇÃO DO DESAFIO
                  </label>
                </div>
                {([7, 15, 30] as const).map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setDurationDays(days)}
                    className={`py-3.5 rounded-2xl font-headline italic font-black text-sm uppercase tracking-wider border-2 transition-all ${
                      durationDays === days
                        ? 'bg-primary/10 border-primary text-primary'
                        : 'bg-surface-container-high border-outline-variant/20 text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {days} DIAS
                  </button>
                ))}
              </div>

              {/* Resumo limpo, sem taxa nem formulas internas -- o desafio e
                  100% gratis, so exige plano PRO pra criar/entrar. */}
              <div className="bg-surface-container-high p-5 rounded-2xl border border-outline-variant/15 space-y-3 font-label text-[10px] text-on-surface-variant">
                <div className="flex justify-between items-center pb-1 border-b border-outline-variant/10 font-bold">
                  <span className="uppercase text-on-surface font-black">RESUMO DO DESAFIO</span>
                  <span className="text-primary uppercase tracking-widest font-black flex items-center gap-1"><Crown size={11} /> PRO</span>
                </div>

                <div className="flex justify-between">
                  <span className="uppercase tracking-wider">CUSTO:</span>
                  <span className="font-bold text-primary">Gratuito (benefício PRO)</span>
                </div>

                <div className="flex justify-between">
                  <span className="uppercase tracking-wider">DIAS DE DURAÇÃO:</span>
                  <span className="font-bold text-on-surface">{durationDays} dias</span>
                </div>

                <div className="flex justify-between">
                  <span className="uppercase tracking-wider font-bold">GANHADOR:</span>
                  <span className="font-black text-primary">TOP 1 leva o reconhecimento de campeão</span>
                </div>

                <p className="opacity-55 leading-relaxed text-[8px] uppercase tracking-wide border-t border-outline-variant/10 pt-2">
                  *Para que o desafio seja ativado, é necessário um mínimo de 2 participantes confirmados (inclusive você). Caso o prazo final expire sem atingir o mínimo, o desafio é cancelado — sem qualquer custo envolvido.
                </p>
              </div>

              <button
                type="submit"
                disabled={isCreating}
                className="w-full bg-primary text-black hover:brightness-110 active:scale-98 text-xs font-black font-label py-4 rounded-2xl uppercase tracking-widst shadow-xl shadow-primary/20 transition-all flex items-center justify-center gap-2"
              >
                {isCreating ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
                CRIAR DESAFIO
              </button>
            </form>
          </motion.div>
        )}

        {/* TAB 3: JOIN CHALLENGE */}
        {activeSubTab === 'entrar' && (
          <motion.div
            key="join"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="bg-surface-container-low border border-outline-variant/35 rounded-[32px] p-6 md:p-8 shadow-xl max-w-sm mx-auto space-y-6"
          >
            <div>
              <h3 className="font-headline italic font-black text-2xl uppercase tracking-tight text-on-surface">ENTRAR EM DESAFIO</h3>
              <p className="text-on-surface-variant font-label text-[9px] uppercase tracking-wider leading-relaxed">
                Digite o código de 6 caracteres compartilhado pelo criador do desafio privado para ingressar no ranking de disputa.
              </p>
            </div>

            <form onSubmit={handleJoinChallenge} className="space-y-6">
              <div className="space-y-2 text-center">
                <input
                  type="text"
                  required
                  maxLength={6}
                  placeholder="EX: X9W2ZK"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  className="w-full bg-surface-container-high border-2 border-outline-variant/30 text-on-surface text-center font-headline italic font-black text-3xl uppercase tracking-[0.3em] rounded-2xl py-4 focus:border-primary transition-all focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={isJoining}
                className="w-full bg-primary text-black hover:brightness-110 active:scale-98 text-xs font-black font-label py-4 rounded-2xl uppercase tracking-widst shadow-xl shadow-primary/20 transition-all flex items-center justify-center gap-2"
              >
                {isJoining ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                VALIDAR CÓDIGO E INGRESSAR
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
