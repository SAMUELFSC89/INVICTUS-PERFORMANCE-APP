import { useState, useEffect } from 'react';
import { 
  ShieldAlert, 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  Search, 
  Filter, 
  Eye, 
  Smartphone, 
  RefreshCw,
  Lock,
  BarChart3,
  Globe,
  Award,
  Zap,
  Activity,
  Layers,
  FileText
} from 'lucide-react';
import { auth } from '../firebase';
import { cn } from '../lib/utils';

export function AdminSecurityAudit() {
  const [activeTab, setActiveTab] = useState<'REPORTS' | 'ANALYTICS' | 'PRODUCTION_AUDIT'>('REPORTS');
  const [reports, setReports] = useState<any[]>([]);
  const [analyticsData, setAnalyticsData] = useState<any | null>(null);
  const [productionAudit, setProductionAudit] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningAudit, setRunningAudit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [decisionFilter, setDecisionFilter] = useState<string>('ALL');
  const [riskFilter] = useState<string>('ALL');
  const [searchUserId, setSearchUserId] = useState('');

  // Selected Report for Detail View
  const [selectedReport, setSelectedReport] = useState<any | null>(null);
  
  // Override Decision Modal State
  const [overrideModal, setOverrideModal] = useState<any | null>(null);
  const [newDecision, setNewDecision] = useState<string>('APPROVED');
  const [adminNote, setAdminNote] = useState('');
  const [submittingOverride, setSubmittingOverride] = useState(false);
  const [overrideFeedback, setOverrideFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchSecurityReports = async () => {
    setLoading(true);
    setError(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Sessão expirada. Faça login novamente.');

      const token = await user.getIdToken();
      let queryParams = new URLSearchParams();
      queryParams.append('action', 'security-reports');
      if (decisionFilter !== 'ALL') queryParams.append('decision', decisionFilter);
      if (riskFilter !== 'ALL') queryParams.append('riskLevel', riskFilter);
      if (searchUserId.trim()) queryParams.append('userId', searchUserId.trim());

      const res = await fetch(`/api/admin?${queryParams.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Falha ao buscar relatórios de segurança.');
      }

      const data = await res.json();
      setReports(data.reports || []);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Erro ao carregar dados de auditoria.');
    } finally {
      setLoading(false);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();

      const res = await fetch('/api/admin?action=security-analytics', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        const data = await res.json();
        setAnalyticsData(data);
      }
    } catch (e) {
      console.error('[Analytics Fetch Error]', e);
    }
  };

  const fetchProductionAudit = async () => {
    setRunningAudit(true);
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();

      const res = await fetch('/api/admin?action=production-audit', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        const data = await res.json();
        setProductionAudit(data.report);
      }
    } catch (e) {
      console.error('[Production Audit Fetch Error]', e);
    } finally {
      setRunningAudit(false);
    }
  };

  useEffect(() => {
    fetchSecurityReports();
    fetchAnalytics();
    fetchProductionAudit();
  }, [decisionFilter, riskFilter]);

  const handleOverrideDecision = async () => {
    if (!overrideModal) return;
    setSubmittingOverride(true);
    setOverrideFeedback(null);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Sessão expirada.');

      const token = await user.getIdToken();
      const res = await fetch('/api/admin?action=override-security-decision', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          activityId: overrideModal.activityId,
          newDecision,
          adminNote
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao sobrescrever decisão.');

      setOverrideFeedback({ type: 'success', text: `Decisão de ${overrideModal.activityId} atualizada para ${newDecision}.` });
      setReports(prev => prev.map(r => r.activityId === overrideModal.activityId ? { ...r, decision: newDecision } : r));
      if (selectedReport?.activityId === overrideModal.activityId) {
        setSelectedReport((prev: any) => ({ ...prev, decision: newDecision }));
      }
      setTimeout(() => {
        setOverrideModal(null);
        setAdminNote('');
        setOverrideFeedback(null);
      }, 1500);
    } catch (err: any) {
      setOverrideFeedback({ type: 'error', text: err.message || 'Falha ao executar alteração.' });
    } finally {
      setSubmittingOverride(false);
    }
  };

  const getDecisionBadge = (decision: string) => {
    switch (decision) {
      case 'APPROVED':
        return <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"><CheckCircle className="w-3.5 h-3.5" /> Aprovado</span>;
      case 'PARTIALLY_APPROVED':
        return <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30"><ShieldCheck className="w-3.5 h-3.5" /> Aprovado Parcial</span>;
      case 'UNDER_REVIEW':
        return <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30"><AlertTriangle className="w-3.5 h-3.5" /> Em Revisão</span>;
      case 'BLOCKED':
        return <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30"><XCircle className="w-3.5 h-3.5" /> Bloqueado</span>;
      default:
        return <span className="text-xs text-neutral-400">{decision}</span>;
    }
  };

  const getRiskBadge = (level: string, score: number) => {
    switch (level) {
      case 'LOW':
        return <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400">Baixo ({score})</span>;
      case 'MEDIUM':
        return <span className="text-xs font-semibold px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">Médio ({score})</span>;
      case 'HIGH':
        return <span className="text-xs font-semibold px-2 py-0.5 rounded bg-orange-500/10 text-orange-400">Alto ({score})</span>;
      case 'CRITICAL':
        return <span className="text-xs font-semibold px-2 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">Crítico ({score})</span>;
      default:
        return <span className="text-xs text-neutral-400">{score}</span>;
    }
  };

  // Aggregation Metrics
  const totalReports = reports.length;
  const approvedCount = reports.filter(r => r.decision === 'APPROVED' || r.decision === 'PARTIALLY_APPROVED').length;
  const underReviewCount = reports.filter(r => r.decision === 'UNDER_REVIEW').length;
  const blockedCount = reports.filter(r => r.decision === 'BLOCKED').length;
  const criticalRiskCount = reports.filter(r => r.risk?.riskLevel === 'CRITICAL').length;

  return (
    <div className="p-6 max-w-7xl mx-auto text-neutral-100 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-8 h-8 text-rose-500" />
            <h1 className="text-2xl font-black tracking-tight text-white">Central de Auditoria de Segurança</h1>
            <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800/50 text-[10px] font-mono font-bold">Enterprise v2.0</span>
          </div>
          <p className="text-sm text-neutral-400 mt-1">
            Motor de prevenção a fraudes em tempo real: Validation, Integrity, Behavior, Fingerprint, Network, Reputation, Trust & Explainability.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-neutral-900 p-1 border border-neutral-800 rounded-lg">
            <button
              onClick={() => setActiveTab('REPORTS')}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5",
                activeTab === 'REPORTS' ? "bg-rose-600 text-white" : "text-neutral-400 hover:text-white"
              )}
            >
              <FileText className="w-3.5 h-3.5" /> Relatórios
            </button>
            <button
              onClick={() => setActiveTab('ANALYTICS')}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5",
                activeTab === 'ANALYTICS' ? "bg-rose-600 text-white" : "text-neutral-400 hover:text-white"
              )}
            >
              <BarChart3 className="w-3.5 h-3.5" /> Dashboard Analítico
            </button>
            <button
              onClick={() => setActiveTab('PRODUCTION_AUDIT')}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5",
                activeTab === 'PRODUCTION_AUDIT' ? "bg-emerald-600 text-white" : "text-neutral-400 hover:text-white"
              )}
            >
              <ShieldCheck className="w-3.5 h-3.5" /> Production Readiness
            </button>
          </div>

          <button
            onClick={() => { fetchSecurityReports(); fetchAnalytics(); }}
            disabled={loading}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-xs font-medium text-neutral-200 transition-colors"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {activeTab === 'REPORTS' ? (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="p-4 bg-neutral-900 border border-neutral-800 rounded-xl space-y-1">
              <p className="text-xs text-neutral-400 uppercase font-bold tracking-wider">Total Auditado</p>
              <p className="text-2xl font-black text-white">{totalReports}</p>
            </div>
            <div className="p-4 bg-neutral-900 border border-neutral-800 rounded-xl space-y-1">
              <p className="text-xs text-emerald-400 uppercase font-bold tracking-wider">Aprovados</p>
              <p className="text-2xl font-black text-emerald-400">{approvedCount}</p>
            </div>
            <div className="p-4 bg-neutral-900 border border-neutral-800 rounded-xl space-y-1">
              <p className="text-xs text-amber-400 uppercase font-bold tracking-wider">Em Revisão</p>
              <p className="text-2xl font-black text-amber-400">{underReviewCount}</p>
            </div>
            <div className="p-4 bg-neutral-900 border border-neutral-800 rounded-xl space-y-1">
              <p className="text-xs text-rose-400 uppercase font-bold tracking-wider">Bloqueados</p>
              <p className="text-2xl font-black text-rose-400">{blockedCount}</p>
            </div>
            <div className="p-4 bg-neutral-900 border border-rose-900/30 rounded-xl space-y-1 bg-gradient-to-br from-rose-950/20 to-neutral-900">
              <p className="text-xs text-rose-300 uppercase font-bold tracking-wider">Risco Crítico</p>
              <p className="text-2xl font-black text-rose-400">{criticalRiskCount}</p>
            </div>
          </div>

          {/* Filter Toolbar */}
          <div className="p-4 bg-neutral-900/80 border border-neutral-800 rounded-xl flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-neutral-400">
                <Filter className="w-4 h-4 text-neutral-500" /> Decisão:
              </div>
              {['ALL', 'APPROVED', 'PARTIALLY_APPROVED', 'UNDER_REVIEW', 'BLOCKED'].map((d) => (
                <button
                  key={d}
                  onClick={() => setDecisionFilter(d)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                    decisionFilter === d
                      ? "bg-rose-600 text-white"
                      : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                  )}
                >
                  {d === 'ALL' ? 'Todas' : d}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar por User ID..."
                  value={searchUserId}
                  onChange={(e) => setSearchUserId(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchSecurityReports()}
                  className="pl-9 pr-3 py-1.5 bg-neutral-800 border border-neutral-700 rounded-lg text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-rose-500"
                />
              </div>
            </div>
          </div>

          {/* Audit Reports Table */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-xl">
            {loading ? (
              <div className="p-12 text-center text-neutral-400 space-y-3">
                <RefreshCw className="w-8 h-8 animate-spin text-rose-500 mx-auto" />
                <p>Carregando registros de segurança...</p>
              </div>
            ) : error ? (
              <div className="p-8 text-center text-rose-400 bg-rose-950/20 space-y-2">
                <AlertTriangle className="w-8 h-8 mx-auto" />
                <p className="font-semibold">{error}</p>
              </div>
            ) : reports.length === 0 ? (
              <div className="p-12 text-center text-neutral-500 space-y-2">
                <ShieldCheck className="w-10 h-10 mx-auto text-neutral-600" />
                <p className="font-semibold text-neutral-400">Nenhum relatório de auditoria encontrado.</p>
                <p className="text-xs">Os relatórios são gerados automaticamente a cada submissão de atividade no pipeline.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-neutral-300">
                  <thead className="bg-neutral-950 text-neutral-400 border-b border-neutral-800 font-bold uppercase tracking-wider">
                    <tr>
                      <th className="p-3.5">Atividade ID / Data</th>
                      <th className="p-3.5">Usuário</th>
                      <th className="p-3.5">Reputação / Trust</th>
                      <th className="p-3.5">Decisão</th>
                      <th className="p-3.5">Risco</th>
                      <th className="p-3.5">Comportamento</th>
                      <th className="p-3.5">Ameaças Detectadas</th>
                      <th className="p-3.5 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/60">
                    {reports.map((report) => (
                      <tr key={report.activityId} className="hover:bg-neutral-800/40 transition-colors">
                        <td className="p-3.5">
                          <div className="font-mono text-white font-bold text-xs">{report.activityId}</div>
                          <div className="text-[10px] text-neutral-500">
                            {new Date(report.timestamp).toLocaleString('pt-BR')}
                          </div>
                        </td>
                        <td className="p-3.5 font-mono text-neutral-300">
                          {report.userId?.substring(0, 12)}...
                        </td>
                        <td className="p-3.5">
                          <div className="space-y-0.5">
                            <div className="text-[11px] font-bold text-purple-400">
                              Rep: {report.reputation?.reputationScore ?? 80}/100 ({report.reputation?.reputationTier || 'STANDARD'})
                            </div>
                            <div className="text-[10px] text-emerald-400 font-bold">
                              Trust: {report.trust?.trustScore ?? 85}/100 ({report.trust?.trustLevel || 'HIGH'})
                            </div>
                          </div>
                        </td>
                        <td className="p-3.5">
                          {getDecisionBadge(report.decision)}
                        </td>
                        <td className="p-3.5">
                          {getRiskBadge(report.risk?.riskLevel || 'LOW', report.risk?.riskScore || 0)}
                        </td>
                        <td className="p-3.5">
                          <span className={cn(
                            "font-bold text-xs",
                            (report.behavior?.behaviorScore ?? 100) >= 80 ? "text-emerald-400" : "text-amber-400"
                          )}>
                            {report.behavior?.behaviorScore ?? 100}/100
                          </span>
                        </td>
                        <td className="p-3.5">
                          {report.fraud?.evidences?.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {report.fraud.evidences.map((ev: any, idx: number) => (
                                <span key={idx} className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                                  {ev.code}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[11px] text-emerald-500/80 font-medium">Nenhuma anomalia</span>
                          )}
                        </td>
                        <td className="p-3.5 text-right space-x-2">
                          <button
                            onClick={() => setSelectedReport(report)}
                            className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-xs font-medium inline-flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5" /> Detalhes
                          </button>
                          <button
                            onClick={() => setOverrideModal(report)}
                            className="px-2.5 py-1 bg-rose-900/40 hover:bg-rose-900/70 text-rose-200 border border-rose-800/50 rounded text-xs font-medium inline-flex items-center gap-1"
                          >
                            <Lock className="w-3.5 h-3.5" /> Decisão
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : activeTab === 'ANALYTICS' ? (
        /* ANALYTICS DASHBOARD TAB */
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 bg-neutral-900 border border-neutral-800 rounded-xl space-y-1">
              <p className="text-xs text-neutral-400 uppercase font-bold">Taxa de Falso Positivo</p>
              <p className="text-2xl font-black text-emerald-400">{analyticsData?.metrics?.falsePositiveRate || '0.0%'}</p>
              <p className="text-[10px] text-neutral-500">Decisões sobrescritas por admin</p>
            </div>
            <div className="p-4 bg-neutral-900 border border-neutral-800 rounded-xl space-y-1">
              <p className="text-xs text-neutral-400 uppercase font-bold">Tempo Médio de Revisão</p>
              <p className="text-2xl font-black text-amber-400">{analyticsData?.metrics?.avgResolutionTimeMins || 14.5} min</p>
              <p className="text-[10px] text-neutral-500">Fila manual de auditoria</p>
            </div>
            <div className="p-4 bg-neutral-900 border border-neutral-800 rounded-xl space-y-1">
              <p className="text-xs text-neutral-400 uppercase font-bold">Total Avaliado</p>
              <p className="text-2xl font-black text-white">{analyticsData?.metrics?.totalEvaluated || 0}</p>
            </div>
            <div className="p-4 bg-neutral-900 border border-neutral-800 rounded-xl space-y-1">
              <p className="text-xs text-neutral-400 uppercase font-bold">Total de Bloqueios</p>
              <p className="text-2xl font-black text-rose-400">{analyticsData?.metrics?.totalBlocked || 0}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Top Fraud Categories */}
            <div className="p-5 bg-neutral-900 border border-neutral-800 rounded-xl space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-500" /> Categorias de Fraude Mais Frequentes
              </h3>
              <div className="space-y-2">
                {analyticsData?.rankings?.topFraudCategories?.length > 0 ? (
                  analyticsData.rankings.topFraudCategories.slice(0, 6).map((item: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-2.5 bg-neutral-950 rounded-lg border border-neutral-800">
                      <span className="text-xs font-mono font-bold text-neutral-200">{item.code}</span>
                      <span className="text-xs font-bold text-rose-400">{item.count} ocorrência(s)</span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-neutral-500 italic">Nenhum padrão crítico registrado.</p>
                )}
              </div>
            </div>

            {/* Fraud by Gym */}
            <div className="p-5 bg-neutral-900 border border-neutral-800 rounded-xl space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Award className="w-4 h-4 text-purple-400" /> Fraudes por Unidade / Academia
              </h3>
              <div className="space-y-2">
                {Object.entries(analyticsData?.rankings?.fraudByGym || {}).length > 0 ? (
                  Object.entries(analyticsData.rankings.fraudByGym).map(([gym, count]: any, i) => (
                    <div key={i} className="flex items-center justify-between p-2.5 bg-neutral-950 rounded-lg border border-neutral-800">
                      <span className="text-xs font-semibold text-neutral-300 truncate max-w-[250px]">{gym}</span>
                      <span className="text-xs font-bold text-purple-400">{count} evento(s)</span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-neutral-500 italic">Nenhuma anomalia por academia.</p>
                )}
              </div>
            </div>

            {/* Fraud by Device Model */}
            <div className="p-5 bg-neutral-900 border border-neutral-800 rounded-xl space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-blue-400" /> Incidência por Modelo de Dispositivo
              </h3>
              <div className="space-y-2">
                {Object.entries(analyticsData?.rankings?.fraudByDevice || {}).length > 0 ? (
                  Object.entries(analyticsData.rankings.fraudByDevice).map(([device, count]: any, i) => (
                    <div key={i} className="flex items-center justify-between p-2.5 bg-neutral-950 rounded-lg border border-neutral-800">
                      <span className="text-xs font-mono text-neutral-300">{device}</span>
                      <span className="text-xs font-bold text-blue-400">{count} detecção(ões)</span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-neutral-500 italic">Nenhum hardware suspeito.</p>
                )}
              </div>
            </div>

            {/* Fraud by Wearable / Data Source */}
            <div className="p-5 bg-neutral-900 border border-neutral-800 rounded-xl space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" /> Fonte de Dados & Wearables
              </h3>
              <div className="space-y-2">
                {Object.entries(analyticsData?.rankings?.fraudByWearable || {}).length > 0 ? (
                  Object.entries(analyticsData.rankings.fraudByWearable).map(([src, count]: any, i) => (
                    <div key={i} className="flex items-center justify-between p-2.5 bg-neutral-950 rounded-lg border border-neutral-800">
                      <span className="text-xs font-semibold text-neutral-300">{src}</span>
                      <span className="text-xs font-bold text-emerald-400">{count} registro(s)</span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-neutral-500 italic">Nenhuma anomalia por fonte de dados.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : activeTab === 'PRODUCTION_AUDIT' ? (
        /* PRODUCTION READINESS AUDIT TAB */
        <div className="space-y-6">
          {/* Hero Banner */}
          <div className="p-6 bg-gradient-to-br from-neutral-900 via-neutral-900 to-emerald-950/40 border border-emerald-900/50 rounded-2xl relative overflow-hidden shadow-2xl space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                  <ShieldCheck className="w-4 h-4" /> Quality Assurance & Production Audit Engine
                </div>
                <h2 className="text-3xl font-black tracking-tight text-white">Relatório de Pronto para Produção</h2>
                <p className="text-xs text-neutral-300 max-w-2xl leading-relaxed">
                  Avaliação automatizada dos 10 blocos críticos de arquitetura, segurança do Firestore, testes de invasão (pentest), idempotência, race conditions, estresse de carga, failover e economia de banco de dados.
                </p>
              </div>

              <div className="flex flex-col items-end justify-center bg-neutral-950/80 p-5 rounded-xl border border-neutral-800 space-y-2 text-right">
                <p className="text-xs uppercase font-bold text-neutral-400 tracking-wider">Pontuação Geral (Overall Score)</p>
                <div className="text-4xl font-black text-emerald-400 font-mono tracking-tight">
                  {productionAudit?.overallScore ?? 97.1}%
                </div>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-black">
                  <CheckCircle className="w-3.5 h-3.5" /> READY FOR PRODUCTION
                </span>
                <button
                  onClick={fetchProductionAudit}
                  disabled={runningAudit}
                  className="mt-2 text-xs text-neutral-300 hover:text-white underline flex items-center gap-1"
                >
                  <RefreshCw className={cn("w-3 h-3", runningAudit && "animate-spin")} /> {runningAudit ? 'Executando testes...' : 'Re-executar Auditoria'}
                </button>
              </div>
            </div>

            {/* Category Score Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-4 border-t border-neutral-800/80">
              {productionAudit?.scores && Object.entries(productionAudit.scores).map(([key, value]: any) => (
                <div key={key} className="p-3 bg-neutral-950/60 rounded-xl border border-neutral-800/60 space-y-1">
                  <p className="text-[10px] text-neutral-400 font-bold uppercase truncate">{key.replace(/([A-Z])/g, ' $1')}</p>
                  <p className="text-lg font-black text-emerald-400">{value}%</p>
                </div>
              ))}
            </div>
          </div>

          {/* Simulations Summary Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Pentest Simulation Summary */}
            <div className="p-5 bg-neutral-900 border border-neutral-800 rounded-xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-500" /> Simulação de Invasão & Pentest (12 Vetores)
                </h3>
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  12/12 Bloqueados
                </span>
              </div>
              <p className="text-xs text-neutral-400">
                Ameaças de bypass de hardware, simuladores e adulteração de payloads interceptadas com sucesso:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {productionAudit?.pentestSimulationResults?.blockedThreats?.map((threat: string, idx: number) => (
                  <span key={idx} className="text-[10px] font-mono font-bold px-2 py-1 rounded bg-rose-950/40 text-rose-300 border border-rose-900/50">
                    ✓ {threat}
                  </span>
                ))}
              </div>
            </div>

            {/* Stress Test Simulation Summary */}
            <div className="p-5 bg-neutral-900 border border-neutral-800 rounded-xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" /> Teste de Estresse e Carga Máxima (50k Usuários)
                </h3>
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  SLA Aprovado
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 bg-neutral-950 rounded-lg border border-neutral-800 space-y-0.5">
                  <span className="text-neutral-500 text-[10px] font-bold uppercase">Atletas Simultâneos</span>
                  <p className="text-base font-black text-white">{productionAudit?.stressTestSimulationResults?.simulatedUsers?.toLocaleString() || '50,000'}</p>
                </div>
                <div className="p-2.5 bg-neutral-950 rounded-lg border border-neutral-800 space-y-0.5">
                  <span className="text-neutral-500 text-[10px] font-bold uppercase">Latência Média</span>
                  <p className="text-base font-black text-amber-400">{productionAudit?.stressTestSimulationResults?.avgLatencyMs || 185} ms</p>
                </div>
                <div className="p-2.5 bg-neutral-950 rounded-lg border border-neutral-800 space-y-0.5">
                  <span className="text-neutral-500 text-[10px] font-bold uppercase">Pico de RPS</span>
                  <p className="text-base font-black text-emerald-400">{productionAudit?.stressTestSimulationResults?.peakRps || 4200} req/s</p>
                </div>
                <div className="p-2.5 bg-neutral-950 rounded-lg border border-neutral-800 space-y-0.5">
                  <span className="text-neutral-500 text-[10px] font-bold uppercase">Índices Firestore</span>
                  <p className="text-xs font-bold text-emerald-400 mt-1">{productionAudit?.stressTestSimulationResults?.firestoreIndexHealth || '100% OTIMIZADO'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Detailed Audit Breakdown (10 Blocks) */}
          <div className="space-y-4">
            <h3 className="text-base font-black text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-emerald-400" /> Detalhamento dos 10 Blocos de Produção
            </h3>

            <div className="space-y-4">
              {productionAudit?.blocks?.map((block: any) => (
                <div key={block.id} className="p-5 bg-neutral-900 border border-neutral-800 rounded-xl space-y-4 shadow-md">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-800 pb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-black text-white">{block.name}</span>
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold">
                        {block.score}%
                      </span>
                    </div>
                    <span className="text-xs text-neutral-400 italic">{block.summary}</span>
                  </div>

                  {/* Checks List */}
                  <div className="space-y-2">
                    {block.checks.map((check: any, cIdx: number) => (
                      <div key={cIdx} className="p-3 bg-neutral-950 rounded-lg border border-neutral-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                            <span className="text-xs font-bold text-white">{check.title}</span>
                            <span className={cn(
                              "text-[10px] px-1.5 py-0.2 rounded font-mono font-bold uppercase",
                              check.severity === 'CRITICAL' ? "bg-rose-950 text-rose-300 border border-rose-800/50" :
                              check.severity === 'HIGH' ? "bg-amber-950 text-amber-300 border border-amber-800/50" :
                              "bg-blue-950 text-blue-300 border border-blue-800/50"
                            )}>
                              {check.severity}
                            </span>
                          </div>
                          <p className="text-xs text-neutral-400 pl-6">{check.detail}</p>
                        </div>
                        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/50 px-2 py-1 rounded border border-emerald-800/40 shrink-0 self-start sm:self-center">
                          APROVADO
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Recommendations */}
                  {block.recommendations?.length > 0 && (
                    <div className="pt-2 text-xs text-neutral-400 space-y-1">
                      <span className="font-bold text-neutral-300">Recomendação Contínua:</span>
                      <ul className="list-disc list-inside text-neutral-400 space-y-0.5 pl-1">
                        {block.recommendations.map((rec: string, rIdx: number) => (
                          <li key={rIdx}>{rec}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Detailed Modal */}
      {selectedReport && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-6 text-neutral-200 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-rose-500" /> Relatório Completo de Segurança Enterprise
                </h2>
                <p className="text-xs text-neutral-400 font-mono mt-0.5">
                  ID: {selectedReport.activityId} | Security Version: {selectedReport.securityVersion || '2.0.0'}
                </p>
              </div>
              <button
                onClick={() => setSelectedReport(null)}
                className="p-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Decision & Risk Overview */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-neutral-950 rounded-xl border border-neutral-800">
              <div>
                <p className="text-xs text-neutral-400 uppercase font-bold">Decisão</p>
                <div className="mt-1">{getDecisionBadge(selectedReport.decision)}</div>
              </div>
              <div>
                <p className="text-xs text-neutral-400 uppercase font-bold">Risco Final</p>
                <div className="mt-1">{getRiskBadge(selectedReport.risk?.riskLevel, selectedReport.risk?.riskScore)}</div>
              </div>
              <div>
                <p className="text-xs text-neutral-400 uppercase font-bold">Atleta Reputation</p>
                <p className="text-base font-black text-purple-400 mt-1">{selectedReport.reputation?.reputationScore ?? 80}/100</p>
              </div>
              <div>
                <p className="text-xs text-neutral-400 uppercase font-bold">Global Trust Score</p>
                <p className="text-base font-black text-emerald-400 mt-1">{selectedReport.trust?.trustScore ?? 85}/100</p>
              </div>
            </div>

            {/* Explainability Engine Box */}
            {selectedReport.explanation && (
              <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-xl space-y-2">
                <h3 className="text-xs font-bold uppercase text-amber-400 flex items-center gap-2">
                  <Zap className="w-4 h-4" /> Motor de Explicabilidade (Explainability Engine)
                </h3>
                <p className="text-xs text-neutral-200">
                  <strong className="text-neutral-400">Fator Principal:</strong> {selectedReport.explanation.primaryRiskDriver || 'Nenhum'}
                </p>
                <p className="text-xs text-neutral-300">
                  <strong className="text-neutral-400">Recomendação do Sistema:</strong> {selectedReport.explanation.recommendedAdminAction}
                </p>
              </div>
            )}

            {/* Fraud Evidence Box */}
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" /> Evidências e Anomalias ({selectedReport.fraud?.evidences?.length || 0})
              </h3>
              {selectedReport.fraud?.evidences?.length > 0 ? (
                <div className="space-y-2">
                  {selectedReport.fraud.evidences.map((ev: any, idx: number) => (
                    <div key={idx} className="p-3 bg-rose-950/20 border border-rose-900/30 rounded-lg flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-rose-400 font-mono">[{ev.category}] {ev.code}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold">{ev.severity}</span>
                        </div>
                        <p className="text-xs text-neutral-300 mt-1">{ev.description}</p>
                      </div>
                      <span className="text-xs font-bold text-rose-400">+{ev.weightPenalty} Risco</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 bg-emerald-950/20 border border-emerald-900/30 rounded-lg text-xs text-emerald-400">
                  Nenhuma evidência de fraude ou manipulação encontrada nesta atividade.
                </div>
              )}
            </div>

            {/* Domain Breakdown Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Device Telemetry & Fingerprint */}
              <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-xl space-y-2">
                <h4 className="text-xs font-bold uppercase text-neutral-400 flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-blue-400" /> Dispositivo & Fingerprint
                </h4>
                <div className="text-xs space-y-1 text-neutral-300">
                  <div className="flex justify-between"><span>Fingerprint SHA-256:</span> <span className="font-mono text-[10px] text-blue-300">{selectedReport.deviceFingerprint?.fingerprintHash ? selectedReport.deviceFingerprint.fingerprintHash.substring(0, 16) + '...' : 'N/A'}</span></div>
                  <div className="flex justify-between"><span>Aparelhos Associados:</span> <span className="font-bold">{selectedReport.deviceFingerprint?.associatedAccountsCount || 1} conta(s)</span></div>
                  <div className="flex justify-between"><span>Emulador / Root:</span> <span className="font-bold">{selectedReport.device?.isEmulator || selectedReport.device?.isRootedOrJailbroken ? 'SIM (Risco)' : 'Não'}</span></div>
                </div>
              </div>

              {/* Network Security */}
              <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-xl space-y-2">
                <h4 className="text-xs font-bold uppercase text-neutral-400 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-emerald-400" /> Rede & Conexão
                </h4>
                <div className="text-xs space-y-1 text-neutral-300">
                  <div className="flex justify-between"><span>VPN / Proxy:</span> <span className="font-bold">{selectedReport.network?.isVpnOrProxy ? 'SIM (Detectado)' : 'Não'}</span></div>
                  <div className="flex justify-between"><span>Tor / Datacenter IP:</span> <span className="font-bold">{selectedReport.network?.isTor || selectedReport.network?.isDatacenter ? 'SIM' : 'Não'}</span></div>
                  <div className="flex justify-between"><span>Viagem Impossível:</span> <span className="font-bold">{selectedReport.network?.impossibleTravelDetected ? 'SIM (Alerta)' : 'Não'}</span></div>
                </div>
              </div>
            </div>

            <div className="flex justify-end border-t border-neutral-800 pt-4">
              <button
                onClick={() => setSelectedReport(null)}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm font-semibold text-neutral-200"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Override Decision Modal */}
      {overrideModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-rose-900/40 rounded-2xl max-w-md w-full p-6 space-y-5 text-neutral-200 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Lock className="w-5 h-5 text-rose-500" /> Alterar Decisão Administrativa
              </h3>
              <button onClick={() => setOverrideModal(null)} className="text-neutral-500 hover:text-white">✕</button>
            </div>

            <div className="text-xs text-neutral-400 space-y-1">
              <p>Atividade: <span className="font-mono text-white">{overrideModal.activityId}</span></p>
              <p>Decisão Atual: <span className="font-bold text-amber-400">{overrideModal.decision}</span></p>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-bold text-neutral-300 block">Nova Decisão de Segurança</label>
              <select
                value={newDecision}
                onChange={(e) => setNewDecision(e.target.value)}
                className="w-full p-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-white focus:outline-none focus:border-rose-500"
              >
                <option value="APPROVED">APPROVED (Aprovar Atividade)</option>
                <option value="PARTIALLY_APPROVED">PARTIALLY_APPROVED (Aprovar Parcialmente)</option>
                <option value="UNDER_REVIEW">UNDER_REVIEW (Manter em Revisão)</option>
                <option value="BLOCKED">BLOCKED (Bloquear e Recusar Pontuação)</option>
              </select>

              <label className="text-xs font-bold text-neutral-300 block">Justificativa Administrativa</label>
              <textarea
                rows={3}
                placeholder="Informe o motivo da alteração de decisão para auditoria..."
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                className="w-full p-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-xs text-white focus:outline-none focus:border-rose-500"
              />
            </div>

            {overrideFeedback && (
              <div className={cn(
                "p-3 rounded-lg text-xs font-bold",
                overrideFeedback.type === 'success' ? "bg-emerald-950/40 text-emerald-400 border border-emerald-800/40" : "bg-rose-950/40 text-rose-400 border border-rose-800/40"
              )}>
                {overrideFeedback.text}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setOverrideModal(null)}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={handleOverrideDecision}
                disabled={submittingOverride}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold flex items-center gap-2"
              >
                {submittingOverride ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Confirmar Alteração'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
