import { Link, NavLink } from 'react-router-dom';
import { Bell, BriefcaseBusiness, FileText, Headphones, LayoutDashboard, LogOut, Phone, PhoneCall, Search, Settings, ShieldCheck, Users, Volume2 } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

const navigation = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/users', label: 'Usuarios', icon: Users },
  { to: '/roles', label: 'Roles', icon: ShieldCheck },
  { to: '/contacts', label: 'Contactos', icon: BriefcaseBusiness },
  { to: '/softphone', label: 'Softphone', icon: PhoneCall },
  { to: '/calls', label: 'Llamadas', icon: Phone },
  { to: '/recordings', label: 'Grabaciones', icon: Volume2 },
  { to: '/supervision', label: 'Supervisión', icon: Headphones },
  { to: '/reports', label: 'Reportes', icon: FileText },
  { to: '/settings', label: 'Configuración', icon: Settings },
];

export function AppLayout({ children }) {
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);
  const visibleNavigation = user?.roleName === 'ADMIN'
    ? navigation
    : navigation.filter((item) => item.to !== '/roles');

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="sidebar w-72 border-r border-slate-800 px-5 py-6">
        <div className="mb-8 flex items-center gap-3 px-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/20 text-brand-300">C</div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.35em] text-slate-400">Sistema</p>
            <h1 className="text-xl font-bold text-white">CallManagerAI</h1>
          </div>
        </div>

        <nav className="space-y-2">
          {visibleNavigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                  isActive ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex-1">
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-6 py-4 backdrop-blur">
          <div>
            <p className="text-[10px] uppercase tracking-[0.32em] text-brand-300">Operaciones</p>
            <h2 className="text-lg font-semibold text-white">Centro de control</h2>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex w-full max-w-md items-center gap-3 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2">
              <Search size={18} className="text-slate-400" />
              <input className="w-full bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none" placeholder="Buscar en el sistema..." />
            </div>
            <button className="rounded-xl border border-slate-800 bg-slate-900 p-2.5 text-slate-300 hover:text-white">
              <Bell size={18} />
            </button>
            <button
              onClick={logout}
              className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:text-white"
            >
              <LogOut size={16} />
              Cerrar sesión
            </button>
          </div>
        </header>

        <main className="p-6">
          <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div>
              <p className="text-sm text-slate-400">Usuario activo</p>
              <p className="text-lg font-semibold text-white">{user?.name || 'Administrador'}</p>
            </div>
            <Link to="/settings" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:text-white">
              Ajustes
            </Link>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
