import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Banknote, Download, Eye, FileImage, Pencil, Plus } from 'lucide-react';
import { PageHeader } from '@/components/StatCard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PaymentBadge } from '@/components/ui/badge';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { Alert } from '@/components/ui/feedback';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { adminApi, invoiceApi } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { MONTH_NAMES, formatDate, formatMoney, humanise, monthLabel } from '@/lib/utils';
import { toast } from '@/store/toast.store';
import {
  InvoiceEditValues,
  InvoiceValues,
  buildPaymentSchema,
  invoiceEditSchema,
  invoiceSchema,
} from '@/lib/schemas';
import type { Invoice } from '@/types';

const now = new Date();

/** Default due date: the 10th of the billed month, matching the server. */
const defaultDueDate = (month: number, year: number) =>
  `${year}-${String(month).padStart(2, '0')}-10`;

const tenantOf = (invoice: Invoice) => invoice.flat?.tenancies?.[0]?.user.fullName ?? null;

/** The line items shared by the detail view and the edit form. */
const LINE_ITEMS = [
  { key: 'flatRent', label: 'Flat rent' },
  { key: 'electricityBill', label: 'Electricity' },
  { key: 'waterBill', label: 'Water' },
  { key: 'internetBill', label: 'Internet' },
  { key: 'utilityBill', label: 'Utility & service' },
  { key: 'previousDue', label: 'Previous due carried over' },
] as const;

