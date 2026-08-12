import React, { useState, useEffect, useTransition } from 'react';
import { 
  ShieldAlert, 
  MapPin, 
  CheckCircle, 
  AlertTriangle, 
  Search, 
  Filter, 
  ArrowLeft, 
  ExternalLink, 
  RefreshCw,
  Sparkles,
  Check,
  Map,
  XCircle
} from 'lucide-react';
import { db, auth } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface AuditItem {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  registeredAddress: string;
  googleMapsAddress: string;
  googleMapsLat: number | null;
  googleMapsLng: number | null;
  distanceMeters: number | null;
  status: 'OK' | 'ERROR' | 'WARNING';
  errors: string[];
  warnings: string[];
}

interface AuditReport {
  success: boolean;
  gymsCount: number;
  errorsCount: number;
  warningsCount: number;
  results: AuditItem[];
  timestamp: string;
}

export function AdminGymAudit() {
  const navigate = useNavigate();
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'errors' | 'warnings' | 'ok'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fixingGymId, setFixingGymId] = useState<string | null>(null);
  const [fixFeedback, setFixFeedback] = useState<string | null>(null);

  const fetchAuditReport = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('Sessão expirada. Faça login novamente.');
      }
      
      const idToken = await user.getIdToken();
      const response = await fetch('/api/admin?action=gyms-audit', {
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Falha ao buscar relatório de auditoria.');
      }

      const data = await response.json();
      setReport(data);
    } catch (err: any) {
      console.error('Error fetching gym audit report:', err);
      setError(err.message || 'Erro inesperado.');
    } finally {
      if (!silent) setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAuditReport();
  }, []);

  const handleManualFix = async (gym: AuditItem) => {
    if (!gym.googleMapsLat || !gym.googleMapsLng) return;
    setFixingGymId(gym.id);
    setFixFeedback(null);
    try {
      // Direct Firestore doc reference for standard gyms
      const gymRef = doc(db, 'gyms', gym.id);
      await updateDoc(gymRef, {
        latitude: gym.googleMapsLat,
        longitude: gym.googleMapsLng,
        address: gym.googleMapsAddress,
        updatedAt: new Date().toISOString()
      });

      setFixFeedback(`Coordenadas de "${gym.name}" corrigidas com sucesso no banco de dados!`);
      // Re-fetch report quietly to show updating result list
      await fetchAuditReport(true);
      
      setTimeout(() => {
        setFixFeedback(null);
      }, 5000);
    } catch (err: any) {
      console.error('Error fixing coordinates:', err);
      alert(`Erro ao tentar atualizar no Firestore: ${err.message || err}`);
    } finally {
      setFixingGymId(null);
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchAuditReport(true);
  };

  // Filter items
  const filteredResults = report?.results.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          item.registeredAddress.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (item.googleMapsAddress && item.googleMapsAddress.toLowerCase().includes(searchTerm.toLowerCase()));

    if (!matchesSearch) return false;

    if (filter === 'errors') return item.status === 'ERROR';
    if (filter === 'warnings') return item.status === 'WARNING';
    if (filter === 'ok') return item.status === 'OK';
    return true;
  }) || [];

  const healthIndex = report && report.gymsCount > 0 
    ? Math.round(((report.gymsCount - report.errorsCount) / report.gymsCount) * 100) 
    : 100;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 sm:p-6 md:p-8 space-y-8">
      {/* Back to admin dashboard */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <button 
          onClick={() => navigate('/admin')} 
          className="flex items-center gap-2 text-xs md:text-sm text-on-surface-variant hover:text-primary transition-all font-bold uppercase tracking-widest"
        >
          <ArrowLeft size={16} /> VOLTAR AO PAINEL
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || loading}
            className="flex items-center gap-2 bg-surface-container border border-white/5 px-3 py-1.5 rounded-xl hover:bg-white/5 text-xs text-on-surface-variant transition-all disabled:opacity-50 active:scale-95"
          >
            <RefreshCw size={13} className={cn(isRefreshing && "animate-spin")} />
            {isRefreshing ? 'Atualizando...' : 'Atualizar Audit'}
          </button>
        </div>
      </div>

      {/* Main title and description */}
      <div className="space-y-2">
        <span className="font-label text-primary text-xs font-black tracking-widest uppercase">AUDITORIA DE CADASTRO E COORDENADAS</span>
        <h1 className="font-headline italic font-black text-3xl md:text-4xl uppercase tracking-tighter leading-none">
          CONCORRÊNCIA E GEOFENCING
        </h1>
        <p className="text-sm font-medium text-on-surface-variant max-w-2xl leading-relaxed">
          Verificação integrada e cruzamento de dados com a API do Google Maps para auditoria automática de localização de todas as unidades parceiras do Invictus. Se a entrada oficial estiver a mais de 30 metros, corrigiremos as marcações para proteção contra fraudes.
        </p>
      </div>

      {/* Alert Feedbacks */}
      <AnimatePresence>
        {fixFeedback && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-xs uppercase tracking-wider rounded-2xl flex items-center gap-3"
          >
            <CheckCircle size={18} className="shrink-0" />
            <span>{fixFeedback}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Primary Statistics cards container */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(n => (
            <div key={n} className="h-32 bg-surface-container/30 border border-white/5 rounded-[32px] animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-[32px] text-center space-y-4">
          <ShieldAlert className="text-red-500 mx-auto" size={40} />
          <h2 className="font-headline italic font-black text-lg uppercase text-white">Falha na Auditoria</h2>
          <p className="text-xs text-on-surface-variant max-w-md mx-auto">{error}</p>
          <button onClick={() => fetchAuditReport()} className="bg-red-500 hover:bg-red-600 px-4 py-2 rounded-xl text-xs font-bold uppercase transition">
            Tentar Novamente
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-surface-container p-6 rounded-[32px] border border-white/5 space-y-2">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <Map size={20} />
              </div>
              <div>
                <p className="font-label text-[8px] font-black text-on-surface-variant uppercase tracking-widest leading-none mb-1">Academias Audita</p>
                <p className="font-headline italic font-black text-3xl text-on-surface leading-none">{report?.gymsCount}</p>
                <p className="font-label text-[8px] text-on-surface/40 uppercase tracking-widest mt-1">Unidades Cadastradas</p>
              </div>
            </div>

            <div className="bg-surface-container p-6 rounded-[32px] border border-white/5 space-y-2">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center">
                <ShieldAlert size={20} />
              </div>
              <div>
                <p className="font-label text-[8px] font-black text-on-surface-variant uppercase tracking-widest leading-none mb-1">Erros Críticos</p>
                <p className="font-headline italic font-black text-3xl text-red-500 leading-none">{report?.errorsCount}</p>
                <p className="font-label text-[8px] text-red-500/40 uppercase tracking-widest mt-1">Afastadas &gt; 30m ou ausentes</p>
              </div>
            </div>

            <div className="bg-surface-container p-6 rounded-[32px] border border-white/5 space-y-2">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
                <AlertTriangle size={20} />
              </div>
              <div>
                <p className="font-label text-[8px] font-black text-on-surface-variant uppercase tracking-widest leading-none mb-1">Advertências</p>
                <p className="font-headline italic font-black text-3xl text-amber-500 leading-none">{report?.warningsCount}</p>
                <p className="font-label text-[8px] text-amber-500/40 uppercase tracking-widest mt-1">Unidades duplicadas no BD</p>
              </div>
            </div>

            <div className="bg-surface-container p-6 rounded-[32px] border border-white/5 space-y-2">
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center",
                healthIndex >= 80 ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
              )}>
                <CheckCircle size={20} />
              </div>
              <div>
                <p className="font-label text-[8px] font-black text-on-surface-variant uppercase tracking-widest leading-none mb-1">Índice de Confabilidade</p>
                <p className={cn(
                  "font-headline italic font-black text-3xl leading-none",
                  healthIndex >= 80 ? "text-emerald-400" : "text-red-400"
                )}>{healthIndex}%</p>
                <p className="font-label text-[8px] text-on-surface/40 uppercase tracking-widest mt-1">Geolocalizações Válidas</p>
              </div>
            </div>
          </div>

          {/* Filtering and search row */}
          <div className="flex flex-col md:flex-row justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" size={16} />
              <input
                type="text"
                placeholder="PROCURAR ACADEMIA POR NOME OU ENDEREÇO..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full h-11 bg-surface-container border border-white/5 pl-11 pr-4 rounded-xl text-xs font-bold text-white uppercase tracking-wider focus:outline-none focus:border-primary/40 transition-colors placeholder:text-on-surface-variant/40"
              />
            </div>

            <div className="flex bg-surface-container p-1 rounded-xl border border-white/5 overflow-x-auto no-scrollbar shrink-0 gap-1">
              {[
                { id: 'all', label: 'Todas' },
                { id: 'errors', label: 'Erros Críticos' },
                { id: 'warnings', label: 'Avisos' },
                { id: 'ok', label: 'Consistentes' }
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setFilter(t.id as any)}
                  className={cn(
                    "px-4 py-2 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all duration-300",
                    filter === t.id 
                      ? "bg-primary text-black" 
                      : "text-on-surface-variant hover:text-white hover:bg-white/5"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Table / Cards list and audit detail records */}
          <div className="space-y-4">
            {filteredResults.length === 0 ? (
              <div className="bg-surface-container text-center py-12 px-6 rounded-[32px] border border-white/5">
                <XCircle className="text-on-surface-variant/30 mx-auto mb-3" size={32} />
                <p className="text-xs uppercase font-bold text-on-surface-variant">Nenhuma unidade encontrada nessa categoria.</p>
              </div>
            ) : (
              filteredResults.map((item, index) => {
                const distanceText = item.distanceMeters !== null
                  ? `${item.distanceMeters.toLocaleString('pt-BR')}m`
                  : 'N/A';
                
                return (
                  <motion.div
                    key={item.id + index}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.04 }}
                    className={cn(
                      "bg-surface-container rounded-[28px] border p-5 md:p-6 shadow-xl transition-all space-y-4 filter drop-shadow relative overflow-hidden",
                      item.status === 'ERROR' ? "border-red-500/20" : item.status === 'WARNING' ? "border-amber-500/20" : "border-white/5"
                    )}
                  >
                    {/* Status badge strip */}
                    <div className="absolute top-0 right-0 h-1.5 w-full bg-surface-container">
                      <div className={cn(
                        "h-full w-full",
                        item.status === 'ERROR' ? "bg-red-500" : item.status === 'WARNING' ? "bg-amber-500" : "bg-emerald-500"
                      )} />
                    </div>

                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 pt-1">
                      {/* Name and main identifier */}
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-headline italic font-black text-base md:text-lg text-white uppercase tracking-tight">{item.name}</h3>
                          
                          {/* Badge elements */}
                          {item.status === 'ERROR' && (
                            <span className="bg-red-500/10 text-red-500 border border-red-500/20 text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-wider font-mono">
                              ERRO CRÍTICO
                            </span>
                          )}
                          {item.status === 'WARNING' && (
                            <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-wider font-mono">
                              ADVERTÊNCIA
                            </span>
                          )}
                          {item.status === 'OK' && (
                            <span className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-wider font-mono">
                              REGISTRO CONSISTENTE
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] font-bold text-on-surface-variant font-mono uppercase">ID: {item.id}</p>
                      </div>

                      {/* Distance summary if calculated */}
                      {item.distanceMeters !== null && (
                        <div className="md:text-right shrink-0">
                          <p className="font-label text-[8px] font-black text-on-surface-variant uppercase tracking-widest leading-none mb-1">Afastamento da Entrada</p>
                          <p className={cn(
                            "font-headline italic font-black text-xl leading-none",
                            item.distanceMeters > 30 ? "text-red-400" : "text-emerald-400"
                          )}>
                            {distanceText}
                          </p>
                          <p className="font-label text-[8px] font-black text-on-surface/30 uppercase mt-0.5">Tolerância: 30m</p>
                        </div>
                      )}
                    </div>

                    {/* Coordinates Comparison Box */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                      {/* Registered database entry info */}
                      <div className="p-4 bg-black/20 rounded-2xl border border-white/5 space-y-2">
                        <span className="text-[8px] font-black tracking-widest uppercase text-on-surface-variant">DADOS REGISTRADOS NO BD</span>
                        <div className="space-y-1 text-xs">
                          <p className="text-[11px] font-semibold text-white leading-relaxed">{item.registeredAddress}</p>
                          <div className="flex gap-4 font-mono text-[9px] text-on-surface-variant/70 border-t border-white/5 pt-1.5 mt-1.5">
                            <span>LAT: <strong className="text-white">{item.latitude !== null ? item.latitude.toFixed(6) : 'AUSENTE'}</strong></span>
                            <span>LNG: <strong className="text-white">{item.longitude !== null ? item.longitude.toFixed(6) : 'AUSENTE'}</strong></span>
                          </div>
                        </div>
                      </div>

                      {/* Google Maps real location entrance */}
                      <div className="p-4 bg-black/20 rounded-2xl border border-white/5 space-y-2">
                        <span className="text-[8px] font-black tracking-widest uppercase text-primary">ENTREGA/ENTRADA REAL GOOGLE MAPS</span>
                        <div className="space-y-1 text-xs">
                          <p className="text-[11px] font-semibold text-white leading-relaxed">{item.googleMapsAddress}</p>
                          <div className="flex gap-4 font-mono text-[9px] text-primary/70 border-t border-primary/5 pt-1.5 mt-1.5">
                            <span>LAT: <strong className="text-white">{item.googleMapsLat !== null ? item.googleMapsLat.toFixed(6) : 'N/A'}</strong></span>
                            <span>LNG: <strong className="text-white">{item.googleMapsLng !== null ? item.googleMapsLng.toFixed(6) : 'N/A'}</strong></span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Messages panel for Errors and Warnings */}
                    {(item.errors.length > 0 || item.warnings.length > 0) && (
                      <div className="p-4 bg-red-500/5 rounded-2xl border border-red-500/10 space-y-2 text-xs font-semibold">
                        {item.errors.map((err, i) => (
                          <div key={i} className="flex items-center gap-2 text-red-400">
                            <ShieldAlert size={14} className="shrink-0 animate-bounce" />
                            <span>{err}</span>
                          </div>
                        ))}
                        {item.warnings.map((warn, i) => (
                          <div key={i} className="flex items-center gap-2 text-amber-400">
                            <AlertTriangle size={14} className="shrink-0" />
                            <span>{warn}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Action buttons footer */}
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/5 justify-between">
                      <div className="flex items-center gap-2 text-[9px] font-bold text-on-surface-variant font-mono uppercase">
                        {item.status === 'OK' && (
                          <span className="text-emerald-400 flex items-center gap-1"><Check size={11} /> Unidade perfeitamente centralizada</span>
                        )}
                        {item.status === 'ERROR' && (
                          <span className="text-red-400 flex items-center gap-1">⚠ Correção manual necessária</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Maps linkage redirection */}
                        {item.googleMapsLat !== null && item.googleMapsLng !== null && (
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${item.googleMapsLat},${item.googleMapsLng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 border border-white/15 hover:bg-white/5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 text-on-surface-variant hover:text-white"
                          >
                            <ExternalLink size={11} /> MAPS
                          </a>
                        )}

                        {/* Interactive fix coordinates capability */}
                        {item.status === 'ERROR' && item.googleMapsLat && item.googleMapsLng && (
                          <button
                            onClick={() => handleManualFix(item)}
                            disabled={fixingGymId === item.id}
                            className="flex items-center gap-1.5 bg-primary text-black hover:bg-primary-hover px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-50 active:scale-95"
                          >
                            <Sparkles size={11} />
                            {fixingGymId === item.id ? 'Corrigindo...' : 'Ajustar para Entrada Real'}
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
