import { Building2 } from 'lucide-react';

export function AuthShell({
  title,
  subtitle,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/40">
      <header className="flex items-center gap-2.5 px-5 py-4">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Building2 className="h-5 w-5" />
        </div>
        <div>
          <p className="font-semibold leading-tight">AmarBari</p>
          <p className="font-bangla text-xs text-muted-foreground" lang="bn">
            আমার বাড়ি
          </p>
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-12 pt-2 sm:items-center sm:pt-0">
        <div className={wide ? 'w-full max-w-3xl' : 'w-full max-w-md'}>
          <div className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
            <div className="mb-6 space-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
            </div>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
