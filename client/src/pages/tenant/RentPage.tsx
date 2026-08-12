import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileImage, PiggyBank, CalendarArrowUp } from 'lucide-react';
import { PageHeader, StatCard } from '@/components/StatCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, LoadingState } from '@/components/ui/feedback';
import { PaymentBadge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { invoiceApi, rentApi } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { formatMoney, monthLabel } from '@/lib/utils';
import { toast } from '@/store/toast.store';
import type { DeferralMode } from '@/types';

export default function RentPage() {
  const queryClient = useQueryClient();
  const [deferOpen, setDeferOpen] = useState(false);
  const [mode, setMode] = useState<DeferralMode>('DEDUCT_FROM_ADVANCE');
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['rent', 'summary'],
    queryFn: rentApi.summary,
    retry: 1,
  });

  const defer = useMutation({
    mutationFn: () => rentApi.requestDue(mode),
    onSuccess: (result) => {
      toast.success('Rent deferral applied', result.message);
      setDeferOpen(false);
      queryClient.invalidateQueries({ queryKey: ['rent'] });
    },
    onError: (err) => toast.error('Could not defer this bill', errorMessage(err)),
  });

  const download = async (id: string, format: 'pdf' | 'jpg', label: string) => {
    setDownloading(`${id}-${format}`);
    try {
      await invoiceApi.download(id, format, label);
      toast.success(`${format.toUpperCase()} downloaded`);
    } catch (err) {
      toast.error(`Could not download the ${format.toUpperCase()}`, errorMessage(err));
    } finally {
      setDownloading(null);
    }
  };

  if (isLoading) return <LoadingState label="Loading your rent…" />;

  if (isError) {
    return (
      <>
        <PageHeader title="Rent & bills" />
        <Alert tone="warning" title="No active tenancy">
          {errorMessage(error)}
        </Alert>
      </>
    );
  }

  const { tenancy, currentInvoice, invoices, annualBreakdown, totals } = data!;
  const canDefer = Boolean(currentInvoice && currentInvoice.outstanding > 0);
  const projected =
    currentInvoice && mode === 'DEDUCT_FROM_ADVANCE'
      ? {
          deducted: Math.min(tenancy.advanceDeposit, currentInvoice.outstanding),
          carried: Math.max(0, currentInvoice.outstanding - tenancy.advanceDeposit),
        }
      : { deducted: 0, carried: currentInvoice?.outstanding ?? 0 };

  return (
    <>
      <PageHeader
        title="Rent & bills"
        description={`In this flat for ${tenancy.duration.label}`}
        actions={
          <Button onClick={() => setDeferOpen(true)} disabled={!canDefer} variant="outline">
            <CalendarArrowUp className="h-4 w-4" /> Defer this month
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total billed" value={formatMoney(totals.totalBilled)} />
        <StatCard label="Total settled" value={formatMoney(totals.totalPaid)} tone="success" />
        <StatCard
          label="Outstanding"
          value={formatMoney(totals.totalOutstanding)}
          tone={totals.totalOutstanding > 0 ? 'destructive' : 'success'}
        />
        <StatCard
          label="Advance deposit"
          value={formatMoney(totals.advanceDeposit)}
          hint={
            totals.accumulatedDue > 0
              ? `${formatMoney(totals.accumulatedDue)} due carried forward`
              : undefined
          }
          icon={PiggyBank}
        />
      </div>

      {totals.accumulatedDue > 0 && (
        <Alert tone="warning" className="mt-6" title="You have a balance carried forward">
          {formatMoney(totals.accumulatedDue)} will be added to your next invoice as
          &ldquo;previous due&rdquo;.
        </Alert>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Invoice history</CardTitle>
            <CardDescription>Every invoice issued during your tenancy</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Receipt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.length === 0 ? (
                  <TableEmpty colSpan={5}>No invoices have been issued yet.</TableEmpty>
                ) : (
                  invoices.map((invoice) => {
                    const label = `${monthLabel(invoice.month, invoice.year)}`;
                    return (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-medium">{label}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(invoice.totalAmount)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(invoice.outstanding)}
                        </TableCell>
                        <TableCell>
                          <PaymentBadge status={invoice.paymentStatus} />
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              loading={downloading === `${invoice.id}-pdf`}
                              onClick={() => download(invoice.id, 'pdf', label.replace(' ', '-'))}
                              aria-label={`Download ${label} invoice as PDF`}
                            >
                              <Download className="h-3.5 w-3.5" /> PDF
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              loading={downloading === `${invoice.id}-jpg`}
                              onClick={() => download(invoice.id, 'jpg', label.replace(' ', '-'))}
                              aria-label={`Download ${label} receipt as JPG`}
                            >
                              <FileImage className="h-3.5 w-3.5" /> JPG
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Yearly summary</CardTitle>
            <CardDescription>Billed versus settled per year</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {annualBreakdown.length === 0 ? (
              <EmptyState title="Nothing to summarise yet" />
            ) : (
              annualBreakdown.map((row) => (
                <div key={row.year} className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <p className="font-medium">{row.year}</p>
                    <p className="text-sm tabular-nums text-muted-foreground">
                      {formatMoney(row.paid)} / {formatMoney(row.billed)}
                    </p>
                  </div>
                  <div
                    className="h-2 overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label={`${row.year}: ${formatMoney(row.paid)} settled of ${formatMoney(row.billed)} billed`}
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${row.billed === 0 ? 0 : Math.min(100, (row.paid / row.billed) * 100)}%`,
                      }}
                    />
                  </div>
                  {row.due > 0 && (
                    <p className="text-xs text-destructive">{formatMoney(row.due)} outstanding</p>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={deferOpen} onOpenChange={setDeferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Defer this month&rsquo;s rent</DialogTitle>
            <DialogDescription>
              {currentInvoice
                ? `${formatMoney(currentInvoice.outstanding)} is outstanding for ${monthLabel(
                    currentInvoice.month,
                    currentInvoice.year
                  )}.`
                : 'No current invoice.'}
            </DialogDescription>
          </DialogHeader>

          <fieldset className="space-y-3">
            <legend className="sr-only">How should the balance be settled?</legend>
            {(
              [
                {
                  value: 'DEDUCT_FROM_ADVANCE' as const,
                  title: 'Deduct from my advance deposit',
                  body: `You have ${formatMoney(tenancy.advanceDeposit)} on deposit. Anything the deposit cannot cover rolls into next month.`,
                },
                {
                  value: 'ROLLOVER' as const,
                  title: 'Roll the whole balance to next month',
                  body: 'Your advance deposit stays untouched; the full amount appears as "previous due" on the next invoice.',
                },
              ] satisfies { value: DeferralMode; title: string; body: string }[]
            ).map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors ${
                  mode === option.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                }`}
              >
                <input
                  type="radio"
                  name="deferral-mode"
                  value={option.value}
                  checked={mode === option.value}
                  onChange={() => setMode(option.value)}
                  className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">{option.title}</span>
                  <span className="block text-xs text-muted-foreground">{option.body}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {currentInvoice && (
            <div className="rounded-md bg-muted p-3 text-sm" aria-live="polite">
              <p className="mb-1 font-medium">What will happen</p>
              <ul className="space-y-0.5 text-muted-foreground">
                <li>Deducted from advance: {formatMoney(projected.deducted)}</li>
                <li>Carried to next month: {formatMoney(projected.carried)}</li>
                <li>
                  Advance remaining: {formatMoney(tenancy.advanceDeposit - projected.deducted)}
                </li>
              </ul>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeferOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => defer.mutate()} loading={defer.isPending}>
              Confirm deferral
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
