import type { ReactNode } from 'react';
import { Brain, Crown, HeartPulse, ShieldCheck } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useUser } from '../UserContext';
import { hasActiveProEntitlement } from '../lib/proEntitlement';
import './ProFeatureGate.css';

type Feature = 'health' | 'ai';

const copy: Record<Feature, { eyebrow: string; title: string; description: string; benefits: string[] }> = {
  health: {
    eyebrow: 'SAÚDE PRO',
    title: 'SEUS DADOS. SUA PERFORMANCE.',
    description: 'Transforme dados de saúde e sensores em uma visão completa da sua evolução.',
    benefits: ['Métricas biométricas e tendências', 'Sono, recuperação e frequência cardíaca', 'Relatórios completos de evolução']
  },
  ai: {
    eyebrow: 'INVICTUS IA',
    title: 'INTELIGÊNCIA PERSONALIZADA.',
    description: 'Converse com a Invictus IA e receba análises personalizadas a partir da sua jornada.',
    benefits: ['Chat e análises por IA', 'Memória individual da sua evolução', 'Insights e recomendações personalizadas']
  }
};

export function ProFeatureGate({ feature, children }: { feature: Feature; children: ReactNode }) {
  const { user } = useUser();
  const navigate = useNavigate();
  const location = useLocation();

  if (hasActiveProEntitlement(user) || user?.role === 'admin') return <>{children}</>;

  const content = copy[feature];
  const Icon = feature === 'health' ? HeartPulse : Brain;

  return <main className="pro-feature-gate">
    <section className="pro-feature-gate-card">
      <span className="pro-feature-gate-icon"><Icon /></span>
      <small>{content.eyebrow}</small>
      <h1>{content.title}</h1>
      <p>{content.description}</p>
      <div className="pro-feature-gate-benefits">
        {content.benefits.map(item => <span key={item}><ShieldCheck />{item}</span>)}
      </div>
      <button onClick={() => navigate('/profile/preferences/subscriptions', {
        state: { returnTo: `${location.pathname}${location.search}${location.hash}` }
      })}><Crown /> DESBLOQUEAR COM PRO</button>
      <em>Plano PRO · assinatura gerenciada pela loja do seu dispositivo</em>
    </section>
  </main>;
}
