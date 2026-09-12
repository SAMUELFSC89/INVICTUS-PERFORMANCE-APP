import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  Building2,
  CalendarDays,
  CreditCard,
  Gauge,
  PackageCheck,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Users,
} from 'lucide-react';
import { InvictusLogo } from './InvictusLogo';
import './AdminShell.css';

type AdminNavItem = {
  path: string;
  label: string;
  icon: typeof Gauge;
};

const ITEMS: AdminNavItem[] = [
  { path: '/admin', label: 'Visão geral', icon: Gauge },
  { path: '/admin/flagged-activities', label: 'Pendências', icon: ShieldAlert },
  { path: '/admin/workouts', label: 'Atividades', icon: Activity },
  { path: '/admin/security', label: 'Antifraude', icon: ShieldCheck },
  { path: '/admin/payouts', label: 'Financeiro', icon: CreditCard },
  { path: '/admin/gym-audit', label: 'Academias', icon: Building2 },
  { path: '/admin/store/pricing', label: 'Loja', icon: ShoppingBag },
  { path: '/admin/store/drops', label: 'Drops', icon: CalendarDays },
  { path: '/admin/store/orders', label: 'Pedidos', icon: PackageCheck },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  return createPortal(
    <main className="admin-new-shell">
      <header className="admin-shell-header">
        <button className="admin-shell-exit" onClick={() => navigate('/profile')} aria-label="Sair do painel administrativo">
          <ArrowLeft />
        </button>
        <div className="admin-shell-brand">
          <InvictusLogo size={38} />
          <span>
            <b>INVICTUS</b>
            <small>CENTRAL ADMINISTRATIVA</small>
          </span>
        </div>
        <div className="admin-shell-status" title="Área restrita">
          <Users />
        </div>
      </header>

      <nav className="admin-shell-nav" aria-label="Navegação administrativa">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.path === '/admin'
            ? location.pathname === '/admin'
            : location.pathname.startsWith(item.path);
          return (
            <button
              key={item.path}
              className={active ? 'is-active' : ''}
              onClick={() => navigate(item.path)}
              aria-current={active ? 'page' : undefined}
            >
              <Icon />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <section className="admin-new-content">{children}</section>
    </main>,
    document.body,
  );
}
