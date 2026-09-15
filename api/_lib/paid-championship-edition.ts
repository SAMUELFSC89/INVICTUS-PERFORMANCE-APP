import { db } from './common.js';
import type { Championship } from '../../src/types/championships.js';

export function paidChampionshipRegistrationId(userId: string, editionId: string): string {
  return `${String(userId || '').trim()}_${String(editionId || '').trim()}`;
}

export function paidChampionshipSettlementDocumentId(editionId: string): string {
  return String(editionId || '').trim();
}

function snapshotForStorage(championship: Championship): Championship {
  return JSON.parse(JSON.stringify(championship)) as Championship;
}

/**
 * Publica/amarra a configuração material da edição antes da primeira cobrança.
 *
 * O championshipId continua estável para a navegação, mas uma edição vendida
 * não pode ser substituída por novas envs até que seu settlement esteja
 * FINALIZED. O snapshot persistido permite auditoria/recuperação mesmo depois
 * de o ambiente ser preparado para a próxima edição.
 */
export async function lockPaidChampionshipEdition(championship: Championship): Promise<void> {
  if (!championship.id || !championship.editionId || !championship.publishedConfigDigest) {
    throw new Error('Edição paga sem identidade/configuração publicada.');
  }
  const lockRef = db.collection('championship_edition_locks').doc(championship.id);
  const editionRef = db.collection('championship_editions').doc(championship.editionId);
  const now = new Date().toISOString();

  await db.runTransaction(async (transaction: any) => {
    const lockSnap = await transaction.get(lockRef);
    const lock = lockSnap.exists ? lockSnap.data() || {} : {};
    const previousEditionId = String(lock.activeEditionId || '');

    if (previousEditionId && previousEditionId !== championship.editionId) {
      const previousSettlementRef = db.collection('championship_settlements')
        .doc(paidChampionshipSettlementDocumentId(previousEditionId));
      const previousSettlement = await transaction.get(previousSettlementRef);
      if (!previousSettlement.exists || previousSettlement.data()?.status !== 'FINALIZED') {
        throw new Error(
          'A configuração desta modalidade mudou antes da homologação da edição anterior. Restaure a configuração anterior ou conclua a conciliação antes de abrir nova edição.',
        );
      }
    }

    const editionSnap = await transaction.get(editionRef);
    if (editionSnap.exists) {
      const existing = editionSnap.data() || {};
      if (existing.championshipId !== championship.id
        || existing.configDigest !== championship.publishedConfigDigest
        || existing.regulationHash !== championship.regulationHash) {
        throw new Error('Conflito na identidade imutável da edição paga.');
      }
    } else {
      transaction.create(editionRef, {
        editionId: championship.editionId,
        championshipId: championship.id,
        configDigest: championship.publishedConfigDigest,
        regulationVersion: championship.regulationVersion,
        regulationHash: championship.regulationHash,
        championshipSnapshot: snapshotForStorage(championship),
        status: 'PUBLISHED',
        publishedAt: now,
        updatedAt: now,
      });
    }

    transaction.set(lockRef, {
      championshipId: championship.id,
      activeEditionId: championship.editionId,
      configDigest: championship.publishedConfigDigest,
      regulationVersion: championship.regulationVersion,
      regulationHash: championship.regulationHash,
      updatedAt: now,
      ...(previousEditionId !== championship.editionId ? { activatedAt: now } : {}),
    }, { merge: true });
  });
}

export async function getLockedChampionshipSnapshot(championshipId: string): Promise<Championship | null> {
  const lockSnap = await db.collection('championship_edition_locks').doc(championshipId).get();
  if (!lockSnap.exists) return null;
  const editionId = String(lockSnap.data()?.activeEditionId || '');
  if (!editionId) return null;
  const editionSnap = await db.collection('championship_editions').doc(editionId).get();
  if (!editionSnap.exists) return null;
  const snapshot = editionSnap.data()?.championshipSnapshot;
  return snapshot && typeof snapshot === 'object' ? snapshot as Championship : null;
}

export async function markPaidChampionshipEditionFinalized(championship: Championship, finalizedAt: string): Promise<void> {
  if (!championship.editionId) return;
  const editionRef = db.collection('championship_editions').doc(championship.editionId);
  const lockRef = db.collection('championship_edition_locks').doc(championship.id);
  await db.runTransaction(async (transaction: any) => {
    const [editionSnap, lockSnap] = await Promise.all([
      transaction.get(editionRef),
      transaction.get(lockRef),
    ]);
    if (editionSnap.exists) {
      transaction.set(editionRef, { status: 'FINALIZED', finalizedAt, updatedAt: finalizedAt }, { merge: true });
    }
    if (lockSnap.exists && lockSnap.data()?.activeEditionId === championship.editionId) {
      transaction.set(lockRef, { lastFinalizedEditionId: championship.editionId, lastFinalizedAt: finalizedAt, updatedAt: finalizedAt }, { merge: true });
    }
  });
}
