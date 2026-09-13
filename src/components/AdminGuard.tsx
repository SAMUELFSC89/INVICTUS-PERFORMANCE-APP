import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { auth, db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { AdminShell } from './AdminShell';

const TERMINAL_ADMIN_STATES = new Set([
  'deleted',
  'blocked',
  'banned',
  'suspended',
  'account_deleted',
  'deletion_completed',
]);

function hasActiveAdminProfile(data: Record<string, any> | undefined): boolean {
  if (!data || data.role !== 'admin') return false;
  if (
    data.isBlocked === true
    || data.isBanned === true
    || data.isSuspended === true
    || data.isDeleted === true
    || data.deleted === true
    || data.accountDeleted === true
    || data.disabled === true
    || data.tombstone === true
    || Boolean(data.deletedAt)
    || Boolean(data.accountDeletedAt)
  ) return false;

  const states = [data.status, data.accountStatus, data.lifecycleStatus]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  if (states.some((state) => TERMINAL_ADMIN_STATES.has(state))) return false;

  const deletionStatus = String(data.deletionStatus || '').trim().toLowerCase();
  return !['completed', 'deleted', 'deletion_completed'].includes(deletionStatus);
}

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;

    const checkAdmin = async () => {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        if (active) setIsAdmin(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (active) setIsAdmin(snap.exists() && hasActiveAdminProfile(snap.data()));
      } catch (error) {
        console.error('[AdminGuard] Erro ao validar autoridade administrativa:', error);
        if (active) setIsAdmin(false);
      }
    };

    void checkAdmin();
    return () => { active = false; };
  }, []);

  if (isAdmin === null) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-11 h-11 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) return <Navigate to="/" replace />;
  return <AdminShell>{children}</AdminShell>;
}
