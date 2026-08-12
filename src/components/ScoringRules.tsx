import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Check, Zap, Trophy, ShieldCheck, TrendingUp, Calendar, AlertCircle, Sparkles, 
  Cpu, Lock, ShieldAlert, AlertTriangle, HelpCircle, Search, ChevronDown, ChevronUp, 
  FileText, Shield, Scale, ScrollText, HeartPulse, CreditCard, UserX, AlertOctagon, HelpCircle as FaqIcon
} from 'lucide-react';
import { cn } from '../lib/utils';
import { getSeasonStatus } from '../lib/seasonUtils';
import { 
  LEGAL_TERMS_OF_USE, 
  LEGAL_PRIVACY_POLICY, 
  LEGAL_HEALTH_DATA_POLICY, 
  LEGAL_ANTI_FRAUD_POLICY, 
  LEGAL_PROMOTIONAL_RULES, 
  LEGAL_ACCOUNT_DELETION_POLICY, 
  LEGAL_SUBSCRIPTIONS_POLICY, 
  LEGAL_DISCLAIMERS, 
  LEGAL_FAQ_100 
} from '../lib/legalDocuments';

export function ScoringRules({ section }: { section?: 'scoring' | 'rules' | 'transparency' | 'usage' | 'privacy' | 'competition' | 'prizes' | 'faq' | 'about_ai' }) {
  const season = getSeasonStatus();

  // FAQ State
  const [faqSearch, setFaqSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('TODAS');
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  // Legal Doc Raw Renderer helper
  const renderFormattedText = (text: string) => {
    return (
      <div className="space-y-4 text-xs leading-relaxed text-on-surface-variant font-sans whitespace-pre-line">
        {text.split('\n\n').map((paragraph, idx) => {
          if (paragraph.startsWith('### ') || paragraph.startsWith('## ') || paragraph.startsWith('# ')) {
            const cleanTitle = paragraph.replace(/^#+\s*/, '');
            return (
              <h3 key={idx} className="font-headline italic font-black text-base uppercase text-primary pt-3 border-t border-outline-variant/10">
                {cleanTitle}
              </h3>
            );
          }
          if (paragraph.startsWith('1. ') || paragraph.startsWith('2. ') || paragraph.startsWith('3. ') || paragraph.startsWith('4. ') || paragraph.startsWith('5. ') || paragraph.startsWith('6. ') || paragraph.startsWith('7. ') || paragraph.startsWith('8. ') || paragraph.startsWith('9. ') || paragraph.startsWith('10. ')) {
            return (
              <div key={idx} className="p-3 bg-surface-container rounded-xl border border-outline-variant/10 my-2 font-medium text-on-surface">
                {paragraph}
              </div>
            );
          }
          return <p key={idx}>{paragraph}</p>;
        })}
      </div>
    );
  };

  // Filter FAQ
  const filteredFaqs = LEGAL_FAQ_100.filter(item => {
    const matchesSearch = faqSearch === '' || 
      item.question.toLowerCase().includes(faqSearch.toLowerCase()) || 
      item.answer.toLowerCase().includes(faqSearch.toLowerCase()) ||
      item.id.toString().includes(faqSearch);
      
    const matchesCategory = selectedCategory === 'TODAS' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = ['TODAS', ...Array.from(new Set(LEGAL_FAQ_100.map(f => f.category)))];

  return (
    <div className="space-y-8 pb-12">
      {section === 'about_ai' && (
        <div className="space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 text-black flex items-center justify-center shadow-lg mx-auto">
              <Sparkles size={24} />
            </div>
            <h2 className="font-headline italic font-black text-3xl uppercase tracking-tighter text-on-surface">Sobre a Invictus IA</h2>
            <p className="text-primary font-label text-xs uppercase tracking-widest font-black">Transparência, Segurança e Isenção Médica</p>
          </div>

          <div className="space-y-4">
            {/* Como Funciona */}
            <div className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 space-y-3">
              <div className="flex items-center gap-2.5 text-primary">
                <Cpu size={20} />
                <h3 className="font-headline italic font-black text-lg uppercase tracking-tight">1. Como a Invictus IA Funciona</h3>
              </div>
              <p className="text-on-surface-variant font-label text-xs leading-relaxed">
                A Invictus IA utiliza modelos de inteligência artificial de última geração integrados à ciência do exercício e fisiologia esportiva. Ela analisa os dados autorizados por você no aplicativo (frequência, tempo de treino, estimativa METs, IGA e batimentos cardíacos) para responder perguntas e acelerar sua evolução com segurança.
              </p>
            </div>

            {/* Permissões e Privacidade */}
            <div className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 space-y-3">
              <div className="flex items-center gap-2.5 text-emerald-400">
                <Lock size={20} />
                <h3 className="font-headline italic font-black text-lg uppercase tracking-tight">2. Privacidade e Uso Exclusivo de Dados Autorizados</h3>
              </div>
              <p className="text-on-surface-variant font-label text-xs leading-relaxed">
                A IA opera com acesso restrito apenas às permissões e integrações que você concedeu ativamente (Apple Health, Health Connect, Strava ou sensores de smartwatch).
              </p>
            </div>

            {/* Limitações e Responsabilidade */}
            <div className="bg-surface-container-low p-6 rounded-3xl border border-amber-500/30 space-y-3">
              <div className="flex items-center gap-2.5 text-amber-400">
                <ShieldAlert size={20} />
                <h3 className="font-headline italic font-black text-lg uppercase tracking-tight">3. Limitações e Isenção Médica</h3>
              </div>
              <ul className="list-disc pl-4 space-y-2 text-xs text-on-surface-variant leading-relaxed">
                <li><strong className="text-on-surface">Não realiza diagnósticos clínicos:</strong> A IA é uma ferramenta informativa e de apoio ao treinamento físico.</li>
                <li><strong className="text-on-surface">Não substitui profissionais de saúde:</strong> Não substitui médicos, nutricionistas ou educadores físicos.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* TERMOS DE USO COMPLETO */}
      {section === 'usage' && (
        <section className="space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 bg-blue-500/10 text-blue-400 rounded-2xl flex items-center justify-center mx-auto">
              <ScrollText size={24} />
            </div>
            <h2 className="font-headline italic font-black text-2xl sm:text-3xl uppercase tracking-tighter text-on-surface">Termos de Uso e Adesão</h2>
            <p className="text-on-surface-variant font-label text-[10px] uppercase tracking-widest font-black">Documento Oficial Regulatório do INVICTUS</p>
          </div>

          <div className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 max-h-[70vh] overflow-y-auto">
            {renderFormattedText(LEGAL_TERMS_OF_USE)}
          </div>
        </section>
      )}

      {/* POLÍTICA DE PRIVACIDADE COMPLETA */}
      {section === 'privacy' && (
        <section className="space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 bg-emerald-500/10 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto">
              <Lock size={24} />
            </div>
            <h2 className="font-headline italic font-black text-2xl sm:text-3xl uppercase tracking-tighter text-on-surface">Política de Privacidade (LGPD & GDPR)</h2>
            <p className="text-on-surface-variant font-label text-[10px] uppercase tracking-widest font-black">Tratamento Transparente e Proteção Total de Dados</p>
          </div>

          <div className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 max-h-[70vh] overflow-y-auto">
            {renderFormattedText(LEGAL_PRIVACY_POLICY)}
          </div>
        </section>
      )}

      {/* REGRAS DA COMPETIÇÃO / CONSISTÊNCIA */}
      {section === 'competition' && (
        <section className="space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto">
              <Trophy size={24} />
            </div>
            <h2 className="font-headline italic font-black text-2xl sm:text-3xl uppercase tracking-tighter text-on-surface">Política de Dados de Saúde & HealthKit</h2>
            <p className="text-on-surface-variant font-label text-[10px] uppercase tracking-widest font-black">HealthKit, Health Connect e Telemetria Biométrica</p>
          </div>

          <div className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 max-h-[70vh] overflow-y-auto">
            {renderFormattedText(LEGAL_HEALTH_DATA_POLICY)}
          </div>
        </section>
      )}

      {/* REGULAMENTO DE CAMPANHAS E PREMIAÇÕES */}
      {section === 'prizes' && (
        <section className="space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 bg-amber-500/10 text-amber-400 rounded-2xl flex items-center justify-center mx-auto">
              <Scale size={24} />
            </div>
            <h2 className="font-headline italic font-black text-2xl sm:text-3xl uppercase tracking-tighter text-on-surface">Regulamento das Campanhas Promocionais</h2>
            <p className="text-on-surface-variant font-label text-[10px] uppercase tracking-widest font-black">Mérito Esportivo, Prêmios por Desempenho e Isenção de Sorte</p>
          </div>

          <div className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 max-h-[70vh] overflow-y-auto">
            {renderFormattedText(LEGAL_PROMOTIONAL_RULES)}
          </div>
        </section>
      )}

      {/* TRANSPARÊNCIA E POLÍTICA ANTIFRAUDE */}
      {section === 'transparency' && (
        <section className="space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 bg-red-500/10 text-red-400 rounded-2xl flex items-center justify-center mx-auto">
              <ShieldAlert size={24} />
            </div>
            <h2 className="font-headline italic font-black text-2xl sm:text-3xl uppercase tracking-tighter text-on-surface">Política Antifraude & Compliance</h2>
            <p className="text-on-surface-variant font-label text-[10px] uppercase tracking-widest font-black">Preservação do Fair Play, GPS e Sanções Administrativas</p>
          </div>

          <div className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 max-h-[70vh] overflow-y-auto">
            {renderFormattedText(LEGAL_ANTI_FRAUD_POLICY)}
          </div>
        </section>
      )}

      {/* FAQ 100 PERGUNTAS COMPLETO */}
      {section === 'faq' && (
        <section className="space-y-6 animate-in fade-in duration-300">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto">
              <FaqIcon size={24} />
            </div>
            <h2 className="font-headline italic font-black text-2xl sm:text-3xl uppercase tracking-tighter text-on-surface">Central de Ajuda & FAQ Oficial (100 Questões)</h2>
            <p className="text-on-surface-variant font-label text-[10px] uppercase tracking-widest font-black">
              Respostas Completas sobre Funcionamento, Planos, Saúde e Regras
            </p>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" size={18} />
            <input 
              type="text" 
              value={faqSearch}
              onChange={(e) => setFaqSearch(e.target.value)}
              placeholder="Pesquise por qualquer dúvida (ex: Pix, Smartwatch, LGPD, GPS, Regras)..."
              className="w-full bg-surface-container-low border border-outline-variant/20 rounded-2xl pl-11 pr-4 py-3.5 text-xs text-on-surface focus:outline-none focus:border-primary transition-all placeholder:text-on-surface-variant/50 font-sans font-medium"
            />
            {faqSearch && (
              <button 
                onClick={() => setFaqSearch('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase text-on-surface-variant hover:text-on-surface"
              >
                Limpar
              </button>
            )}
          </div>

          {/* Categories Pill Filters */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
            {categories.map((cat, idx) => (
              <button
                key={idx}
                onClick={() => setSelectedCategory(cat)}
                className={cn(
                  "px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider whitespace-nowrap transition-all cursor-pointer shrink-0 border",
                  selectedCategory === cat 
                    ? "bg-primary border-primary text-black shadow-md shadow-primary/20"
                    : "bg-surface-container-low border-outline-variant/10 text-on-surface-variant hover:text-on-surface"
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Questions Counter */}
          <div className="flex items-center justify-between text-[10px] font-black uppercase text-on-surface-variant px-1">
            <span>Exibindo {filteredFaqs.length} de 100 Perguntas</span>
            {selectedCategory !== 'TODAS' && <span className="text-primary font-bold">Filtro: {selectedCategory}</span>}
          </div>

          {/* Questions Accordion List */}
          <div className="space-y-3">
            {filteredFaqs.length === 0 ? (
              <div className="p-8 text-center bg-surface-container-low rounded-3xl border border-outline-variant/10 space-y-2">
                <AlertCircle className="mx-auto text-on-surface-variant/50" size={28} />
                <p className="font-headline italic font-black uppercase text-sm text-on-surface">Nenhuma pergunta encontrada</p>
                <p className="text-[10px] text-on-surface-variant">Tente pesquisar por outros termos ou limpe o filtro de busca.</p>
              </div>
            ) : (
              filteredFaqs.map((faq) => {
                const isOpen = openFaqIndex === faq.id;
                return (
                  <div 
                    key={faq.id}
                    className="bg-surface-container-low rounded-2xl border border-outline-variant/10 overflow-hidden transition-all"
                  >
                    <button
                      onClick={() => setOpenFaqIndex(isOpen ? null : faq.id)}
                      className="w-full p-4 flex items-start justify-between gap-3 text-left hover:bg-surface-container-high/50 transition-colors cursor-pointer"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[9px] font-black text-primary bg-primary/10 px-2 py-0.5 rounded-md">
                            #{faq.id}
                          </span>
                          <span className="text-[8px] font-black text-on-surface-variant uppercase tracking-widest bg-surface-container px-2 py-0.5 rounded-md">
                            {faq.category}
                          </span>
                        </div>
                        <h3 className="font-headline italic font-black text-sm text-on-surface uppercase leading-tight pt-0.5">
                          {faq.question}
                        </h3>
                      </div>
                      <div className="text-on-surface-variant/50 shrink-0 mt-1">
                        {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </div>
                    </button>

                    <AnimatePresence>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="px-4 pb-4 border-t border-outline-variant/10 bg-surface-container/30"
                        >
                          <p className="text-xs text-on-surface-variant leading-relaxed font-sans font-medium pt-3 whitespace-pre-line">
                            {faq.answer}
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}

      {/* PADRÃO: REGRAS BÁSICAS DA TEMPORADA E PONTUAÇÃO */}
      {(!section || section === 'rules') && (
        <section className="bg-surface-container-high rounded-[40px] p-8 border border-outline-variant/10 shadow-xl space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-primary/20 rounded-2xl flex items-center justify-center text-primary">
              <Calendar size={24} />
            </div>
            <div>
              <h3 className="font-headline italic font-black text-2xl uppercase tracking-tight">Regras da Temporada</h3>
              <p className="text-on-surface-variant font-label text-[10px] uppercase font-bold">Calendário oficial da competição</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 space-y-2">
              <div className="flex items-center gap-2 text-primary">
                <Check size={16} strokeWidth={3} />
                <span className="font-label text-xs font-black uppercase tracking-widest">Início e Fim</span>
              </div>
              <p className="text-on-surface font-label text-[10px] uppercase font-bold leading-relaxed">
                A <span className="text-primary">Temporada A</span> inicia no dia <span className="text-primary">01</span> e a <span className="text-primary">Temporada B</span> inicia no dia <span className="text-primary">15</span> de cada mês.
              </p>
            </div>
            <div className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 space-y-2">
              <div className="flex items-center gap-2 text-primary">
                <Zap size={16} fill="currentColor" />
                <span className="font-label text-xs font-black uppercase tracking-widest">Sem Entrada com Atraso</span>
              </div>
              <p className="text-on-surface font-label text-[10px] uppercase font-bold leading-relaxed">
                As inscrições ocorrem exclusivamente nos dias de início (<span className="text-primary">01</span> ou <span className="text-primary">15</span>), garantindo que todos os atletas comecem a temporada em igualdade absoluta de condições.
              </p>
            </div>
          </div>
        </section>
      )}

      {(!section || section === 'scoring') && (
        <section className="bg-surface-container-highest rounded-[40px] p-8 border border-outline-variant/20 shadow-xl space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-tertiary/20 rounded-2xl flex items-center justify-center text-tertiary">
              <TrendingUp size={24} />
            </div>
            <div>
              <h3 className="font-headline italic font-black text-2xl uppercase tracking-tight">Arquitetura de Pontuação</h3>
              <p className="text-on-surface-variant font-label text-[10px] uppercase font-bold">Sistemas Independentes de Ranking e Progressão (XP)</p>
            </div>
          </div>

          {/* IGA METHODOLOGY HIGHLIGHT */}
          <div className="bg-emerald-500/10 p-6 rounded-3xl border border-emerald-500/30 space-y-3">
            <div className="flex items-center gap-2 text-emerald-400">
              <ShieldCheck size={20} />
              <h4 className="font-headline italic font-black text-base uppercase">Metodologia Científica IGA (Índice Global de Atividade)</h4>
            </div>
            <p className="text-on-surface-variant font-label text-xs leading-relaxed font-medium">
              A pontuação do ranking semanal é calculada estritamente pela média geométrica das variáveis biológicas do seu esforço:
            </p>
            <div className="bg-black/30 p-3 rounded-2xl border border-emerald-500/20 font-mono text-xs text-emerald-300 font-bold text-center">
              IGA = 100 × (Fn × Tn × In)¹/³
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
