import { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Check,
  X,
  AlertTriangle,
  ArrowLeft,
  RefreshCw,
  Clock,
  Search,
  Flag,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { cn } from '../lib/utils';
import { VALIDATION_MESSAGES } from '../services/validationMessages';

// #249: o backend ja tinha uma fila de revisao manual pronta e segura
// (api/_handlers/admin.ts, actions 'list-flagged-activities' e
// 'review-activity' -- ver comentarios #325 em activity-commit-service.ts e
// validate-activity-service.ts), mas NENHUMA tela consumia esses endpoints.
// Toda atividade marcada pendingReview:true (geofence de academia,
// SecurityPipeline UNDER_REVIEW, presenca sem confirmacao) ficava pendente
// para sempre, porque nao havia como um admin encontrar e decidir o status.
// Esta tela e o elo que faltava -- nao muda nenhuma regra de antifraude,
// so expoe a decisao que o pipeline ja pedia para um humano tomar.

interface FlaggedActivity {
  id: string;
  userId: string;
  type?: string;
  muscleGroup?: string;
  cardioType?: string;
  cardioTypeLabel?: string;
  duration?: number;
  distance?: number;
  calories?: number;
  avgHeartRate?: number;
  nonScoringReason?: string;
  rejectionReason?: string;
  userMessage?: string;
  createdAt?: string;
  status?: string;
  evidence?: Record<string, any>;
}

function activityLabel(item: FlaggedActivity): string {
  if (item.type === 'cardio') return item.cardioTypeLabel || 'Cardio ao ar livre';
  if (item.type === 'checkin') return 'Check-in presencial';
  return item.muscleGroup ? `Musculação · ${item.muscleGroup}` : 'Treino de musculação';
}

function reasonLabel(item: FlaggedActivity): string {
  const raw = item.userMessage || item.rejectionReason || item.nonScoringReason;
  if (!raw) return 'Sem motivo registrado.';
  return VALIDATION_MESSAGES[raw] || raw;
}

function formatWhen(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '—';
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  const dateLabel = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeLabel = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${dateLabel} ${timeLabel} (${days <= 0 ? 'hoje' : days === 1 ? 'há 1 dia' : `há ${days} dias`})`;
}

export function AdminFlaggedActivities() {
  const navigate = useNavigate();
  const [activities, setActivities] = useState<FlaggedActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const fetchFlagged = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Sessão expirada. Faça login novamente.');
      const idToken = await user.getIdToken();
      const response = await fetch('/api/admin?action=list-flagged-activities&limit=100', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Falha ao buscar atividades pendentes de revisão.');
      setActivities(Array.isArray(data.activities) ? data.activities : []);
    } catch (err: any) {
      console.error('[AdminFlaggedActivities] Erro ao buscar fila de revisão:', err);
      setError(err.message || 'Erro inesperado.');
    } finally {
      if (!silent) setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchFlagged(); }, []);

  const handleReview = async (item: FlaggedActivity, status: 'valid' | 'invalid' | 'suspicious') => {
    setReviewingId(item.id);
    setFeedback(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Sessão expirada. Faça login novamente.');
      const idToken = await user.getIdToken();
      const response = await fetch('/api/admin', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'review-activity', activityId: item.id, status }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Falha ao revisar a atividade.');
      setActivities(current => current.filter(activity => activity.id !== item.id));
      setFeedback(data.message || 'Atividade revisada com sucesso.');
      setTimeout(() => setFeedback(null), 5000);
    } catch (err: any) {
      console.error('[AdminFlaggedActivities] Erro ao revisar atividade:', err);
      alert(err.message || 'Erro ao revisar atividade.');
    } finally {
      setReviewingId(null);
    }
  };

  const handleRefresh = () => { setRefreshing(true); fetchFlagged(true); };

  const filtered = activities.filter(item => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return item.id.toLowerCase().includes(q) || item.userId.toLowerCase().includes(q) || activityLabel(item).toLowerCase().includes(q);
  });

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 sm:p-6 md:p-8 space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <button
          onClick={() => navigate('/admin')}
          className="flex items-center gap-2 text-xs md:text-sm text-on-surface-variant hover:text-primary transition-all font-bold uppercase tracking-widest"
        >
          <ArrowLeft size={16} /> VOLTAR AO PAINEL
        </button>

        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="flex items-center gap-2 bg-surface-container border border-white/5 px-3 py-1.5 rounded-xl hover:bg-white/5 text-xs text-on-surface-variant transition-all disabled:opacity-50 active:scale-95"
        >
          <RefreshCw size={13} className={cn(refreshing && 'animate-spin')} />
          {refreshing ? 'Atualizando...' : 'Atualizar Fila'}
        </button>
      </div>

      <div className="space-y-2">
        <span className="font-label text-primary text-xs font-black tracking-widest uppercase">REVISÃO MANUAL DE ATIVIDADES</span>
        <h1 className="font-headline italic font-black text-3xl md:text-4xl uppercase tracking-tighter leading-none">
          FILA DE REVISÃO
        </h1>
        <p className="text-sm font-medium text-on-surface-variant max-w-2xl leading-relaxed">
          Atividades que o antifraude marcou como pendentes de revisão (geofence de academia, SecurityPipeline ou presença sem confirmação). Elas ficam paradas aqui até uma decisão manual -- aprovar aplica a pontuação normal, rejeitar mantém zero pontos, suspeita registra com pontuação reduzida.
        </p>
      </div>

      {feedback && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-xs uppercase tracking-wider rounded-2xl flex items-center gap-3">
          <Check size={18} className="shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4">
          {[1, 2, 3].map(n => <div key={n} className="h-28 bg-surface-container/30 border border-white/5 rounded-[28px] animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-[32px] text-center space-y-4">
          <ShieldAlert className="text-red-500 mx-auto" size={40} />
          <h2 className="font-headline italic font-black text-lg uppercase text-white">Falha ao Carregar</h2>
          <p className="text-xs text-on-surface-variant max-w-md mx-auto">{error}</p>
          <button onClick={() => fetchFlagged()} className="bg-red-500 hover:bg-red-600 px-4 py-2 rounded-xl text-xs font-bold uppercase transition">
            Tentar Novamente
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 bg-surface-container p-4 rounded-2xl border border-white/5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
              <Flag size={18} />
            </div>
            <div>
              <p className="font-label text-[8px] font-black text-on-surface-variant uppercase tracking-widest leading-none mb-1">Pendentes de Revisão</p>
              <p className="font-headline italic font-black text-2xl text-amber-400 leading-none">{activities.length}</p>
            </div>
          </div>

          <div className="relative max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" size={16} />
            <input
              type="text"
              placeholder="BUSCAR POR ID DA ATIVIDADE OU DO ATLETA..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full h-11 bg-surface-container border border-white/5 pl-11 pr-4 rounded-xl text-xs font-bold text-white uppercase tracking-wider focus:outline-none focus:border-primary/40 transition-colors placeholder:text-on-surface-variant/40"
            />
          </div>

          <div className="space-y-4">
            {filtered.length === 0 ? (
              <div className="bg-surface-container text-center py-12 px-6 rounded-[32px] border border-white/5">
                <Check className="text-emerald-500/60 mx-auto mb-3" size={32} />
                <p className="text-xs uppercase font-bold text-on-surface-variant">Nenhuma atividade pendente de revisão no momento.</p>
              </div>
            ) : (
              filtered.map(item => (
                <div key={item.id} className="bg-surface-container rounded-[28px] border border-amber-500/20 p-5 md:p-6 shadow-xl space-y-4">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-headline italic font-black text-base text-white uppercase tracking-tight">{activityLabel(item)}</h3>
                        <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-wider font-mono">
                          PENDENTE
                        </span>
                      </div>
                      <p className="text-[10px] font-bold text-on-surface-variant font-mono uppercase">ID: {item.id} · Atleta: {item.userId}</p>
                      <p className="text-[10px] text-on-surface-variant flex items-center gap-1"><Clock size={11} /> {formatWhen(item.createdAt)}</p>
                    </div>
                    {item.duration !== undefined && (
                      <div className="md:text-right shrink-0 text-[11px] text-on-surface-variant font-mono">
                        {item.duration} min{item.distance ? ` · ${Number(item.distance).toFixed(2)} km` : ''}{item.calories ? ` · ${Math.round(item.calories)} kcal` : ''}
                      </div>
                    )}
                  </div>

                  <div className="p-3.5 bg-amber-500/5 border border-amber-500/10 rounded-2xl flex items-start gap-2.5 text-xs text-amber-200/90">
                    <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-0.5" />
                    <span>{reasonLabel(item)}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/5">
                    <button
                      onClick={() => handleReview(item, 'valid')}
                      disabled={reviewingId === item.id}
                      className="flex items-center gap-1.5 bg-emerald-500 text-black hover:bg-emerald-400 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-50 active:scale-95"
                    >
                      <Check size={12} /> Aprovar
                    </button>
                    <button
                      onClick={() => handleReview(item, 'suspicious')}
                      disabled={reviewingId === item.id}
                      className="flex items-center gap-1.5 border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-50 active:scale-95"
                    >
                      <AlertTriangle size={12} /> Suspeita (pontuação reduzida)
                    </button>
                    <button
                      onClick={() => handleReview(item, 'invalid')}
                      disabled={reviewingId === item.id}
                      className="flex items-center gap-1.5 border border-red-500/40 text-red-400 hover:bg-red-500/10 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-50 active:scale-95"
                    >
                      <X size={12} /> Rejeitar
                    </button>
                    {reviewingId === item.id && <span className="text-[10px] text-on-surface-variant font-mono">Salvando...</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
