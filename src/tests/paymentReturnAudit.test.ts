import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('retorno de pagamento usa estado canônico do servidor', () => {
  it('não trata a rota de falha como veredito final quando existe pedido', () => {
    const page = read('src/pages/PaymentSuccess.tsx');
    expect(page).toContain('/api/payments/status/');
    expect(page).toContain('await auth.authStateReady()');
    expect(page).toContain('auth.currentUser?.uid!==expectedUid');
    expect(page).not.toContain('if(failurePage) return;');
  });

  it('sincroniza o perfil quando o status muda o entitlement', () => {
    const page = read('src/pages/PaymentSuccess.tsx');
    expect(page).toContain('const { refreshUser } = useUser()');
    expect(page).toContain('ENTITLEMENT_FINAL');
    expect(page).toContain('await refreshUser?.()');
  });

  it('backend só publica approved depois do provisionamento e valida o dono do pedido', () => {
    const handler = read('api/_handlers/payments-status.ts');
    expect(handler).toContain('orderData.userId !== authUser.uid');
    expect(handler).toContain("paymentStatus === 'approved'");
    expect(handler).toContain("provisionStatus === 'applied'");
    expect(handler).toContain('entitlementValid');
    expect(handler).toContain('accessGranted');
  });
});
