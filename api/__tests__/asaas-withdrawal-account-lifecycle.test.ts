import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Asaas withdrawal account lifecycle', () => {
  test('request and provider submission both require an active account', () => {
    const engine = read('api/_lib/withdrawal-engine.ts');
    expect(engine).toContain("import { isActiveAccountState } from './account-state.js'");
    expect(engine).toContain('!isActiveAccountState(userData)');
    expect(engine).toContain('!userSnap.exists || !isActiveAccountState(userSnap.data())');
    expect(engine).toContain('Conta do titular não está ativa para operações financeiras');
  });

  test('request revalidates lifecycle inside the same transaction that creates the financial hold', () => {
    const engine = read('api/_lib/withdrawal-engine.ts');
    const requestStart = engine.indexOf('static async requestWithdrawal');
    const listStart = engine.indexOf('static async getUserWithdrawals', requestStart);
    const requestBlock = engine.slice(requestStart, listStart);

    expect(requestBlock).toContain("const userRef = db.collection('users').doc(userId)");
    expect(requestBlock).toContain('transaction.get(userRef)');
    expect(requestBlock).toContain('!transactionUserSnap.exists || !isActiveAccountState(transactionUserSnap.data())');
    expect(requestBlock).toContain('Conta deixou de estar ativa antes da reserva financeira');
  });

  test('authorization callback revalidates lifecycle immediately before approval', () => {
    const authorization = read('api/_handlers/asaas-withdrawal-authorization.ts');
    expect(authorization).toContain("import { isActiveAccountState } from '../_lib/account-state.js'");
    expect(authorization).toContain('!userSnap.exists || !isActiveAccountState(userSnap.data())');
    expect(authorization).toContain('Conta do titular nao esta ativa para operacoes financeiras.');
  });
});
