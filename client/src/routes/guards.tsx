import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { LoadingState } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import type { Role } from '@/types';

/** Blocks rendering until the silent refresh has settled. */
function useSession() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const isBootstrapping = useAuthStore((s) => s.isBootstrapping);
  return { user, isBootstrapping, isAuthenticated: Boolean(user && accessToken) };
}

export function RequireAuth() {
  const { isAuthenticated, isBootstrapping } = useSession();
  const location = useLocation();

  if (isBootstrapping) return <LoadingState label="Restoring your session…" />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Outlet />;
}

export function RequireRole({ role }: { role: Role }) {
  const { user, isAuthenticated, isBootstrapping } = useSession();
  const location = useLocation();

  if (isBootstrapping) return <LoadingState label="Checking permissions…" />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  if (user?.role !== role) return <Unauthorized />;
  return <Outlet />;
}

/** Signed-in users should never see the login/register screens. */
export function RedirectIfAuthenticated() {
  const { user, isAuthenticated, isBootstrapping } = useSession();

  if (isBootstrapping) return <LoadingState label="Loading…" />;
  if (isAuthenticated) {
    return <Navigate to={user?.role === 'ADMIN' ? '/admin' : '/app'} replace />;
  }
  return <Outlet />;
}

export function Unauthorized() {
  const user = useAuthStore((s) => s.user);
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="rounded-full bg-destructive/10 p-4">
        <ShieldAlert className="h-8 w-8 text-destructive" />
      </div>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Access denied</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          This area is restricted to property administrators. Your account is signed in as a
          tenant, so there is nothing for you here.
        </p>
      </div>
      <Button asChild>
        <a href={user?.role === 'ADMIN' ? '/admin' : '/app'}>Back to my dashboard</a>
      </Button>
    </div>
  );
}
