import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { RedirectIfAuthenticated, RequireAuth, RequireRole } from './guards';
import { LoadingState } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/store/auth.store';

// Auth screens load eagerly — they are the cold-start entry point.
import LoginPage from '@/pages/auth/LoginPage';
import RegisterPage from '@/pages/auth/RegisterPage';
import VerifyOtpPage from '@/pages/auth/VerifyOtpPage';

const TenantDashboard = lazy(() => import('@/pages/tenant/TenantDashboard'));
const RentPage = lazy(() => import('@/pages/tenant/RentPage'));
const IssuesPage = lazy(() => import('@/pages/tenant/IssuesPage'));
const TenantChatPage = lazy(() => import('@/pages/tenant/TenantChatPage'));
const ProfilePage = lazy(() => import('@/pages/tenant/ProfilePage'));

const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'));
const TenantsPage = lazy(() => import('@/pages/admin/TenantsPage'));
const FlatsPage = lazy(() => import('@/pages/admin/FlatsPage'));
const InvoicesPage = lazy(() => import('@/pages/admin/InvoicesPage'));
const ExpensesPage = lazy(() => import('@/pages/admin/ExpensesPage'));
const AdminTicketsPage = lazy(() => import('@/pages/admin/AdminTicketsPage'));
const AdminChatPage = lazy(() => import('@/pages/admin/AdminChatPage'));
const DataControlPage = lazy(() => import('@/pages/admin/DataControlPage'));

function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-5xl font-semibold text-muted-foreground">404</p>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          The page you were looking for does not exist.
        </p>
      </div>
      <Button asChild>
        <Link to="/">Go home</Link>
      </Button>
    </div>
  );
}

export function AppRoutes() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Routes>
        <Route element={<RedirectIfAuthenticated />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>
        {/* Reachable while signed out mid-registration. */}
        <Route path="/verify" element={<VerifyOtpPage />} />

        <Route element={<RequireAuth />}>
          <Route element={<RequireRole role="TENANT" />}>
            <Route path="/app" element={<AppLayout variant="tenant" />}>
              <Route index element={<TenantDashboard />} />
              <Route path="rent" element={<RentPage />} />
              <Route path="issues" element={<IssuesPage />} />
              <Route path="chat" element={<TenantChatPage />} />
              <Route path="profile" element={<ProfilePage />} />
            </Route>
          </Route>

          <Route element={<RequireRole role="ADMIN" />}>
            <Route path="/admin" element={<AppLayout variant="admin" />}>
              <Route index element={<AdminDashboard />} />
              <Route path="tenants" element={<TenantsPage />} />
              <Route path="flats" element={<FlatsPage />} />
              <Route path="invoices" element={<InvoicesPage />} />
              <Route path="expenses" element={<ExpensesPage />} />
              <Route path="tickets" element={<AdminTicketsPage />} />
              <Route path="chat" element={<AdminChatPage />} />
              <Route path="data" element={<DataControlPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="/" element={<HomeRedirect />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

/** Sends each role to its own landing page. */
function HomeRedirect() {
  const user = useAuthStore((s) => s.user);
  const isBootstrapping = useAuthStore((s) => s.isBootstrapping);

  if (isBootstrapping) return <LoadingState />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'ADMIN' ? '/admin' : '/app'} replace />;
}
