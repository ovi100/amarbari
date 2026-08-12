import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Banknote, Download, FileImage, Plus, Receipt } from 'lucide-react';
import { PageHeader } from '@/components/StatCard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PaymentBadge } from '@/components/ui/badge';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { Alert, EmptyState, LoadingState } from '@/components/ui/feedback';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { adminApi, invoiceApi } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { MONTH_NAMES, formatDate, formatMoney, monthLabel } from '@/lib/utils';
import { toast } from '@/store/toast.store';
import { InvoiceValues, invoiceSchema } from '@/lib/schemas';
import type { Invoice } from '@/types';

const now = new Date();

export default function InvoicesPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);

  const invoices = useQuery({
    queryKey: ['admin', 'invoices', page],
    queryFn: () => invoiceApi.list(page, 20),
  });
  const flats = useQuery({ queryKey: ['admin', 'flats'], queryFn: adminApi.flats });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InvoiceValues>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      flatId: '',
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      electricityBill: 0,
      waterBill: 0,
      internetBill: 0,
      utilityBill: 0,
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin'] });

  const create = useMutation({
    mutationFn: (values: InvoiceValues) =>
      invoiceApi.create({ ...values, flatRent: values.flatRent || undefined }),
    onSuccess: () => {
      toast.success('Invoice generated', 'Any carried-over due was folded in automatically.');
      setCreateOpen(false);
      reset();
      invalidate();
    },
    onError: (err) => toast.error('Could not generate the invoice', errorMessage(err)),
  });

  const pay = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) => invoiceApi.pay(id, amount),
    onSuccess: (invoice) => {
      toast.success('Payment recorded', `Invoice is now ${invoice.paymentStatus.replace(/_/g, ' ')}`);
      setPaying(null);
      setPayAmount('');
      invalidate();
    },
    onError: (err) => toast.error('Could not record the payment', errorMessage(err)),
  });

  const download = async (invoice: Invoice, format: 'pdf' | 'jpg') => {
    const label = monthLabel(invoice.month, invoice.year).replace(' ', '-');
    setDownloading(`${invoice.id}-${format}`);
    try {
      await invoiceApi.download(invoice.id, format, label);
      toast.success(`${format.toUpperCase()} downloaded`);
    } catch (err) {
      toast.error('Download failed', errorMessage(err));
    } finally {
      setDownloading(null);
    }
  };

  const rows = invoices.data?.invoices ?? [];
  const pagination = invoices.data?.pagination;

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Generate monthly bills and issue signed PDF or JPG receipts."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Generate invoice
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-5">
          {invoices.isLoading ? (
            <LoadingState label="Loading invoices…" />
          ) : invoices.isError ? (
            <Alert tone="error" title="Could not load invoices">
              {errorMessage(invoices.error)}
            </Alert>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No invoices yet"
              description="Generate the first monthly invoice for an occupied flat."
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead>Flat</TableHead>
                    <TableHead>Tenant</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Settled</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {monthLabel(invoice.month, invoice.year)}
                        <p className="text-xs font-normal text-muted-foreground">
                          Due {formatDate(invoice.dueDate)}
                        </p>
                      </TableCell>
                      <TableCell>{invoice.flat?.flatNumber ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {invoice.flat?.tenancies?.[0]?.user.fullName ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(invoice.totalAmount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(invoice.paidAmount + invoice.advanceDeducted)}
                        {invoice.advanceDeducted > 0 && (
                          <p className="text-xs font-normal text-muted-foreground">
                            incl. {formatMoney(invoice.advanceDeducted)} advance
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(invoice.outstanding ?? 0)}
                      </TableCell>
                      <TableCell>
                        <PaymentBadge status={invoice.paymentStatus} />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {(invoice.outstanding ?? 0) > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setPaying(invoice);
                                setPayAmount(String(invoice.outstanding ?? 0));
                              }}
                            >
                              <Banknote className="h-3.5 w-3.5" /> Pay
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={downloading === `${invoice.id}-pdf`}
                            onClick={() => download(invoice, 'pdf')}
                            aria-label="Download PDF invoice"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={downloading === `${invoice.id}-jpg`}
                            onClick={() => download(invoice, 'jpg')}
                            aria-label="Download JPG receipt"
                          >
                            <FileImage className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {pagination && pagination.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Page {pagination.page} of {pagination.totalPages} · {pagination.total} invoices
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= pagination.totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate an invoice</DialogTitle>
            <DialogDescription>
              Flat rent defaults to the unit&rsquo;s base rent, and any carried-over due is added
              automatically as &ldquo;previous due&rdquo;.
            </DialogDescription>
          </DialogHeader>

          <form
            id="invoice-form"
            onSubmit={handleSubmit((values) => create.mutate(values))}
            noValidate
            className="space-y-4"
          >
            <Field label="Flat" htmlFor="flatId" error={errors.flatId?.message} required>
              <Select id="flatId" {...register('flatId')}>
                <option value="">Choose a flat…</option>
                {(flats.data ?? []).map((flat) => (
                  <option key={flat.id} value={flat.id}>
                    {flat.flatNumber} · {formatMoney(flat.baseRent)}
                    {flat.isOccupied ? '' : ' (vacant)'}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Month" htmlFor="month" error={errors.month?.message} required>
                <Select id="month" {...register('month')}>
                  {MONTH_NAMES.map((name, index) => (
                    <option key={name} value={index + 1}>
                      {name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Year" htmlFor="year" error={errors.year?.message} required>
                <Input id="year" type="number" {...register('year')} />
              </Field>
            </div>

            <Field
              label="Flat rent override"
              htmlFor="flatRent"
              error={errors.flatRent?.message}
              hint="Leave empty to use the flat's base rent"
            >
              <Input id="flatRent" type="number" min={0} step="0.01" {...register('flatRent')} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Electricity" htmlFor="electricityBill" error={errors.electricityBill?.message}>
                <Input id="electricityBill" type="number" min={0} step="0.01" {...register('electricityBill')} />
              </Field>
              <Field label="Water" htmlFor="waterBill" error={errors.waterBill?.message}>
                <Input id="waterBill" type="number" min={0} step="0.01" {...register('waterBill')} />
              </Field>
              <Field label="Internet" htmlFor="internetBill" error={errors.internetBill?.message}>
                <Input id="internetBill" type="number" min={0} step="0.01" {...register('internetBill')} />
              </Field>
              <Field label="Utility & service" htmlFor="utilityBill" error={errors.utilityBill?.message}>
                <Input id="utilityBill" type="number" min={0} step="0.01" {...register('utilityBill')} />
              </Field>
            </div>
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="invoice-form" loading={create.isPending}>
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(paying)} onOpenChange={(open) => !open && setPaying(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>
              {paying &&
                `${monthLabel(paying.month, paying.year)} · flat ${paying.flat?.flatNumber ?? ''} · ${formatMoney(
                  paying.outstanding ?? 0
                )} outstanding`}
            </DialogDescription>
          </DialogHeader>

          <Field label="Amount received" htmlFor="payAmount">
            <Input
              id="payAmount"
              type="number"
              min={0}
              step="0.01"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
            />
          </Field>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPaying(null)}>
              Cancel
            </Button>
            <Button
              loading={pay.isPending}
              disabled={!payAmount || Number(payAmount) <= 0}
              onClick={() => paying && pay.mutate({ id: paying.id, amount: Number(payAmount) })}
            >
              Record payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
