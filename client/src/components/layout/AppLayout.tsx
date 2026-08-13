import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Building2,
  ClipboardList,
  Database,
  Gauge,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Monitor,
  Moon,
  Receipt,
  Store,
  Sun,
  Users,
  Wallet,
  Wrench,
  X,
} from 'lucide-react';
import { cn, initials } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useUiStore } from '@/store/ui.store';
import { useSocket } from '@/hooks/useSocket';
import { Button } from '@/components/ui/button';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
}

const TENANT_NAV: NavItem[] = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/app/rent', label: 'Rent & Bills', icon: Wallet },
  { to: '/app/meters', label: 'Meters', icon: Gauge },
  { to: '/app/issues', label: 'Report an Issue', icon: Wrench },
  { to: '/app/chat', label: 'Chat with Admin', icon: MessageSquare },
  { to: '/app/profile', label: 'My Profile', icon: Users },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/flats', label: 'Flats', icon: Building2 },
  { to: '/admin/shops', label: 'Shops', icon: Store },
  { to: '/admin/meters', label: 'Meters', icon: Gauge },
  { to: '/admin/invoices', label: 'Invoices', icon: Receipt },
  { to: '/admin/expenses', label: 'Expenses', icon: ClipboardList },
  { to: '/admin/tickets', label: 'Maintenance', icon: Wrench },
  { to: '/admin/chat', label: 'Messages', icon: MessageSquare },
  { to: '/admin/activity', label: 'Activity Log', icon: History },
  { to: '/admin/data', label: 'Data Control', icon: Database },
];

function ThemeToggle() {
  const { theme, setTheme } = useUiStore();
  const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next)}
      aria-label={`Theme: ${theme}. Switch to ${next}.`}
      title={`Theme: ${theme}`}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}

function ConnectionPill() {
  const { status } = useSocket();
  if (status === 'connected' || status === 'idle') return null;

  const label =
    status === 'connecting'
      ? 'Connecting…'
      : status === 'reconnecting'
        ? 'Reconnecting…'
        : 'Live updates offline';

  return (
    <span
      role="status"
      className="hidden rounded-full bg-warning/20 px-3 py-1 text-xs font-medium text-warning-foreground sm:inline"
    >
      {label}
    </span>
  );
}

export function AppLayout({ variant }: { variant: 'tenant' | 'admin' }) {
  const { user, logout } = useAuth();
  const { sidebarOpen, setSidebarOpen } = useUiStore();
  const location = useLocation();
  const nav = variant === 'admin' ? ADMIN_NAV : TENANT_NAV;

  // The drawer must never survive a navigation on mobile.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname, setSidebarOpen]);

  // Escape closes the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSidebarOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSidebarOpen]);

  const navLinks = (
    <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Main">
      {nav.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )
          }
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-2.5 border-b px-5 py-4">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Building2 className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate font-semibold leading-tight">AmarBari</p>
        <p className="font-bangla truncate text-xs text-muted-foreground" lang="bn">
          আমার বাড়ি
        </p>
      </div>
    </div>
  );

  const footer = (
    <div className="border-t p-3">
      <div className="mb-2 flex items-center gap-3 rounded-md px-2 py-2">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
          {initials(user?.fullName ?? '?')}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user?.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {variant === 'admin' ? 'Property Admin' : user?.tenancy?.flat?.flatNumber ?? 'Resident'}
          </p>
        </div>
      </div>
      <Button variant="ghost" className="w-full justify-start gap-3" onClick={logout}>
        <LogOut className="h-4 w-4" />
        Sign out
      </Button>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-card lg:flex">
        {brand}
        {navLinks}
        {footer}
      </aside>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
          <aside
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] animate-fade-in flex-col border-r bg-card shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <div className="flex items-center justify-between border-b pr-2">
              <div className="flex-1">{brand}</div>
              <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} aria-label="Close navigation">
                <X className="h-5 w-5" />
              </Button>
            </div>
            {navLinks}
            {footer}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/75">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <p className="truncate font-semibold lg:hidden">AmarBari</p>
          <div className="ml-auto flex items-center gap-2">
            <ConnectionPill />
            <ThemeToggle />
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
