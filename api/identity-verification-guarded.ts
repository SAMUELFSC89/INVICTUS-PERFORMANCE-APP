import type { UserRecord } from 'firebase-admin/auth';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db, verifyAuth, getAuth, app, FieldValue } from './_lib/common.js';
import {
  getIdentityProviderReadiness,
  maskPhone,
  normalizeBrazilianPhone,
  verifyCpfWithReceita,
} from './_lib/identity-verification-service.js';
import { buildVerificationEmail, sendInvictusEmail } from './_lib/zoho-mailer-service.js';

function maskCpf(value: unknown): string {
  const cpf = String(value || '').replace(/\D/g, '');
  if (cpf.length !== 11) return '';
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}

function maskEmail(value: unknown): string {
  const email = String(value || '').trim();
  const [name, domain] = email.split('@');
  if (!name || !domain) return '';
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${'•'.repeat(Math.max(2, Math.min(6, name.length - visible.length)))}@${domain}`;
}

function normalizeReceitaStatus(value: unknown): string {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
  return normalized === '0' ? 'REGULAR' : normalized;
}

type AccountContext = {
  ref: FirebaseFirestore.DocumentReference;
  data: Record<string, any>;
  authUser: UserRecord;
  exists: boolean;
};

async function loadAccount(uid: string): Promise<AccountContext> {
  const ref = db.collection('users').doc(uid);
  const [userSnap, authUser] = await Promise.all([
    ref.get(),
    getAuth(app).getUser(uid),
  ]);
  return {
    ref,
    data: userSnap.exists ? userSnap.data() || {} : {},
    authUser,
    exists: userSnap.exists,
  };
}

async function syncEmailVerification(uid: string) {
  const account = await loadAccount(uid);
  const verified = account.authUser.emailVerified === true;
  if (verified && account.data.emailVerified !== true) {
    await account.ref.set({
      emailVerified: true,
      emailVerifiedAt: FieldValue.serverTimestamp(),
      emailVerificationProvider: 'firebase_auth',
    }, { merge: true });
  }
  return { ...account, emailVerified: verified };
}

async function syncFirebasePhone(account: AccountContext) {
  const rawPhone = String(account.authUser.phoneNumber || '');
  if (!rawPhone) return { phone: '', verified: false };

  const phone = normalizeBrazilianPhone(rawPhone);
  const duplicate = await db.collection('users').where('phoneNumberNormalized', '==', phone).limit(2).get();
  if (duplicate.docs.some((document: any) => document.id !== account.authUser.uid)) {
    throw new Error('Este telefone já está confirmado em outra conta.');
  }

  const needsSync = account.data.phoneNumberNormalized !== phone
    || account.data.phoneVerified !== true
    || account.data.phoneVerificationProvider !== 'firebase_auth_phone';

  if (needsSync) {
    await account.ref.set({
      phoneNumber: phone,
      phoneNumberNormalized: phone,
      phoneVerified: true,
      phoneVerifiedAt: FieldValue.serverTimestamp(),
      phoneVerificationProvider: 'firebase_auth_phone',
      pendingPhoneNumber: null,
    }, { merge: true });
    account.data = {
      ...account.data,
      phoneNumber: phone,
      phoneNumberNormalized: phone,
      phoneVerified: true,
      phoneVerificationProvider: 'firebase_auth_phone',
    };
  }

  return { phone, verified: true };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ success: false, error: 'Sessão inválida ou expirada.' });

  try {
    if (req.method === 'GET') {
      const account = await syncEmailVerification(auth.uid);
      const phoneState = await syncFirebasePhone(account);
      const cpf = String(account.data.cpf || '');
      return res.json({
        success: true,
        identity: {
          email: {
            value: maskEmail(account.authUser.email || account.data.email),
            verified: account.emailVerified,
            verifiedAt: account.data.emailVerifiedAt || null,
          },
          phone: {
            value: phoneState.phone ? maskPhone(phoneState.phone) : '',
            verified: phoneState.verified,
            verifiedAt: phoneState.verified ? account.data.phoneVerifiedAt || null : null,
          },
          cpf: {
            value: maskCpf(cpf),
            verified: account.data.cpfVerified === true,
            verifiedAt: account.data.cpfVerifiedAt || null,
            status: String(account.data.cpfReceitaStatus || ''),
            provider: account.data.cpfVerificationProvider || null,
          },
        },
        providers: getIdentityProviderReadiness(),
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ success: false, error: 'Método não permitido.' });
    }

    const action = String(req.body?.action || '').trim();

    if (action === 'sync-email') {
      const synced = await syncEmailVerification(auth.uid);
      return res.json({
        success: true,
        verified: synced.emailVerified,
        userMessage: synced.emailVerified
          ? 'E-mail confirmado com sucesso.'
          : 'O e-mail ainda não foi confirmado. Abra a mensagem da Invictus e toque no link de verificação.',
      });
    }

    if (action === 'sync-phone') {
      const account = await loadAccount(auth.uid);
      const phoneState = await syncFirebasePhone(account);
      if (!phoneState.verified) {
        return res.status(409).json({
          success: false,
          error: 'Ainda não encontramos um telefone confirmado nesta conta. Conclua a confirmação por código primeiro.',
        });
      }
      return res.json({
        success: true,
        verified: true,
        phone: maskPhone(phoneState.phone),
        userMessage: 'Telefone confirmado com sucesso.',
      });
    }

    if (action === 'send-verification-email') {
      const account = await loadAccount(auth.uid);
      const email = String(account.authUser.email || '').trim();
      if (!email) {
        return res.status(400).json({ success: false, error: 'Esta conta não tem um e-mail cadastrado.' });
      }
      if (account.authUser.emailVerified === true) {
        return res.json({
          success: true,
          verified: true,
          userMessage: 'Seu e-mail já está confirmado.',
        });
      }

      // O link de ação (token, expiração, validação) é sempre gerado e
      // conferido pelo Firebase Admin -- só o envelope do e-mail é da Zoho.
      const link = await getAuth(app).generateEmailVerificationLink(email, {
        url: 'https://invictusperformance.app.br/profile/identity',
        handleCodeInApp: false,
      });
      const { subject, html, text } = buildVerificationEmail(link);

      try {
        await sendInvictusEmail({ to: email, subject, html, text });
      } catch (error: any) {
        console.error('[IdentityVerification] Falha ao enviar e-mail via Zoho SMTP:', error?.message || error);
        return res.status(502).json({
          success: false,
          error: 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.',
        });
      }

      return res.json({
        success: true,
        verified: false,
        userMessage: 'Enviamos um novo e-mail de verificação da Invictus. Abra a mensagem e confirme seu endereço.',
      });
    }

    if (action === 'verify-cpf') {
      const account = await loadAccount(auth.uid);
      const cpf = String(account.data.cpf || '').replace(/\D/g, '');
      const birthDate = String(account.data.birthDate || '');
      if (!cpf || !birthDate) {
        return res.status(400).json({ success: false, error: 'CPF e data de nascimento precisam estar preenchidos na conta.' });
      }

      const result = await verifyCpfWithReceita(cpf, birthDate);
      const receitaStatus = normalizeReceitaStatus(result.status);
      const canVerifyCpf = result.matched === true && result.regular === true && receitaStatus === 'REGULAR';

      if (!canVerifyCpf) {
        await account.ref.set({
          cpfVerified: false,
          cpfVerifiedAt: null,
          cpfReceitaStatus: receitaStatus || 'DESCONHECIDA',
          cpfReceitaRegular: false,
          cpfVerificationProvider: result.provider,
          cpfLastCheckedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        if (!result.matched) {
          return res.status(409).json({ success: false, error: 'CPF e data de nascimento não conferem com a base da Receita Federal.' });
        }
        return res.status(409).json({
          success: false,
          status: receitaStatus || 'DESCONHECIDA',
          error: 'O CPF foi localizado na Receita Federal, mas a situação cadastral não está REGULAR. Regularize o documento antes de usar recursos financeiros.',
        });
      }

      await account.ref.set({
        cpfVerified: true,
        cpfVerifiedAt: FieldValue.serverTimestamp(),
        cpfReceitaStatus: 'REGULAR',
        cpfReceitaRegular: true,
        cpfVerificationProvider: result.provider,
        cpfLastCheckedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return res.json({
        success: true,
        verified: true,
        status: 'REGULAR',
        regular: true,
        userMessage: 'CPF confirmado diretamente na base da Receita Federal via Serpro.',
      });
    }

    return res.status(400).json({ success: false, error: 'Ação de verificação inválida.' });
  } catch (error: any) {
    console.error('[IdentityVerification] request failed:', error?.message || error);
    const message = error?.message || 'Não foi possível concluir a verificação da conta.';
    const status = /já está confirmado em outra conta/i.test(message) ? 409 : 500;
    return res.status(status).json({ success: false, error: message });
  }
}
