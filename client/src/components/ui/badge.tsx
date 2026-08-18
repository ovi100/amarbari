import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import type { PaymentStatus, TicketStatus } from '@/types';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/10 text-primary',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive/15 text-destructive',
        success: 'border-transparent bg-success/15 text-success',
        warning: 'border-transparent bg-warning/25 text-warning-foreground',
        outline: 'text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
  VariantProps<typeof badgeVariants> { }

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

const PAYMENT_VARIANT: Record<PaymentStatus, BadgeProps['variant']> = {
  PAID: 'success',
  DUE: 'destructive',
  PARTIAL: 'warning',
  DEDUCTED_FROM_ADVANCE: 'default',
};

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  PAID: 'Paid',
  DUE: 'Due',
  PARTIAL: 'Partial',
  DEDUCTED_FROM_ADVANCE: 'From advance',
};

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return <Badge variant={PAYMENT_VARIANT[status]}>{PAYMENT_LABEL[status]}</Badge>;
}

const TICKET_VARIANT: Record<TicketStatus, BadgeProps['variant']> = {
  PENDING: 'warning',
  IN_PROGRESS: 'default',
  RESOLVED: 'success',
  REJECTED: 'destructive',
};

const TICKET_LABEL: Record<TicketStatus, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  REJECTED: 'Rejected',
};

export function TicketBadge({ status }: { status: TicketStatus }) {
  return <Badge variant={TICKET_VARIANT[status]}>{TICKET_LABEL[status]}</Badge>;
}

export { badgeVariants };