export default function InvoicesPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [viewing, setViewing] = useState<Invoice | null>(null);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payError, setPayError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const invoices = useQuery({
    queryKey: ['admin', 'invoices'],
    queryFn: () => invoiceApi.list(),
  });
  const flats = useQuery({ queryKey: ['admin', 'flats'], queryFn: () => adminApi.flats() });

  // An invoice needs somebody to bill, so only occupied flats are offered.
  const billableFlats = (flats.data ?? []).filter((flat) => flat.isOccupied);
  const vacantCount = (flats.data ?? []).length - billableFlats.length;

  const createForm = useForm<InvoiceValues>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      flatId: '',
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      flatRent: 0,
      electricityBill: 0,
      waterBill: 0,
      internetBill: 0,
      utilityBill: 0,
      dueDate: defaultDueDate(now.getMonth() + 1, now.getFullYear()),
    },
  });

  const editForm = useForm<InvoiceEditValues>({ resolver: zodResolver(invoiceEditSchema) });

  // Picking a flat prefills its base rent and the month prefills the due date,
  // so "state every charge" does not mean "retype what the system knows".
  const selectedFlatId = createForm.watch('flatId');
  const selectedMonth = createForm.watch('month');
  const selectedYear = createForm.watch('year');

  useEffect(() => {
    const flat = billableFlats.find((f) => f.id === selectedFlatId);
    if (flat) createForm.setValue('flatRent', flat.baseRent, { shouldValidate: true });
    // billableFlats is derived from a query result and is stable enough here;
    // re-running on every fetch would clobber a manual override.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFlatId]);

  useEffect(() => {
    const month = Number(selectedMonth);
    const year = Number(selectedYear);
    if (month >= 1 && month <= 12 && year > 2000) {
      createForm.setValue('dueDate', defaultDueDate(month, year));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, selectedYear]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin'] });

  const create = useMutation({
    mutationFn: (values: InvoiceValues) => invoiceApi.create(values),
    onSuccess: () => {
      toast.success('Invoice generated', 'Any carried-over due was folded in automatically.');
      setCreateOpen(false);
      createForm.reset();
      invalidate();
    },
    onError: (err) => toast.error('Could not generate the invoice', errorMessage(err)),
  });

  const update = useMutation({
    mutationFn: (values: InvoiceEditValues) => invoiceApi.update(editing!.id, values),
    onSuccess: (invoice) => {
      toast.success('Invoice updated', `New total ${formatMoney(invoice.totalAmount)}.`);
      setEditing(null);
      invalidate();
    },
    onError: (err) => toast.error('Could not update the invoice', errorMessage(err)),
  });

  const pay = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) => invoiceApi.pay(id, amount),
    onSuccess: (invoice) => {
      toast.success('Payment recorded', `Invoice is now ${humanise(invoice.paymentStatus)}`);
      setPaying(null);
      setPayAmount('');
      invalidate();
    },
    onError: (err) => toast.error('Could not record the payment', errorMessage(err)),
  });

  /**
   * The payment field is a single input rather than a form, but it still gets
   * a real schema: overpaying an invoice silently creates a credit the ledger
   * has nowhere to put.
   */
  const submitPayment = () => {
    if (!paying) return;
    const result = buildPaymentSchema(paying.outstanding ?? 0).safeParse({ amount: payAmount });
    if (!result.success) {
      setPayError(result.error.issues[0]!.message);
      return;
    }
    setPayError(null);
    pay.mutate({ id: paying.id, amount: result.data.amount });
  };

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

  const openEdit = (invoice: Invoice) => {
    editForm.reset({
      flatRent: invoice.flatRent,
      electricityBill: invoice.electricityBill,
      waterBill: invoice.waterBill,
      internetBill: invoice.internetBill,
      utilityBill: invoice.utilityBill,
      previousDue: invoice.previousDue,
      dueDate: invoice.dueDate.slice(0, 10),
    });
    setEditing(invoice);
  };

  const rows = invoices.data?.invoices ?? [];

  const columns = useMemo<DataTableColumn<Invoice>[]>(
    () => [
      {
        id: 'period',
        header: 'Period',
        sortValue: (invoice) => invoice.year * 100 + invoice.month,
        exportValue: (invoice) => monthLabel(invoice.month, invoice.year),
        cell: (invoice) => (
          <div className="whitespace-nowrap font-medium">
            {monthLabel(invoice.month, invoice.year)}
            <p className="text-xs font-normal text-muted-foreground">
              Due {formatDate(invoice.dueDate)}
            </p>
          </div>
        ),
      },
      {
        id: 'flat',
        header: 'Flat',
        sortValue: (invoice) => invoice.flat?.flatNumber ?? null,
        cell: (invoice) => invoice.flat?.flatNumber ?? '—',
      },
      {
        id: 'user',
        header: 'User',
        sortValue: tenantOf,
        cell: (invoice) => <span className="text-muted-foreground">{tenantOf(invoice) ?? '—'}</span>,
      },
      {
        id: 'total',
        header: 'Total',
        align: 'right',
        sortValue: (invoice) => invoice.totalAmount,
        cell: (invoice) => <span className="tabular-nums">{formatMoney(invoice.totalAmount)}</span>,
      },
      {
        id: 'settled',
        header: 'Settled',
        align: 'right',
        sortValue: (invoice) => invoice.paidAmount + invoice.advanceDeducted,
        cell: (invoice) => (
          <span className="tabular-nums">
            {formatMoney(invoice.paidAmount + invoice.advanceDeducted)}
            {invoice.advanceDeducted > 0 && (
              <p className="text-xs font-normal text-muted-foreground">
                incl. {formatMoney(invoice.advanceDeducted)} advance
              </p>
            )}
          </span>
        ),
      },
      {
        id: 'outstanding',
        header: 'Outstanding',
        align: 'right',
        sortValue: (invoice) => invoice.outstanding ?? 0,
        cell: (invoice) => (
          <span className="tabular-nums">{formatMoney(invoice.outstanding ?? 0)}</span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        sortValue: (invoice) => invoice.paymentStatus,
        cell: (invoice) => <PaymentBadge status={invoice.paymentStatus} />,
      },
    ],
    []
  );

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
          {invoices.isError ? (
            <Alert tone="error" title="Could not load invoices">
              {errorMessage(invoices.error)}
            </Alert>
          ) : (
            <DataTable
              rows={rows}
              columns={columns}
              getRowId={(invoice) => invoice.id}
              isLoading={invoices.isLoading}
              exportFileName="AmarBari-Invoices"
              searchPlaceholder="Search by flat, user or period…"
              searchableText={(invoice) =>
                [
                  invoice.flat?.flatNumber ?? '',
                  invoice.flat?.building ?? '',
                  tenantOf(invoice) ?? '',
                  monthLabel(invoice.month, invoice.year),
                  invoice.paymentStatus,
                ].join(' ')
              }
              onServerSearch={async (query) => (await invoiceApi.list({ search: query })).invoices}
              emptyMessage="No invoices yet — generate the first monthly bill for an occupied flat."
              initialSort={{ columnId: 'period', direction: 'desc' }}
              actions={[
                { label: 'View details', icon: Eye, onSelect: setViewing },
                { label: 'Edit', icon: Pencil, onSelect: openEdit },
                {
                  label: 'Record payment',
                  icon: Banknote,
                  hidden: (invoice) => (invoice.outstanding ?? 0) <= 0,
                  onSelect: (invoice) => {
                    setPaying(invoice);
                    setPayAmount(String(invoice.outstanding ?? 0));
                  },
                },
                {
                  label: 'Download PDF invoice',
                  icon: Download,
                  disabled: (invoice) => downloading === `${invoice.id}-pdf`,
                  onSelect: (invoice) => download(invoice, 'pdf'),
                },
                {
                  label: 'Download JPG receipt',
                  icon: FileImage,
                  disabled: (invoice) => downloading === `${invoice.id}-jpg`,
                  onSelect: (invoice) => download(invoice, 'jpg'),
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      {/* Generate an invoice */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate an invoice</DialogTitle>
            <DialogDescription>
              Every charge has to be stated, so enter 0 where there is nothing to bill. Any
              carried-over due is added automatically as &ldquo;previous due&rdquo;.
            </DialogDescription>
          </DialogHeader>

          {billableFlats.length === 0 ? (
            <Alert tone="warning" title="No flat can be invoiced yet">
              An invoice needs a user to bill. Assign a user to a flat on the Flats page first.
            </Alert>
          ) : (
            <form
              id="invoice-form"
              onSubmit={createForm.handleSubmit((values) => create.mutate(values))}
              noValidate
              className="max-h-[60vh] space-y-4 overflow-y-auto pr-1"
            >
              <Field
                label="Flat"
                htmlFor="flatId"
                error={createForm.formState.errors.flatId?.message}
                required
                hint={
                  vacantCount > 0
                    ? `${vacantCount} vacant ${vacantCount === 1 ? 'flat is' : 'flats are'} hidden — a flat with no user assigned cannot be invoiced`
                    : undefined
                }
              >
                <Select id="flatId" {...createForm.register('flatId')}>
                  <option value="">Choose a flat…</option>
                  {billableFlats.map((flat) => (
                    <option key={flat.id} value={flat.id}>
                      {flat.flatNumber} · {flat.tenancies?.[0]?.user.fullName ?? 'occupied'} ·{' '}
                      {formatMoney(flat.baseRent)}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Month" htmlFor="month" error={createForm.formState.errors.month?.message} required>
                  <Select id="month" {...createForm.register('month')}>
                    {MONTH_NAMES.map((name, index) => (
                      <option key={name} value={index + 1}>
                        {name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Year" htmlFor="year" error={createForm.formState.errors.year?.message} required>
                  <Input id="year" type="number" {...createForm.register('year')} />
                </Field>
              </div>

              <Field
                label="Flat rent"
                htmlFor="flatRent"
                error={createForm.formState.errors.flatRent?.message}
                required
                hint="Prefilled from the flat's base rent — override it here if this month differs"
              >
                <Input id="flatRent" type="number" min={0} step="0.01" {...createForm.register('flatRent')} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Electricity"
                  htmlFor="electricityBill"
                  error={createForm.formState.errors.electricityBill?.message}
                  required
                >
                  <Input id="electricityBill" type="number" min={0} step="0.01" {...createForm.register('electricityBill')} />
                </Field>
                <Field label="Water" htmlFor="waterBill" error={createForm.formState.errors.waterBill?.message} required>
                  <Input id="waterBill" type="number" min={0} step="0.01" {...createForm.register('waterBill')} />
                </Field>
                <Field
                  label="Internet"
                  htmlFor="internetBill"
                  error={createForm.formState.errors.internetBill?.message}
                  required
                >
                  <Input id="internetBill" type="number" min={0} step="0.01" {...createForm.register('internetBill')} />
                </Field>
                <Field
                  label="Utility & service"
                  htmlFor="utilityBill"
                  error={createForm.formState.errors.utilityBill?.message}
                  required
                >
                  <Input id="utilityBill" type="number" min={0} step="0.01" {...createForm.register('utilityBill')} />
                </Field>
              </div>

              <Field label="Due date" htmlFor="dueDate" error={createForm.formState.errors.dueDate?.message} required>
                <Input id="dueDate" type="date" {...createForm.register('dueDate')} />
              </Field>
            </form>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="invoice-form"
              loading={create.isPending}
              disabled={billableFlats.length === 0}
            >
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invoice details */}
      <Dialog open={Boolean(viewing)} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {viewing && `${monthLabel(viewing.month, viewing.year)} · flat ${viewing.flat?.flatNumber ?? '—'}`}
            </DialogTitle>
            <DialogDescription>
              {viewing && (
                <>
                  Issued to {tenantOf(viewing) ?? 'an unassigned flat'} · due{' '}
                  {formatDate(viewing.dueDate)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {viewing && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3">
                <PaymentBadge status={viewing.paymentStatus} />
                <span className="text-sm text-muted-foreground">
                  {viewing.paidAt ? `Settled ${formatDate(viewing.paidAt)}` : 'Not fully settled'}
                </span>
              </div>

              <dl className="divide-y rounded-md border">
                {LINE_ITEMS.map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between px-3 py-2 text-sm">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="tabular-nums">{formatMoney(viewing[key])}</dd>
                  </div>
                ))}
                <div className="flex items-center justify-between bg-muted/40 px-3 py-2.5 text-sm font-semibold">
                  <dt>Total billed</dt>
                  <dd className="tabular-nums">{formatMoney(viewing.totalAmount)}</dd>
                </div>
                <div className="flex items-center justify-between px-3 py-2 text-sm">
                  <dt className="text-muted-foreground">Paid in cash</dt>
                  <dd className="tabular-nums">{formatMoney(viewing.paidAmount)}</dd>
                </div>
                <div className="flex items-center justify-between px-3 py-2 text-sm">
                  <dt className="text-muted-foreground">Deducted from advance</dt>
                  <dd className="tabular-nums">{formatMoney(viewing.advanceDeducted)}</dd>
                </div>
                <div className="flex items-center justify-between bg-muted/40 px-3 py-2.5 text-sm font-semibold">
                  <dt>Outstanding</dt>
                  <dd className="tabular-nums">{formatMoney(viewing.outstanding ?? 0)}</dd>
                </div>
              </dl>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  loading={downloading === `${viewing.id}-pdf`}
                  onClick={() => download(viewing, 'pdf')}
                >
                  <Download className="h-3.5 w-3.5" /> PDF invoice
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  loading={downloading === `${viewing.id}-jpg`}
                  onClick={() => download(viewing, 'jpg')}
                >
                  <FileImage className="h-3.5 w-3.5" /> JPG receipt
                </Button>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewing(null)}>
              Close
            </Button>
            <Button
              onClick={() => {
                if (!viewing) return;
                openEdit(viewing);
                setViewing(null);
              }}
            >
              <Pencil className="h-4 w-4" /> Edit invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit an invoice */}
      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing && `Edit ${monthLabel(editing.month, editing.year)} · flat ${editing.flat?.flatNumber ?? '—'}`}
            </DialogTitle>
            <DialogDescription>
              The total and payment status are recalculated from these lines and what has already
              been settled.
            </DialogDescription>
          </DialogHeader>

          <form
            id="invoice-edit-form"
            onSubmit={editForm.handleSubmit((values) => update.mutate(values))}
            noValidate
            className="max-h-[60vh] space-y-4 overflow-y-auto pr-1"
          >
            <Field
              label="Flat rent"
              htmlFor="edit-flatRent"
              error={editForm.formState.errors.flatRent?.message}
              required
            >
              <Input id="edit-flatRent" type="number" min={0} step="0.01" {...editForm.register('flatRent')} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Electricity"
                htmlFor="edit-electricityBill"
                error={editForm.formState.errors.electricityBill?.message}
                required
              >
                <Input id="edit-electricityBill" type="number" min={0} step="0.01" {...editForm.register('electricityBill')} />
              </Field>
              <Field label="Water" htmlFor="edit-waterBill" error={editForm.formState.errors.waterBill?.message} required>
                <Input id="edit-waterBill" type="number" min={0} step="0.01" {...editForm.register('waterBill')} />
              </Field>
              <Field
                label="Internet"
                htmlFor="edit-internetBill"
                error={editForm.formState.errors.internetBill?.message}
                required
              >
                <Input id="edit-internetBill" type="number" min={0} step="0.01" {...editForm.register('internetBill')} />
              </Field>
              <Field
                label="Utility & service"
                htmlFor="edit-utilityBill"
                error={editForm.formState.errors.utilityBill?.message}
                required
              >
                <Input id="edit-utilityBill" type="number" min={0} step="0.01" {...editForm.register('utilityBill')} />
              </Field>
            </div>

            <Field
              label="Previous due"
              htmlFor="edit-previousDue"
              error={editForm.formState.errors.previousDue?.message}
              required
              hint="Balance carried over from earlier months"
            >
              <Input id="edit-previousDue" type="number" min={0} step="0.01" {...editForm.register('previousDue')} />
            </Field>

            <Field label="Due date" htmlFor="edit-dueDate" error={editForm.formState.errors.dueDate?.message} required>
              <Input id="edit-dueDate" type="date" {...editForm.register('dueDate')} />
            </Field>
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" form="invoice-edit-form" loading={update.isPending}>
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record a payment */}
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

          <Field
            label="Amount received"
            htmlFor="payAmount"
            error={payError ?? undefined}
            required
            hint={paying ? `Up to ${formatMoney(paying.outstanding ?? 0)}` : undefined}
          >
            <Input
              id="payAmount"
              type="number"
              min={0}
              step="0.01"
              value={payAmount}
              aria-invalid={Boolean(payError)}
              onChange={(e) => {
                setPayAmount(e.target.value);
                if (payError) setPayError(null);
              }}
            />
          </Field>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPaying(null)}>
              Cancel
            </Button>
            <Button loading={pay.isPending} onClick={submitPayment}>
              Record payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
