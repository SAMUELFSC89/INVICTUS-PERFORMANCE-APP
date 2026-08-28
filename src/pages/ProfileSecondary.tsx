import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Bell, Building2, Check, CheckSquare, ChevronRight, CircleDollarSign, FileText, Globe2, HelpCircle, Landmark, Languages, LockKeyhole, MapPin, Moon, Plus, RefreshCw, Search, Settings, ShieldCheck, Target, Trash2, Watch, WalletCards, Wifi, X } from 'lucide-react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { auth, db } from '../firebase';
import { sendPasswordResetEmail } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { useUser } from '../UserContext';
import { gymService } from '../services/gymService';
import { WearableManager } from '../services/wearables/WearableManager';
import type { WearableConfig, WearableSource } from '../services/wearables/types';
import { stravaService } from '../services/stravaService';
import { getCurrentLocation } from '../lib/locationUtils';
import { checkNativePermissions } from '../lib/nativePermissions';
import { disablePushNotifications, initPushNotifications } from '../services/pushNotificationService';
import { LEGAL_ACCOUNT_DELETION_POLICY, LEGAL_ANTI_FRAUD_POLICY, LEGAL_CONSENTS, LEGAL_DISCLAIMERS, LEGAL_FAQ_100, LEGAL_HEALTH_DATA_POLICY, LEGAL_PRIVACY_POLICY, LEGAL_PROMOTIONAL_RULES, LEGAL_SUBSCRIPTIONS_POLICY, LEGAL_TERMS_OF_USE, type FAQItem } from '../lib/legalDocuments';
import './ProfileSecondary.css';

type Page = 'academy' | 'academy-search' | 'academy-confirm' | 'wearables' | 'wallet' | 'goals' | 'security' | 'preferences';
type Row = { icon: React.ReactNode; label: string; detail?: string; action?: () => void; danger?: boolean; right?: React.ReactNode };
const title: Record<Page, string> = { academy: 'MINHA ACADEMIA', 'academy-search': 'ALTERAR ACADEMIA', 'academy-confirm': 'ACADEMIA SELECIONADA', wearables: 'DISPOSITIVOS E RELÓGIOS', wallet: 'CARTEIRA', goals: 'METAS', security: 'SEGURANÇA E PRIVACIDADE', preferences: 'CONFIGURAÇÕES' };
const pageFromPath = (path: string): Page => path.includes('academy/search') ? 'academy-search' : path.includes('academy/confirm') ? 'academy-confirm' : path.includes('academy') ? 'academy' : path.includes('wearables') ? 'wearables' : path.includes('wallet') ? 'wallet' : path.includes('goals') ? 'goals' : path.includes('security') ? 'security' : 'preferences';
const providerName: Record<'apple_health' | 'health_connect' | 'strava', string> = { apple_health: 'Apple Health', health_connect: 'Health Connect', strava: 'Strava' };

// #236: estados reais de uma conexao. Antes so existia conectado/nao conectado,
// entao qualquer falha virava "Conexão cancelada pelo usuário" -- inclusive
// abrir Apple Health no Android, onde o provider simplesmente NAO existe.
type ProviderState = 'idle' | 'connecting' | 'connected' | 'unavailable' | 'incomplete' | 'error';

/** Apple Health so existe no app iOS; Health Connect so no app Android. Strava
 *  e OAuth web e funciona em qualquer plataforma. Sem esta checagem o app
 *  chamava um plugin nativo inexistente e reportava erro generico. */
function platformSupports(provider: WearableSource): { ok: boolean; motivo?: string } {
  const nativo = Capacitor.isNativePlatform();
  const plataforma = Capacitor.getPlatform();
  if (provider === 'strava') return { ok: true };
  if (!nativo) return { ok: false, motivo: 'Esta integração só funciona no aplicativo instalado no celular, não pelo navegador.' };
  if (provider === 'apple_health' && plataforma !== 'ios') return { ok: false, motivo: 'O Apple Health existe apenas no iPhone. Neste aparelho, use o Health Connect.' };
  if (provider === 'health_connect' && plataforma !== 'android') return { ok: false, motivo: 'O Health Connect existe apenas no Android. Neste aparelho, use o Apple Health.' };
  return { ok: true };
}

