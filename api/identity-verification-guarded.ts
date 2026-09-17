import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db, verifyAuth, getAuth, app, FieldValue } from './_lib/common.js';
import {
  checkPhoneVerification,
  getIdentityProviderReadiness,
  maskPhone,
  normalizeBrazilianPhone,
  startPhoneVerification,
  verifyCpfWithReceita,
} from './_lib/identity-verification-service.js';

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

async function loadAccount(uid: string) {
  const [userSnap, authUser] = await Promise.all([
    db.collection('users').doc(uid).get(),
    getAuth(app).getUser(uid),
  ]);
  if (!userSnap.exists) throw new Error('Perfil da conta não encontrado.');
  return { ref: userSnap.ref, data: userSnap.data() || {}, authUser };
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ success: false, error: 'Sessão inválida ou expirada.' });

  try {
    if (req.method === 'GET') {
      const account = await syncEmailVerification(auth.uid);
      const phone = String(account.data.phoneNumberNormalized || account.data.phoneNumber || '');
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
            value: phone ? maskPhone(phone) : '',
            verified: account.data.phoneVerified === true,
            verifiedAt: account.data.phoneVerifiedAt || null,
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
    const account = await loadAccount(auth.uid);

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

    if (action === 'start-phone') {
      const inputPhone = req.body?.phoneNumber || account.data.phoneNumberNormalized || account.data.phoneNumber;
      const normalizedPhone = normalizeBrazilianPhone(inputPhone);
      const duplicate = await db.collection('users').where('phoneNumberNormalized', '==', normalizedPhone).limit(2).get();
      if (duplicate.docs.some((document: any) => document.id !== auth.uid)) {
        return res.status(409).json({ success: false, error: 'Este telefone já está confirmado em outra conta.' });
      }
      await startPhoneVerification(normalizedPhone);
      await account.ref.set({
        pendingPhoneNumber: normalizedPhone,
        phoneVerificationRequestedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return res.status(201).json({
        success: true,
        phone: maskPhone(normalizedPhone),
        userMessage: `Enviamos um código de verificação da Invictus para ${maskPhone(normalizedPhone)}.`,
      });
    }

    if (action === 'confirm-phone') {
      const pendingPhone = String(account.data.pendingPhoneNumber || req.body?.phoneNumber || account.data.phoneNumber || '');
      const normalizedPhone = normalizeBrazilianPhone(pendingPhone);
      const approved = await checkPhoneVerification(normalizedPhone, req.body?.code);
      if (!approved) {
        return res.status(400).json({ success: false, error: 'Código incorreto ou expirado. Solicite um novo código e tente novamente.' });
      }
      const duplicate = await db.collection('users').where('phoneNumberNormalized', '==', normalizedPhone).limit(2).get();
      if (duplicate.docs.some((document: any) => document.id !== auth.uid)) {
        return res.status(409).json({ success: false, error: 'Este telefone já está confirmado em outra conta.' });
      }
      await account.ref.set({
        phoneNumber: normalizedPhone,
        phoneNumberNormalized: normalizedPhone,
        phoneVerified: true,
        phoneVerifiedAt: FieldValue.serverTimestamp(),
        phoneVerificationProvider: 'twilio_verify',
        pendingPhoneNumber: null,
      }, { merge: true });
      return res.json({ success: true, verified: true, phone: maskPhone(normalizedPhone), userMessage: 'Telefone confirmado com sucesso.' });
    }

    if (action === 'verify-cpf') {
      const cpf = String(account.data.cpf || '').replace(/\D/g, '');
      const birthDate = String(account.data.birthDate || '');
      if (!cpf || !birthDate) {
        return res.status(400).json({ success: false, error: 'CPF e data de nascimento precisam estar preenchidos na conta.' });
      }
      const result = await verifyCpfWithReceita(cpf, birthDate);
      if (!result.matched) {
        await account.ref.set({
          cpfVerified: false,
          cpfReceitaStatus: result.status,
          cpfVerificationProvider: result.provider,
          cpfLastCheckedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return res.status(409).json({ success: false, error: 'CPF e data de nascimento não conferem com a base da Receita Federal.' });
      }
      await account.ref.set({
        cpfVerified: true,
        cpfVerifiedAt: FieldValue.serverTimestamp(),
        cpfReceitaStatus: result.status,
        cpfReceitaRegular: result.regular,
        cpfVerificationProvider: result.provider,
        cpfLastCheckedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return res.json({
        success: true,
        verified: true,
        status: result.status,
        regular: result.regular,
        userMessage: 'CPF confirmado diretamente na base da Receita Federal via Serpro.',
      });
    }

    return res.status(400).json({ success: false, error: 'Ação de verificação inválida.' });
  } catch (error: any) {
    console.error('[IdentityVerification] request failed:', error?.message || error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Não foi possível concluir a verificação da conta.',
    });
  }
}
