import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { Activity, ArrowLeft, Building2, CalendarDays, CreditCard, Dumbbell, FlaskConical, Gauge, PackageCheck, ShieldCheck, ShoppingBag, Users, Watch } from 'lucide-react';
import { InvictusLogo } from './InvictusLogo';
import './AdminShell.css';

const ITEMS = [
  {path:'/admin',label:'Visão geral',icon:Gauge},
  {path:'/admin/workouts',label:'Atividades',icon:Dumbbell},
  {path:'/admin/security',label:'Antifraude',icon:ShieldCheck},
  {path:'/admin/store/pricing',label:'Loja',icon:ShoppingBag},
  {path:'/admin/store/drops',label:'Drops',icon:CalendarDays},
  {path:'/admin/store/orders',label:'Pedidos',icon:PackageCheck},
  {path:'/admin/payouts',label:'Financeiro',icon:CreditCard},
  {path:'/admin/gym-audit',label:'Locais',icon:Building2},
  {path:'/admin/wearables',label:'Dispositivos',icon:Watch},
  {path:'/admin/ranking-simulator',label:'Simulador',icon:Activity},
  {path:'/admin/iga-teste-original',label:'IGA',icon:FlaskConical}
];

export function AdminShell({children}:{children:ReactNode}) {
  const navigate=useNavigate();
  const location=useLocation();
  return createPortal(<main className="admin-new-shell">
    <header><button onClick={()=>navigate('/profile')} aria-label="Sair do painel"><ArrowLeft/></button><div><InvictusLogo size={40}/><span><b>INVICTUS</b><small>PAINEL ADMINISTRATIVO</small></span></div><Users/></header>
    <nav>{ITEMS.map(item=>{const Icon=item.icon;const active=item.path==='/admin'?location.pathname==='/admin':location.pathname.startsWith(item.path);return <button key={item.path} className={active?'is-active':''} onClick={()=>navigate(item.path)}><Icon/><span>{item.label}</span></button>;})}</nav>
    <section className="admin-new-content">{children}</section>
  </main>,document.body);
}