export function ProfileSecondary() {
  const navigate = useNavigate(); const location = useLocation(); const { section } = useParams(); const { user, refreshUser } = useUser();
  const page = pageFromPath(location.pathname); const manager = useMemo(() => WearableManager.getInstance(), []);
  const [searchParams, setSearchParams] = useSearchParams();
  const [notice, setNotice] = useState(''); const [loading, setLoading] = useState(false); const [query, setQuery] = useState(''); const [gyms, setGyms] = useState<any[]>([]); const [selectedGym, setSelectedGym] = useState<any>(location.state?.gym ?? null);
  const [gymError, setGymError] = useState(''); const [geo, setGeo] = useState<{ lat: number; lng: number; neighborhood?: string; city?: string } | null>(null);
  const [wearables, setWearables] = useState<WearableConfig | null>(null); const [syncing, setSyncing] = useState(false);
  const [providerState, setProviderState] = useState<Partial<Record<WearableSource, { state: ProviderState; msg?: string }>>>({});
  const [wallet, setWallet] = useState<any>(null); const [transactions, setTransactions] = useState<any[]>([]); const [withdrawals, setWithdrawals] = useState<any[]>([]); const [withdrawAmount, setWithdrawAmount] = useState(''); const [pixKey, setPixKey] = useState('');
  const [goal, setGoal] = useState(String((user as any)?.objective || '')); const [frequency, setFrequency] = useState(String((user as any)?.weeklyFrequency || ''));
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark'); const [notifications, setNotifications] = useState(localStorage.getItem('notifications-enabled') === 'true'); const [autoSync, setAutoSync] = useState(false);
  const [units, setUnits] = useState(localStorage.getItem('measurement-units') || 'metric');
  const go = (path: string, state?: unknown) => navigate(path, { state });
  const rows = (items: Row[]) => <section className="profile-flow-list">{items.map(item => <button key={item.label} onClick={item.action} className={item.danger ? 'is-danger' : ''} disabled={!item.action}><span className="profile-flow-row-icon">{item.icon}</span><span><b>{item.label}</b>{item.detail && <small>{item.detail}</small>}</span>{item.right ?? <ChevronRight />}</button>)}</section>;
  const message = (text: string) => { setNotice(text); window.setTimeout(() => setNotice(''), 5000); };
  const loadWearables = useCallback(async () => { try { const config = await manager.loadConfig(); setWearables(config); setAutoSync(Boolean(config.autoSync)); } catch { message('Não foi possível carregar o estado das conexões.'); } }, [manager]);
  const loadWallet = useCallback(async () => { try { const token = await auth.currentUser?.getIdToken(); const headers = token ? { Authorization: `Bearer ${token}` } : {}; const [summary, tx, withdrawal] = await Promise.all([fetch('/api/financial?action=summary', { headers }), fetch('/api/financial?action=transactions', { headers }), fetch('/api/financial?action=withdrawals', { headers })]); const [s, t, w] = await Promise.all([summary.json(), tx.json(), withdrawal.json()]); setWallet(s.success ? s.wallet : null); setTransactions(t.success ? t.transactions || [] : []); setWithdrawals(w.success ? w.withdrawals || [] : []); } catch { message('Não foi possível carregar os dados financeiros agora.'); } }, []);
  // #233: contexto de bairro/cidade da busca de academias.
  //
  // O backend (api/_handlers/gyms.ts) tem 3 fallbacks encadeados que SO disparam
  // quando recebem `neighborhood`/`city` -- é o que salva a busca em regiões onde
  // o "nearby" do Google volta vazio. A tela antiga (GymSelector, removida no
  // commit 17db65d) fazia esse reverse-geocoding e passava os dois campos; a tela
  // nova passava apenas lat/lng, então esses fallbacks ficaram mortos e a busca
  // voltava "Nenhuma academia encontrada" mesmo com GPS funcionando.
  const resolveGeoContext = useCallback(async () => {
    const point = await getCurrentLocation(true);
    let neighborhood: string | undefined; let city: string | undefined;
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${point.lat}&lon=${point.lng}&zoom=18&addressdetails=1`);
      const address = (await response.json())?.address || {};
      neighborhood = address.suburb || address.neighbourhood || address.district || address.city_district || undefined;
      city = address.city || address.town || address.village || address.municipality || undefined;
    } catch { /* reverse geocoding é opcional: a busca ainda funciona só com lat/lng */ }
    const context = { lat: point.lat, lng: point.lng, neighborhood, city };
    setGeo(context);
    return context;
  }, []);
  // Último ponto conhecido quando o GPS não responde: evita que o usuário fique
  // sem NENHUMA forma de trocar de academia (antes, GPS negado = tela travada).
  const fallbackPoint = useCallback(() => {
    if (geo) return geo;
    const saved = (user as any)?.gymLocation;
    if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng)) return { lat: saved.lat, lng: saved.lng, neighborhood: undefined, city: undefined };
    return null;
  }, [geo, user]);
  const loadNearbyGyms = useCallback(async () => {
    setLoading(true); setGymError('');
    try {
      const context = await resolveGeoContext();
      setGyms(await gymService.searchNearbyGyms(context.lat, context.lng, context.neighborhood, context.city));
    } catch (e: any) {
      setGymError(e?.message || 'Não foi possível localizar academias próximas.');
    } finally { setLoading(false); }
  }, [resolveGeoContext]);
  useEffect(() => { if (page === 'academy-search') void loadNearbyGyms(); }, [page, loadNearbyGyms]);
  useEffect(() => { if (page === 'wearables') void loadWearables(); if (page === 'wallet') void loadWallet(); }, [page, loadWallet, loadWearables]);
  // A busca por NOME não pode depender do GPS. Antes, se a permissão estivesse
  // negada ou o sinal indisponível, getCurrentLocation() lançava e a busca por
  // texto morria junto -- deixando o usuário sem saída para trocar de academia.
  const searchGym = async (event: React.FormEvent) => {
    event.preventDefault(); if (!query.trim() || loading) return;
    setLoading(true); setGymError('');
    try {
      let context: { lat: number; lng: number; neighborhood?: string; city?: string } | null = geo;
      if (!context) { try { context = await resolveGeoContext(); } catch { context = fallbackPoint(); } }
      if (!context) { setGymError('Precisamos da sua localização para buscar academias. Ative o GPS e toque em TENTAR NOVAMENTE.'); return; }
      setGyms(await gymService.searchGymsByText(query, context.lat, context.lng));
    } catch (e: any) { setGymError(e?.message || 'Busca indisponível no momento.'); } finally { setLoading(false); }
  };
  // `loading` tambem serve de guarda contra clique duplo: dois toques rapidos em
  // "DEFINIR COMO MINHA ACADEMIA" nao podem disparar dois joinGym.
  const confirmGym = async () => { if (!selectedGym || loading) return; setLoading(true); try { const point = selectedGym.geometry?.location || {}; await gymService.joinGym({ place_id: selectedGym.place_id || selectedGym.id, name: selectedGym.name, latitude: typeof point.lat === 'function' ? point.lat() : point.lat ?? selectedGym.lat, longitude: typeof point.lng === 'function' ? point.lng() : point.lng ?? selectedGym.lng, photo_url: selectedGym.photoUrl, address: selectedGym.vicinity || selectedGym.address }); await refreshUser?.(); navigate('/profile'); } catch (e: any) { message(e.message || 'Não foi possível atualizar sua academia.'); } finally { setLoading(false); } };
  const setProv = (provider: WearableSource, state: ProviderState, msg?: string) => setProviderState(prev => ({ ...prev, [provider]: { state, msg } }));
  // #236: FLUXO PROPRIO DE CADA INTEGRACAO.
  //
  // Antes os 3 cards do Perfil apenas navegavam para esta tela generica, e aqui
  // qualquer retorno falso do provider virava "Conexão cancelada pelo usuário".
  // Agora cada provedor passa por: checar disponibilidade da plataforma ->
  // pedir permissao -> CONFIRMAR no servidor -> atualizar estado. Uma permissao
  // aberta nao e mais tratada como conexao concluida.
  const connectProvider = useCallback(async (provider: WearableSource) => {
    const suporte = platformSupports(provider);
    if (!suporte.ok) { setProv(provider, 'unavailable', suporte.motivo); return; }
    try {
      setLoading(true); setProv(provider, 'connecting');
      if (provider === 'strava') {
        // OAuth: saimos do app e voltamos pelo callback. O estado real so pode
        // ser afirmado quando /api/wearables confirmar o vinculo salvo.
        const url = await stravaService.authorize('/profile/wearables');
        window.location.assign(url);
        return;
      }
      const autorizado = await manager.connectProvider(provider);
      if (!autorizado) { setProv(provider, 'incomplete', `Permissões não concedidas para o ${providerName[provider]}. Autorize a leitura de treinos e frequência cardíaca para concluir.`); return; }
      // So declaramos "conectado" depois que o servidor devolve o vinculo.
      const config = await manager.loadConfig();
      setWearables(config); setAutoSync(Boolean(config.autoSync));
      const confirmado = provider === 'apple_health' ? config.appleHealthConnected : config.healthConnectConnected;
      if (confirmado) setProv(provider, 'connected', `${providerName[provider]} conectado.`);
      else setProv(provider, 'incomplete', 'A permissão foi concedida, mas o servidor ainda não confirmou o vínculo. Tente novamente em instantes.');
    } catch (e: any) {
      setProv(provider, 'error', e?.message || `Não foi possível conectar ${providerName[provider]}.`);
    } finally { setLoading(false); }
  }, [manager]);
  const disconnectProvider = async (provider: WearableSource) => { try { setLoading(true); setProv(provider, 'connecting'); await manager.disconnectProvider(provider); await loadWearables(); setProv(provider, 'idle', `${providerName[provider]} desconectado.`); } catch (e: any) { setProv(provider, 'error', e?.message || 'Não foi possível desconectar.'); } finally { setLoading(false); } };
  // #236: o card do Perfil manda /profile/wearables?connect=<provider>, para o
  // toque em "Apple Health" abrir o fluxo do Apple Health -- e nao apenas a
  // lista generica de dispositivos, onde era preciso procurar a integracao de
  // novo. O parametro e consumido na entrada para nao reabrir em loop.
  //
  // Precisa ficar DEPOIS de connectProvider: a lista de dependencias e avaliada
  // durante a renderizacao e uma const ainda nao inicializada quebraria a tela
  // inteira (TDZ), nao so este efeito.
  useEffect(() => {
    if (page !== 'wearables') return;
    const alvo = searchParams.get('connect') as WearableSource | null;
    if (alvo !== 'apple_health' && alvo !== 'health_connect' && alvo !== 'strava') return;
    const proximos = new URLSearchParams(searchParams); proximos.delete('connect');
    setSearchParams(proximos, { replace: true });
    void connectProvider(alvo);
  }, [page, searchParams, setSearchParams, connectProvider]);
  // #248: a ingestao segura de HealthKit/Health Connect agora existe no
  // servidor (api/_handlers/wearables.ts, action "sync"). Sincroniza cada
  // fonte conectada e junta os resultados numa unica mensagem -- o usuario
  // tem um botao so, nao um por provedor.
  const syncNow = async () => {
    if (syncing) return;
    try {
      setSyncing(true);
      const partes: string[] = [];

      if (wearables?.stravaConnected) {
        try {
          const resultado = await stravaService.sync();
          partes.push(`Strava: ${resultado.syncCount ?? 0} atividade(s).`);
        } catch (e: any) {
          partes.push(`Strava: ${e?.message || 'falhou ao sincronizar'}.`);
        }
      }

      if (wearables?.appleHealthConnected || wearables?.healthConnectConnected) {
        try {
          const resultado = await manager.syncAll();
          partes.push(`Health: ${resultado.syncedCount} nova(s), ${resultado.duplicatesSkipped} duplicata(s), ${resultado.blockedCount} não aprovada(s).`);
        } catch (e: any) {
          partes.push(`Health: ${e?.message || 'falhou ao sincronizar'}.`);
        }

        // #253: vitais passivas (FC repouso, HRV, sono, peso) -- não entram
        // no ranking/pontos, então uma falha aqui não deve parecer um erro
        // grave pro usuário; só some da mensagem se não vier nada.
        try {
          const vitais = await manager.syncVitals();
          if (vitais.savedCount > 0) partes.push(`Saúde: ${vitais.savedCount} medição(ões) atualizada(s).`);
        } catch (e) {
          console.warn('[ProfileSecondary] Falha ao sincronizar vitais (não-bloqueante):', e);
        }
      }

      if (partes.length === 0) {
        message('Conecte pelo menos um provedor para sincronizar.');
      } else {
        message(partes.join(' '));
      }
      await loadWearables();
    } catch (e: any) { message(e?.message || 'Não foi possível sincronizar agora.'); } finally { setSyncing(false); }
  };
  const toggleAutoSync = async () => { try { const updated = await manager.updateConfig({ autoSync: !autoSync }); setAutoSync(Boolean(updated.autoSync)); message(`Sincronização automática ${updated.autoSync ? 'ativada' : 'desativada'}.`); } catch { message('Não foi possível alterar a sincronização automática.'); } };
  const inspectPermissions = async () => { try { setLoading(true); const result = await checkNativePermissions(); if (!result.isNative) { message('As permissões nativas são solicitadas no celular, apenas ao usar o recurso correspondente.'); return; } const format = (state: string) => state === 'granted' ? 'ativa' : state === 'denied' ? 'negada' : 'pendente'; message(`Status: localização ${format(result.location)} · saúde ${format(result.health)} · notificações ${format(result.notifications)}.`); } catch { message('Não foi possível consultar as permissões do dispositivo.'); } finally { setLoading(false); } };
  const toggleNotifications = async () => { const next = !notifications; setLoading(true); try { if (next) { const registered = await initPushNotifications(); if (!registered) { message('As notificações não foram autorizadas. Você pode ativá-las nas configurações do aparelho.'); return; } } else { await disablePushNotifications(); } setNotifications(next); localStorage.setItem('notifications-enabled', String(next)); message(next ? 'Notificações ativadas.' : 'Notificações desativadas.'); } catch { message(next ? 'Não foi possível ativar as notificações agora.' : 'Não foi possível desativar as notificações agora.'); } finally { setLoading(false); } };
  const requestWithdrawal = async (event: React.FormEvent) => { event.preventDefault(); if (!withdrawAmount || !pixKey) return; try { setLoading(true); const token = await auth.currentUser?.getIdToken(); const response = await fetch('/api/financial?action=withdraw', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ amount: Number(withdrawAmount), pixKey }) }); const data = await response.json(); if (!data.success) throw new Error(data.error || 'Solicitação não aprovada.'); setWithdrawAmount(''); setPixKey(''); message(data.message || 'Saque solicitado com sucesso.'); await loadWallet(); } catch (e: any) { message(e.message || 'Não foi possível solicitar o saque.'); } finally { setLoading(false); } };
  const saveGoals = async () => { if (!auth.currentUser) return; try { setLoading(true); await updateDoc(doc(db, 'users', auth.currentUser.uid), { objective: goal, weeklyFrequency: frequency }); await refreshUser?.(); message('Metas atualizadas.'); } catch { message('Não foi possível salvar suas metas.'); } finally { setLoading(false); } };
  const switchTheme = () => { const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next); localStorage.setItem('theme', next); document.documentElement.setAttribute('data-theme', next); };
  const switchUnits = () => { const next = units === 'metric' ? 'imperial' : 'metric'; setUnits(next); localStorage.setItem('measurement-units', next); message(next === 'metric' ? 'Unidades métricas ativadas.' : 'Unidades imperiais ativadas. Os dados originais continuam preservados.'); };
  const manageAccess = async () => { const email = auth.currentUser?.email; if (!email) return message('Este acesso é gerenciado pelo provedor com que você entrou no aplicativo.'); try { await sendPasswordResetEmail(auth, email); message(`Enviamos as instruções de acesso para ${email}.`); } catch { message('Não foi possível enviar as instruções de acesso agora.'); } };
  const documents: Record<string, { title: string; content: string }> = { terms: { title: 'TERMOS DE USO', content: LEGAL_TERMS_OF_USE }, privacy: { title: 'POLÍTICA DE PRIVACIDADE', content: LEGAL_PRIVACY_POLICY }, health: { title: 'DADOS DE SAÚDE', content: LEGAL_HEALTH_DATA_POLICY }, antifraud: { title: 'TRANSPARÊNCIA E VALIDAÇÃO', content: LEGAL_ANTI_FRAUD_POLICY }, campaigns: { title: 'CAMPANHAS E PREMIAÇÃO', content: LEGAL_PROMOTIONAL_RULES }, deletion: { title: 'EXCLUSÃO DE CONTA E DADOS', content: LEGAL_ACCOUNT_DELETION_POLICY }, subscriptions: { title: 'ASSINATURAS E CANCELAMENTO', content: LEGAL_SUBSCRIPTIONS_POLICY }, disclaimers: { title: 'AVISOS LEGAIS', content: LEGAL_DISCLAIMERS }, consents: { title: 'CONSENTIMENTOS EXPLÍCITOS', content: LEGAL_CONSENTS } };
  const documentView = (document: { title: string; content: string }) => <section className="profile-flow-document"><h2>{document.title}</h2>{document.content.split('\n\n').map((paragraph, index) => paragraph.startsWith('#') ? <h3 key={index}>{paragraph.replace(/^#+\s*/, '')}</h3> : <p key={index}>{paragraph}</p>)}</section>;
  // #48: as 100 perguntas de LEGAL_FAQ_100 (lib/legalDocuments.ts) ja existiam
  // prontas no projeto, mas nunca tinham sido conectadas na tela -- o FAQ real
  // mostrava so 2 perguntas fixas escritas direto no JSX. Agrupa por categoria
  // (a mesma ordem em que o arquivo fonte já organiza os 100 itens).
  const faqCategoryOrder: FAQItem['category'][] = ['Geral', 'Conta & Perfil', 'Pontuação & IGA', 'Assinaturas PRO', 'Campeonatos Oficiais', 'Health & Wearables', 'Desafios Privados', 'Saques & PIX', 'Antifraude & Auditoria', 'Privacidade & LGPD'];
  const faqView = () => <section className="profile-flow-document profile-flow-faq"><h2>PERGUNTAS FREQUENTES</h2><p className="profile-flow-faq-intro">{LEGAL_FAQ_100.length} perguntas reais sobre o Invictus, agrupadas por assunto.</p>{faqCategoryOrder.map(category => <div key={category} className="profile-flow-faq-group"><h3>{category.toUpperCase()}</h3>{LEGAL_FAQ_100.filter(item => item.category === category).map(item => <details key={item.id} className="profile-flow-faq-item"><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div>)}</section>;
  // #300: "Entenda o jogo -> Como funciona a pontuação" so tinha uma frase
  // generica ("frequencia, intensidade, tempo, gasto calorico e consistencia")
  // que nem batia com o motor real -- caloria NUNCA entra na formula do IGA,
  // so funciona como um portao de coerencia (calorieGate.ts) que pode reduzir
  // (nunca zerar) a pontuacao de UMA sessao suspeita. Texto reescrito direto
  // a partir do motor real (src/core/iga/igaEngine.ts + normalizers.ts +
  // calorieGate.ts), sem inventar nenhum numero. Nome canonico "Indice de
  // Ganhos de Atividade" usado aqui pra bater com o Regulamento (clausula 4.3)
  // e o FAQ #25 -- os comentarios do proprio motor usam "Indice Global de
  // Atividade", inconsistencia pre-existente que nao mexemos aqui.
  //
  // Deliberadamente NAO mencionamos: (1) age handicap -- existe no codigo mas
  // enabled:false, citar so confundiria; (2) teto diario de pontos, bonus de
  // altimetria, diferenciacao esteira/rua -- esses aparecem no FAQ (#28/#31/#32)
  // mas NAO existem no motor real. Nao repetimos aqui, e o FAQ deveria ser
  // corrigido separadamente (fora do escopo desta tela).
  const gameViews: Record<string, React.ReactNode> = { scoring: <section className="profile-flow-document">
    <h2>PONTUAÇÃO IGA</h2>
    <p>O IGA (Índice de Ganhos de Atividade) é a fórmula que transforma seus treinos reais em pontos de ranking. É idêntica para todo mundo, Free ou Pro — a assinatura não muda, bonifica nem penaliza sua pontuação.</p>
    <h3>A FÓRMULA</h3>
    <p>IGA = 100 × ∛(Frequência × Tempo × Intensidade)</p>
    <p>Os três fatores vão de 0 a 1 e são multiplicados entre si antes da raiz cúbica — treinar bastante mas sem intensidade (ou o contrário) rende menos do que equilibrar os três.</p>
    <h3>FREQUÊNCIA</h3>
    <p>Conta suas sessões válidas na semana, até um máximo de 5. Fez 5 ou mais? Frequência conta 100%. Fez 3? Conta 60%.</p>
    <h3>TEMPO</h3>
    <p>Soma os minutos das suas melhores sessões da semana (até 5), com um teto de 90 minutos contados por sessão — treinar 3h não rende mais do que 90 min contados, pra evitar pontuação artificial. A meta é 250 minutos na semana (5 treinos de 50 min); atingir ou passar disso conta 100% em Tempo.</p>
    <h3>INTENSIDADE</h3>
    <p>Calculada pela sua frequência cardíaca média em relação à sua FC máxima estimada. Abaixo de 50% da FC máxima não pontua em Intensidade; a partir de 85% pontua o máximo, e no meio cresce proporcionalmente. Sem monitor de frequência cardíaca conectado, o app estima com segurança pra cada tipo de treino.</p>
    <h3>O QUE CONTA COMO SESSÃO VÁLIDA</h3>
    <p>Musculação e força: pelo menos 30 minutos. Corrida e cardio: pelo menos 20 minutos. Toda sessão também precisa passar pela validação antifraude — quem for reprovado não entra na conta.</p>
    <h3>COERÊNCIA CALÓRICA</h3>
    <p>Se as calorias informadas destoarem muito do esperado pro seu peso, tempo e intensidade, aquela sessão perde 20% da pontuação por inconsistência — mas nunca é descartada, e não informar calorias não penaliza.</p>
    <h3>ATUALIZAÇÃO</h3>
    <p>O ranking é recalculado automaticamente após cada atividade válida ser processada.</p>
  </section>, rules: <section className="profile-flow-document"><h2>REGRAS DA TEMPORADA</h2><p>Somente atividades concluídas e validadas entram na classificação. Cada modalidade pode exigir GPS, sensores, presença ou vídeo.</p><h3>INTEGRIDADE</h3><p>Registros duplicados, inconsistentes ou manipulados podem ser desconsiderados pela auditoria.</p></section>, ai: <section className="profile-flow-document"><h2>INVICTUS IA</h2><p>A análise automática auxilia a validação de registros e a identificação de inconsistências. Ela não substitui revisão humana quando há contestação.</p></section>, faq: faqView() };
  const gameViewTitles: Record<string, string> = { scoring: 'PONTUAÇÃO IGA', rules: 'REGRAS DA TEMPORADA', ai: 'INVICTUS IA', faq: 'PERGUNTAS FREQUENTES' };
  // #49: sub-telas de "Entenda o jogo" (scoring/rules/ai/faq) sao um SEGUNDO
  // nivel dentro de Configuracoes -- section != null nos dois niveis. Sem este
  // mapa, back() tratava qualquer `section` verdadeiro do mesmo jeito e voltar
  // de "Regras da temporada" pulava direto pra raiz de Configuracoes, sem
  // passar por "Entenda o jogo" (a tela de onde o usuario realmente veio).
  // #48: 'faq' saiu daqui de proposito -- agora e um item de 1o nivel direto
  // em Configuracoes (nao mais um sub-item de "Entenda o jogo"), entao seu
  // "voltar" correto e a raiz de Configuracoes, igual aos outros documentos.
  const nestedSectionParent: Record<string, string> = { scoring: 'game', rules: 'game', ai: 'game' };
  const content = () => {
    if (page === 'preferences' && section && documents[section]) return documentView(documents[section]);
    if (page === 'preferences' && section && gameViews[section]) return gameViews[section];
    if (page === 'preferences' && section === 'game') return <><p className="profile-flow-section-label">ENTENDA O JOGO</p>{rows([{ icon:<Target/>, label:'Como funciona a pontuação', action:()=>go('/profile/preferences/scoring') }, { icon:<ShieldCheck/>, label:'Regras da temporada', action:()=>go('/profile/preferences/rules') }, { icon:<ShieldCheck/>, label:'Transparência e validação', action:()=>go('/profile/preferences/antifraud') }, { icon:<Target/>, label:'Sobre a Invictus IA', action:()=>go('/profile/preferences/ai') }])}</>;
    if (page === 'academy') return <><p className="profile-flow-section-label">ACADEMIA ATUAL</p><section className="profile-flow-card profile-flow-gym-current"><Building2 /><div><b>{user?.gymName || 'Nenhuma academia vinculada'}</b><small>{(user as any)?.gymAddress || (user as any)?.city || 'Informações disponíveis no perfil'}</small><em>ATIVA</em></div></section><p className="profile-flow-section-label">INFORMAÇÕES</p>{rows([{ icon:<MapPin/>, label:'Endereço', detail:(user as any)?.gymAddress || 'Não informado' }, { icon:<Target/>, label:'Distância até você', detail:'Calculada quando a localização for permitida' }, { icon:<ShieldCheck/>, label:'Vínculo', detail:'Academia associada ao seu perfil' }])}<button className="profile-flow-primary" onClick={()=>go('/profile/academy/search')}>ALTERAR ACADEMIA</button></>;
    if (page === 'academy-search') return <><form className="profile-flow-search" onSubmit={searchGym}><Search /><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar academia por nome" /><button aria-label="Buscar"><Search /></button></form><p className="profile-flow-section-label">{query ? 'RESULTADOS' : 'ACADEMIAS PRÓXIMAS'}</p>{loading && <p className="profile-flow-muted">Buscando com sua localização atual…</p>}{!loading && gymError && <><p className="profile-flow-notice"><X />{gymError}</p><button className="profile-flow-primary" onClick={()=>void loadNearbyGyms()}><RefreshCw /> TENTAR NOVAMENTE</button></>}{rows(gyms.map(g => ({ icon:<Building2/>, label:g.name, detail:`${g.vicinity || g.address || 'Endereço não informado'}${g.distance ? ` · ${g.distance}` : ''}`, action:()=>{ setSelectedGym(g); go('/profile/academy/confirm', { gym:g }); } })))}{!loading && !gymError && !gyms.length && <p className="profile-flow-muted">Nenhuma academia encontrada nesta área. Tente buscar pelo nome.</p>}</>;
    if (page === 'academy-confirm') return <section className="profile-flow-confirm"><span><Building2 /></span><Check className="profile-flow-confirm-check" /><p>Academia selecionada!</p><h2>{selectedGym?.name || 'Academia'}</h2><small>{selectedGym?.vicinity || selectedGym?.address || 'Localização informada pela busca'}</small><button className="profile-flow-primary" disabled={loading} onClick={confirmGym}>DEFINIR COMO MINHA ACADEMIA</button><button className="profile-flow-text" onClick={()=>navigate(-1)}>CANCELAR</button></section>;
    if (page === 'wearables') {
      const config = wearables;
      const providers: WearableSource[] = ['apple_health', 'health_connect', 'strava'];
      // Cada linha reporta o estado REAL da integração. "Conectado" só aparece
      // quando o servidor confirmou o vínculo; plataforma incompatível, permissão
      // parcial e erro têm textos próprios em vez do antigo "cancelado pelo usuário".
      const linhas = providers.map(provider => {
        const connected = provider === 'apple_health' ? Boolean(config?.appleHealthConnected) : provider === 'health_connect' ? Boolean(config?.healthConnectConnected) : Boolean(config?.stravaConnected);
        const local = providerState[provider];
        const suporte = platformSupports(provider);
        const estado: ProviderState = local?.state === 'connecting' ? 'connecting' : connected ? 'connected' : !suporte.ok ? 'unavailable' : (local?.state || 'idle');
        const detalhe = estado === 'connecting' ? 'Conectando…'
          : estado === 'connected' ? 'Conectado'
          : estado === 'unavailable' ? (local?.msg || suporte.motivo || 'Indisponível neste aparelho')
          : estado === 'incomplete' ? (local?.msg || 'Permissão incompleta')
          : estado === 'error' ? (local?.msg || 'Erro ao conectar')
          : 'Não conectado';
        const rotulo = estado === 'connecting' ? '…' : estado === 'connected' ? 'DESCONECTAR' : estado === 'unavailable' ? 'INDISPONÍVEL' : 'CONECTAR';
        return {
          icon: <Watch/>, label: providerName[provider], detail: detalhe,
          // Sem ação quando a plataforma não suporta: um card que não pode fazer
          // nada precisa ficar visivelmente inerte, não fingir que vai conectar.
          action: estado === 'unavailable' || estado === 'connecting' ? undefined : () => connected ? disconnectProvider(provider) : connectProvider(provider),
          right: <span className={estado === 'connected' ? 'profile-flow-status is-active' : 'profile-flow-status'}>{rotulo}</span>
        };
      });
      // #248: qualquer provedor conectado (Strava, Apple Health ou Health
      // Connect) já sincroniza de verdade -- antes só o Strava contava aqui.
      const podeSincronizar = Boolean(config?.stravaConnected || config?.appleHealthConnected || config?.healthConnectConnected);
      return <><p className="profile-flow-section-label">CONEXÕES</p>{rows(linhas)}<button className="profile-flow-primary" disabled={loading || syncing || !podeSincronizar} onClick={syncNow}><RefreshCw /> {syncing ? 'SINCRONIZANDO…' : 'SINCRONIZAR AGORA'}</button>{!podeSincronizar && <p className="profile-flow-muted">Conecte pelo menos um provedor acima para sincronizar seus treinos.</p>}<p className="profile-flow-section-label">SINCRONIZAÇÃO E PERMISSÕES</p>{rows([{ icon:<Wifi/>, label:'Sincronização automática', detail:autoSync ? 'Ativada' : 'Desativada', action:toggleAutoSync, right:<span className={autoSync ? 'profile-flow-toggle is-on' : 'profile-flow-toggle'}><i /></span> }, { icon:<ShieldCheck/>, label:'Status de permissões', detail:'Cada permissão é pedida ao usar o recurso', action:inspectPermissions }])}</>;
    }
    if (page === 'wallet') return <><section className="profile-flow-card profile-flow-balance"><small>SALDO DISPONÍVEL</small><b>R$ {Number(wallet?.redeemableBalance || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</b><span>Saldo proveniente de movimentações reais</span></section><p className="profile-flow-section-label">EXTRATO RECENTE</p>{rows(transactions.slice(0, 8).map(tx => ({ icon:<WalletCards/>, label:tx.description || tx.type || 'Movimentação', detail:`${tx.createdAt ? new Date(tx.createdAt).toLocaleDateString('pt-BR') : 'Data indisponível'} · ${tx.status || 'processando'}` })))}{!transactions.length && <p className="profile-flow-muted">Ainda não há movimentações registradas.</p>}<p className="profile-flow-section-label">SOLICITAR SAQUE</p><form className="profile-flow-form" onSubmit={requestWithdrawal}><input inputMode="decimal" value={withdrawAmount} onChange={e=>setWithdrawAmount(e.target.value)} placeholder="Valor em R$" /><input value={pixKey} onChange={e=>setPixKey(e.target.value)} placeholder="Chave PIX" /><button className="profile-flow-primary" disabled={loading}>SOLICITAR SAQUE</button></form>{withdrawals.length > 0 && <><p className="profile-flow-section-label">SAQUES</p>{rows(withdrawals.slice(0, 5).map(w => ({ icon:<CircleDollarSign/>, label:`R$ ${Number(w.amount || 0).toLocaleString('pt-BR',{minimumFractionDigits:2})}`, detail:w.status || 'Em análise' })))}</>}</>;
    if (page === 'goals') return <><p className="profile-flow-muted">Defina objetivos que serão usados para organizar o seu plano de treino.</p><section className="profile-flow-form"><label>OBJETIVO PRINCIPAL<input value={goal} onChange={e=>setGoal(e.target.value)} placeholder="Ex.: ganho de força" /></label><label>FREQUÊNCIA SEMANAL<input value={frequency} onChange={e=>setFrequency(e.target.value)} placeholder="Ex.: 4 treinos por semana" /></label></section><button className="profile-flow-primary" disabled={loading} onClick={saveGoals}><Target /> SALVAR METAS</button></>;
    if (page === 'security') return <><p className="profile-flow-section-label">SEGURANÇA</p>{rows([{ icon:<LockKeyhole/>, label:'Senha e acesso', detail:'Receba as instruções pelo seu provedor de login', action:manageAccess }, { icon:<ShieldCheck/>, label:'Permissões e dados', detail:'Consulte os consentimentos de saúde', action:()=>go('/profile/preferences/health') }, { icon:<Globe2/>, label:'Privacidade', detail:'Leia como seus dados são tratados', action:()=>go('/profile/preferences/privacy') }])}<p className="profile-flow-section-label">CONTA</p>{rows([{ icon:<Trash2/>, label:'Excluir minha conta', detail:'A exclusão deve ser solicitada ao suporte', danger:true, action:()=>message('Para proteger seus dados, solicite a exclusão da conta pelo canal de suporte.') }])}</>;
    return <><p className="profile-flow-section-label">GERAL</p>{rows([{ icon:<Bell/>, label:'Notificações', detail:notifications ? 'Ativadas' : 'Desativadas', action:toggleNotifications, right:<span className={notifications ? 'profile-flow-toggle is-on' : 'profile-flow-toggle'}><i /></span> }, { icon:<Settings/>, label:'Unidades', detail:units === 'metric' ? 'Métrico (kg, km)' : 'Imperial (lb, mi)', action:switchUnits }, { icon:<Moon/>, label:'Tema', detail:theme === 'dark' ? 'Escuro' : 'Claro', action:switchTheme }, { icon:<Languages/>, label:'Idioma', detail:'Português', action:()=>message('Português é o idioma disponível nesta versão do aplicativo.') }])}<p className="profile-flow-section-label">INFORMAÇÕES E POLÍTICAS</p>{rows([{ icon:<Target/>, label:'Entenda o jogo', action:()=>go('/profile/preferences/game') }, { icon:<HelpCircle/>, label:'Perguntas frequentes', detail:`${LEGAL_FAQ_100.length} perguntas e respostas`, action:()=>go('/profile/preferences/faq') }, { icon:<FileText/>, label:'Termos de uso', action:()=>go('/profile/preferences/terms') }, { icon:<LockKeyhole/>, label:'Política de privacidade', action:()=>go('/profile/preferences/privacy') }, { icon:<ShieldCheck/>, label:'Dados de saúde', action:()=>go('/profile/preferences/health') }, { icon:<ShieldCheck/>, label:'Campanhas e premiação', action:()=>go('/profile/preferences/campaigns') }, { icon:<Landmark/>, label:'Assinaturas e cancelamento', action:()=>go('/profile/preferences/subscriptions') }, { icon:<Trash2/>, label:'Exclusão de conta e dados', action:()=>go('/profile/preferences/deletion') }, { icon:<CheckSquare/>, label:'Consentimentos explícitos', action:()=>go('/profile/preferences/consents') }, { icon:<AlertTriangle/>, label:'Avisos legais', action:()=>go('/profile/preferences/disclaimers') }])}<button className="profile-flow-danger" onClick={()=>auth.signOut().then(()=>window.location.assign('/'))}>SAIR DA CONTA</button></>;
  };
  const back = () => { if (page === 'academy-search') return navigate('/profile/academy'); if (page === 'academy-confirm') return navigate('/profile/academy/search'); if (page === 'preferences' && section && nestedSectionParent[section]) return navigate(`/profile/preferences/${nestedSectionParent[section]}`); if (page === 'preferences' && section) return navigate('/profile/preferences'); return navigate(location.pathname.startsWith('/admin/') ? '/admin' : '/profile'); };
  return <main className="profile-flow-screen"><header><button onClick={back} aria-label="Voltar"><ArrowLeft /></button><h1>{page === 'preferences' && section ? (documents[section]?.title || gameViewTitles[section] || (section === 'game' ? 'ENTENDA O JOGO' : title[page])) : title[page]}</h1></header>{notice && <p className="profile-flow-notice"><X />{notice}</p>}<div className="profile-flow-content">{content()}{page === 'preferences' && !section && (user as any)?.role === 'admin' && <button className="profile-flow-primary" onClick={()=>go('/admin')}>PAINEL ADMINISTRATIVO</button>}</div></main>;
}
