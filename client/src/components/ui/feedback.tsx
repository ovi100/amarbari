import * as React from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-muted-foreground', className)} />;
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 py-12"
    >
      <Spinner className="h-6 w-6" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

const ALERT_STYLES = {
  info: { wrap: 'border-primary/30 bg-primary/5 text-foreground', Icon: Info, tone: 'text-primary' },
  success: {
    wrap: 'border-success/30 bg-success/5 text-foreground',
    Icon: CheckCircle2,
    tone: 'text-success',
  },
  warning: {
    wrap: 'border-warning/40 bg-warning/10 text-foreground',
    Icon: AlertCircle,
    tone: 'text-warning',
  },
  error: {
    wrap: 'border-destructive/30 bg-destructive/5 text-foreground',
    Icon: XCircle,
    tone: 'text-destructive',
  },
} as const;

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: keyof typeof ALERT_STYLES;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const { wrap, Icon, tone: iconTone } = ALERT_STYLES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-md border p-4 text-sm', wrap, className)}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', iconTone)} aria-hidden />
      <div className="space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center">
      {Icon && <Icon className="h-9 w-9 text-muted-foreground/60" />}
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
