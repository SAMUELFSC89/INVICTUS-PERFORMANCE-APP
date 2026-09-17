import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db, verifyAuth, getAuth, app, FieldValue } from './_lib/common.js';
import {
  checkPhoneVerification,
  getIdentityProviderReadiness,
  hashVerifiedPhone,
  maskPhone,
  normalizeBrazilianPhone,
  samePhoneHash,
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

function normalizeReceitaStatus(value: unknown): string {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
  // A API do Serpro pode representar situação REGULAR tanto pela descrição
  // textual quanto pelo código cadastral "0". Internamente persistimos sempre
  // a forma canônica REGULAR para que os gates financeiros usem uma só regra.
  return normalized === '0' ? 'REGULAR' : normalized;
}

function isVerifiedPhone(data: any, phone: string): boolean {
  return data.phoneVerified === true && Boolean(phone) && samePhoneHash(phone, data.phoneVerifiedHash);
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
      const rawPhone = String(account.data.phoneNumberNormalized || account.data.phoneNumber || '');
      let phone = '';
      try { phone = rawPhone ? normalizeBrazilianPhone(rawPhone) : ''; } catch { phone = ''; }
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
            verified: isVerifiedPhone(account.data, phone),
            verifiedAt: isVerifiedPhone(account.data, phone) ? account.data.phoneVerifiedAt || null : null,
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
        phoneVerifiedHash: hashVerifiedPhone(normalizedPhone),
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
    return res.status(500).json({
      success: false,
      error: error?.message || 'Não foi possível concluir a verificação da conta.',
    });
  }
}
