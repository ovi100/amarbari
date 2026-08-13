import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Banknote, Download, Eye, FileImage, Pencil, Plus } from 'lucide-react';
import { PageHeader } from '@/components/StatCard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, PaymentBadge } from '@/components/ui/badge';
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
  INVOICE_LINE_ITEMS,
  InvoiceEditValues,
  InvoiceValues,
  LINE_ITEM_LABELS,
  type RentCategoryValue,
  buildPaymentSchema,
  invoiceEditSchema,
  invoiceSchema,
} from '@/lib/schemas';
import type { Invoice } from '@/types';

const now = new Date();

/** Default due date: the 10th of the billed month, matching the server. */
const defaultDueDate = (month: number, year: number) =>
  `${year}-${String(month).padStart(2, '0')}-10`;

const tenantOf = (invoice: Invoice) =>
  (invoice.flat ?? invoice.shop)?.tenancies?.[0]?.user.fullName ?? null;

/** Which category an invoice was issued against. */
const categoryOf = (invoice: Invoice): RentCategoryValue => (invoice.shopId ? 'SHOP' : 'FLAT');

/** "A-101", or "S-01 · Rahim Store". */
const unitLabelOf = (invoice: Invoice) => {
  if (invoice.shop) return `${invoice.shop.shopNumber} · ${invoice.shop.shopName}`;
  return invoice.flat?.flatNumber ?? '—';
};

