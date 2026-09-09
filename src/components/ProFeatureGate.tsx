import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useUser } from '../UserContext';
import { hasActiveProEntitlement } from '../lib/proEntitlement';

type Feature = 'health' | 'ai';

/**
 * Centraliza todos os caminhos exclusivos do PRO.
 * Usuários FREE não veem paywalls duplicados: qualquer tentativa de abrir um
 * recurso bloqueado cai na tela canônica de assinatura já existente no Perfil.
 * O caminho original é preservado em `returnTo` para permitir retorno após a
 * ativação do entitlement.
 */
export function ProFeatureGate({ feature: _feature, children }: { feature: Feature; children: ReactNode }) {
  const { user } = useUser();
  const location = useLocation();

  if (hasActiveProEntitlement(user) || user?.role === 'admin') return <>{children}</>;

  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  return <Navigate
    to="/profile/preferences/subscriptions"
    replace
    state={{ returnTo, source: 'pro_feature_gate' }}
  />;
}
