import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Toast, useToastStore } from '@/store/toast.store';

const TONE = {
  info: { Icon: Info, className: 'border-primary/30 text-primary' },
  success: { Icon: CheckCircle2, className: 'border-success/40 text-success' },
  warning: { Icon: AlertCircle, className: 'border-warning/50 text-warning' },
  error: { Icon: XCircle, className: 'border-destructive/40 text-destructive' },
} as const;

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const { Icon, className } = TONE[toast.tone];

  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, dismiss]);

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto flex w-full animate-fade-in items-start gap-3 rounded-lg border bg-card p-4 shadow-lg"
    >
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', className.split(' ').pop())} aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-semibold">{toast.title}</p>
        {toast.description && (
          <p className="break-words text-sm text-muted-foreground">{toast.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:w-96"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
