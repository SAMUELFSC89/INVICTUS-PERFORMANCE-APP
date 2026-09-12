import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('integridade da Central de Notificações', () => {
  it('cliente não substitui mais o array de notificações pelo Firestore', () => {
    const page = read('src/pages/Notifications.tsx');
    expect(page).not.toContain("from 'firebase/firestore'");
    expect(page).not.toContain('runTransaction(db');
    expect(page).toContain("action: 'mark-read'");
    expect(page).toContain("action: 'mark-all-read'");
    expect(page).toContain('/api/notifications');
  });

  it('backend altera somente read nos IDs existentes', () => {
    const handler = read('api/_handlers/notifications.ts');
    expect(handler).toContain("action === 'mark-read' || action === 'mark-all-read'");
    expect(handler).toContain('markNotificationsRead(auth.uid, ids)');
    expect(handler).toContain('return { ...item, read: true }');
    expect(handler).toContain('transaction.update(profileRef, { notifications: next })');
  });

  it('rules bloqueiam edição direta do array privado de notificações', () => {
    const rules = read('firestore.rules');
    expect(rules).toContain("'notifications', 'fcmTokens', 'apnsTokens'");
  });
});
