/**
 * Checagem canônica de plano PRO. Extraída de private-challenges.ts para que
 * novos gates PRO (ex: Invictus IA, geração de treino por IA) usem exatamente
 * o mesmo critério, em vez de cada arquivo reimplementar sua própria versão.
 * Unificação completa continua sendo o objetivo da tarefa #128 (Política
 * canônica de entitlement PRO/Free) — isto resolve só a duplicação de código,
 * não os pontos mais amplos daquela tarefa (ex: expiração de assinatura).
 */
export function isProUser(userData: any): boolean {
  const tier = (userData?.subscriptionTier || '').toString().toLowerCase();
  return tier === 'performance' || tier === 'pro';
}