/** The line items to show for an invoice, driven by its category. */
const lineItemsOf = (invoice: Invoice) =>
  [...INVOICE_LINE_ITEMS[categoryOf(invoice)], 'previousDue'].map((key) => ({
    key: key as keyof Invoice,
    label: LINE_ITEM_LABELS[key] ?? key,
  }));

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
  const shops = useQuery({ queryKey: ['admin', 'shops'], queryFn: () => adminApi.shops() });

  // An invoice needs somebody to bill, so only occupied units are offered —
  // in whichever category the admin has selected.
  const billableFlats = (flats.data ?? []).filter((flat) => flat.isOccupied);
  const billableShops = (shops.data ?? []).filter((shop) => shop.isOccupied);
  const vacantCount =
    (flats.data ?? []).length - billableFlats.length + ((shops.data ?? []).length - billableShops.length);

  const createForm = useForm<InvoiceValues>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      category: 'FLAT',
      unitId: '',
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      flatRent: 0,
      electricityBill: 0,
      waterBill: 0,
      internetBill: 0,
      utilityBill: 0,
      serviceCharge: 0,
      maintenanceCharge: 0,
      dueDate: defaultDueDate(now.getMonth() + 1, now.getFullYear()),
    },
  });

  const editForm = useForm<InvoiceEditValues>({ resolver: zodResolver(invoiceEditSchema) });

  // Picking a flat prefills its base rent and the month prefills the due date,
  // so "state every charge" does not mean "retype what the system knows".
  const category = createForm.watch('category');
  const selectedFlatId = createForm.watch('unitId');
  const billableUnits = category === 'FLAT' ? billableFlats : billableShops;
  const selectedMonth = createForm.watch('month');
  const selectedYear = createForm.watch('year');

  useEffect(() => {
    const unit = [...billableFlats, ...billableShops].find((u) => u.id === selectedFlatId);
    if (unit) createForm.setValue('flatRent', unit.baseRent, { shouldValidate: true });
    // billableFlats is derived from a query result and is stable enough here;
    // re-running on every fetch would clobber a manual override.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFlatId]);

  useEffect(() => {
    createForm.setValue('unitId', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  useEffect(() => {
    const month = Number(selectedMonth);
    const year = Number(selectedYear);
    if (month >= 1 && month <= 12 && year > 2000) {
      createForm.setValue('dueDate', defaultDueDate(month, year));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, selectedYear]);

  /**
   * Electricity is metered (SRS 8.11): Σ (current − previous) × per-unit rate
   * across the unit's meters. The figure is fetched and prefilled rather than
   * left to be typed, but stays editable — the admin remains the one who states
   * every charge (§8.4), and a meter can be wrong.
   */
  const metered = useQuery({
    queryKey: [
      'admin',
      'meters',
      'electricity',
      category,
      selectedFlatId,
      selectedMonth,
      selectedYear,
    ],
    queryFn: () =>
      adminApi.electricity({
        category,
        unitId: selectedFlatId,
        month: Number(selectedMonth),
        year: Number(selectedYear),
      }),
    enabled:
      Boolean(selectedFlatId) &&
      Number(selectedMonth) >= 1 &&
      Number(selectedMonth) <= 12 &&
      Number(selectedYear) > 2000,
  });

  useEffect(() => {
    if (metered.data) {
      createForm.setValue('electricityBill', metered.data.amount, { shouldValidate: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metered.data]);

  /** What the prefilled electricity figure is made of, stated under the field. */
  const meterHint = (() => {
    const data = metered.data;
    if (!data) return undefined;
    if (data.lines.length === 0) return 'No meters on this unit — enter the charge by hand';
    const parts = data.lines.map(
      (line) =>
        `${line.meterNumber}: ${line.currentReading} − ${line.previousReading} = ` +
        `${line.unitsConsumed} × ${line.perUnitRate}`
    );
    return (
      `${parts.join(' · ')}${
        data.missingReadings.length > 0
          ? ` — no reading filed this month for ${data.missingReadings.join(', ')}, so the dial was used`
          : ''
      }`
    );
  })();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin'] });

  const create = useMutation({
    mutationFn: ({ category: cat, unitId, ...values }: InvoiceValues) =>
      // The API takes exactly one of flatId / shopId.
      invoiceApi.create({
        ...values,
        ...(cat === 'FLAT' ? { flatId: unitId } : { shopId: unitId }),
      }),
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
        id: 'category',
        header: 'Type',
        sortValue: categoryOf,
        cell: (invoice) => (
          <Badge variant={categoryOf(invoice) === 'SHOP' ? 'outline' : 'secondary'}>
            {categoryOf(invoice) === 'SHOP' ? 'Shop' : 'Flat'}
          </Badge>
        ),
      },
      {
        id: 'unit',
        header: 'Unit',
        sortValue: unitLabelOf,
        cell: (invoice) => unitLabelOf(invoice),
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
                  invoice.shop?.shopNumber ?? '',
                  invoice.shop?.shopName ?? '',
                  invoice.shop?.address ?? '',
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
                label="Rent category"
                htmlFor="category"
                error={createForm.formState.errors.category?.message}
                required
                hint="Shops are billed a service and maintenance charge instead of water and internet"
              >
                <Select id="category" {...createForm.register('category')}>
                  <option value="FLAT">Flat</option>
                  <option value="SHOP">Shop</option>
                </Select>
              </Field>

              <Field
                label={category === 'SHOP' ? 'Shop' : 'Flat'}
                htmlFor="unitId"
                error={createForm.formState.errors.unitId?.message}
                required
                hint={
                  vacantCount > 0
                    ? `${vacantCount} vacant ${vacantCount === 1 ? 'unit is' : 'units are'} hidden — a unit with no user assigned cannot be invoiced`
                    : undefined
                }
              >
                <Select id="unitId" {...createForm.register('unitId')}>
                  <option value="">Choose a {category === 'SHOP' ? 'shop' : 'flat'}…</option>
                  {billableUnits.map((unit) => {
                    const label =
                      'shopNumber' in unit ? `${unit.shopNumber} · ${unit.shopName}` : unit.flatNumber;
                    return (
                      <option key={unit.id} value={unit.id}>
                        {label} · {unit.tenancies?.[0]?.user.fullName ?? 'occupied'} ·{' '}
                        {formatMoney(unit.baseRent)}
                      </option>
                    );
                  })}
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
                label="Rent"
                htmlFor="flatRent"
                error={createForm.formState.errors.flatRent?.message}
                required
                hint="Prefilled from the flat's base rent — override it here if this month differs"
              >
                <Input id="flatRent" type="number" min={0} step="0.01" {...createForm.register('flatRent')} />
              </Field>

              {/* Only the charges that apply to this category — a shop must
                  never be billed for water or internet. */}
              <div className="grid gap-4 sm:grid-cols-2">
                {INVOICE_LINE_ITEMS[category]
                  .filter((name) => name !== 'flatRent')
                  .map((name) => (
                    <Field
                      key={name}
                      label={LINE_ITEM_LABELS[name] ?? name}
                      htmlFor={name}
                      error={createForm.formState.errors[name]?.message}
                      required
                      hint={name === 'electricityBill' ? meterHint : undefined}
                      className={name === 'electricityBill' ? 'sm:col-span-2' : undefined}
                    >
                      <Input
                        id={name}
                        type="number"
                        min={0}
                        step="0.01"
                        {...createForm.register(name)}
                      />
                    </Field>
                  ))}
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
              {viewing && `${monthLabel(viewing.month, viewing.year)} · ${unitLabelOf(viewing)}`}
            </DialogTitle>
            <DialogDescription>
              {viewing && (
                <>
                  Issued to {tenantOf(viewing) ?? 'an unassigned unit'} · due{' '}
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
                {lineItemsOf(viewing).map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between px-3 py-2 text-sm">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="tabular-nums">{formatMoney(viewing[key] as number)}</dd>
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
              {editing && `Edit ${monthLabel(editing.month, editing.year)} · ${unitLabelOf(editing)}`}
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
