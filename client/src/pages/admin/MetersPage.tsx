import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  BarChart3,
  Gauge,
  History,
  Link2,
  Link2Off,
  Pencil,
  Plus,
  Trash2,
  Zap,
} from 'lucide-react';
import { PageHeader, StatCard } from '@/components/StatCard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { Alert, LoadingState } from '@/components/ui/feedback';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Segmented } from '@/components/ui/segmented';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { adminApi, meterApi } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { MONTH_NAMES, formatDateTime, formatMoney } from '@/lib/utils';
import { toast } from '@/store/toast.store';
import {
  AssignMeterValues,
  DEFAULT_PER_UNIT,
  MeterValues,
  assignMeterSchema,
  buildReadingSchema,
  meterSchema,
} from '@/lib/schemas';
import type { MeterView, RentCategory } from '@/types';

const blankMeter: MeterValues = {
  meterName: '',
  meterNumber: '',
  previousReading: 0,
  currentReading: 0,
  perUnitRate: '',
  category: undefined,
  unitId: '',
};

const now = new Date();

/**
 * Electricity meters (SRS 3.2.9).
 *
 * Everything an admin does to a meter happens from its row: edit it, allocate
 * it to a flat or a shop, release it, file a reading on the resident's behalf,
 * or open its consumption report. Allocation is deliberately two steps — a
 * meter already on a unit must be released before it can move, because a dial
 * that changes unit mid-cycle would bill one tenant for another's consumption.
 */
export default function MetersPage() {
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<{ meter: MeterView | null } | null>(null);
  const [assigning, setAssigning] = useState<MeterView | null>(null);
  const [reading, setReading] = useState<MeterView | null>(null);
  const [reporting, setReporting] = useState<MeterView | null>(null);
  const [historyOf, setHistoryOf] = useState<MeterView | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MeterView | null>(null);
  const [confirmRelease, setConfirmRelease] = useState<MeterView | null>(null);

  const meters = useQuery({ queryKey: ['admin', 'meters'], queryFn: () => adminApi.meters() });
  const flats = useQuery({ queryKey: ['admin', 'flats'], queryFn: () => adminApi.flats() });
  const shops = useQuery({ queryKey: ['admin', 'shops'], queryFn: () => adminApi.shops() });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin'] });

  const meterForm = useForm<MeterValues>({
    resolver: zodResolver(meterSchema),
    defaultValues: blankMeter,
  });

  const saveMeter = useMutation({
    mutationFn: (values: MeterValues) => {
      const payload = {
        meterName: values.meterName,
        meterNumber: values.meterNumber,
        previousReading: values.previousReading,
        currentReading: values.currentReading,
        // Blank means "follow the category default", which the server stores as
        // null rather than freezing today's default onto the row.
        perUnitRate: values.perUnitRate ? Number(values.perUnitRate) : null,
      };
      return editor?.meter
        ? adminApi.updateMeter(editor.meter.id, payload)
        : adminApi.createMeter({
            ...payload,
            ...(values.unitId && values.category
              ? { category: values.category, unitId: values.unitId }
              : {}),
          });
    },
    onSuccess: () => {
      toast.success(editor?.meter ? 'Meter updated' : 'Meter added');
      setEditor(null);
      meterForm.reset(blankMeter);
      invalidate();
    },
    onError: (err) =>
      toast.error(
        editor?.meter ? 'Could not update the meter' : 'Could not add the meter',
        errorMessage(err)
      ),
  });

  const assignForm = useForm<AssignMeterValues>({
    resolver: zodResolver(assignMeterSchema),
    defaultValues: { category: 'FLAT', unitId: '' },
  });
  const assignCategory = assignForm.watch('category');

  const assign = useMutation({
    mutationFn: (values: AssignMeterValues) => adminApi.assignMeter(assigning!.id, values),
    onSuccess: (meter) => {
      toast.success(`Meter ${meter.meterNumber} assigned to ${meter.unit?.label}`);
      setAssigning(null);
      assignForm.reset({ category: 'FLAT', unitId: '' });
      invalidate();
    },
    onError: (err) => toast.error('Could not assign the meter', errorMessage(err)),
  });

  const unassign = useMutation({
    mutationFn: (id: string) => adminApi.unassignMeter(id),
    onSuccess: () => {
      toast.success('Meter released', 'It is back in the pool and can be reassigned.');
      setConfirmRelease(null);
      invalidate();
    },
    onError: (err) => toast.error('Could not release the meter', errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminApi.deleteMeter(id),
    onSuccess: () => {
      toast.success('Meter deleted');
      setConfirmDelete(null);
      invalidate();
    },
    onError: (err) => toast.error('Could not delete the meter', errorMessage(err)),
  });

  const openCreate = () => {
    meterForm.reset(blankMeter);
    setEditor({ meter: null });
  };

  const openEdit = (meter: MeterView) => {
    meterForm.reset({
      meterName: meter.meterName,
      meterNumber: meter.meterNumber,
      previousReading: meter.previousReading,
      currentReading: meter.currentReading,
      perUnitRate: meter.perUnitRate === null ? '' : String(meter.perUnitRate),
      category: undefined,
      unitId: '',
    });
    setEditor({ meter });
  };

  const rows = meters.data?.meters ?? [];
  const assigned = rows.filter((m) => m.unit).length;
  const pendingCharge = rows.reduce((sum, m) => sum + m.pendingAmount, 0);

  const assignableUnits =
    assignCategory === 'SHOP'
      ? (shops.data ?? []).map((shop) => ({
          id: shop.id,
          label: `${shop.shopNumber} · ${shop.shopName}`,
        }))
      : (flats.data ?? []).map((flat) => ({
          id: flat.id,
          label: `${flat.flatNumber} — ${flat.building}`,
        }));

  const columns = useMemo<DataTableColumn<MeterView>[]>(
    () => [
      {
        id: 'meterNumber',
        header: 'Meter no.',
        sortValue: (meter) => meter.meterNumber,
        cell: (meter) => (
          <div>
            <p className="font-medium">{meter.meterNumber}</p>
            <p className="text-xs text-muted-foreground">{meter.meterName}</p>
          </div>
        ),
      },
      {
        id: 'unit',
        header: 'Assigned to',
        sortValue: (meter) => meter.unit?.label ?? null,
        cell: (meter) =>
          meter.unit ? (
            <div>
              <p className="text-sm">{meter.unit.label}</p>
              <p className="text-xs text-muted-foreground">{meter.unit.location}</p>
            </div>
          ) : (
            <Badge variant="secondary">Unassigned</Badge>
          ),
      },
      {
        id: 'previousReading',
        header: 'Previous',
        align: 'right',
        sortValue: (meter) => meter.previousReading,
        cell: (meter) => <span className="tabular-nums">{meter.previousReading}</span>,
      },
      {
        id: 'currentReading',
        header: 'Current',
        align: 'right',
        sortValue: (meter) => meter.currentReading,
        cell: (meter) => <span className="tabular-nums font-medium">{meter.currentReading}</span>,
      },
      {
        id: 'rate',
        header: 'Per unit',
        align: 'right',
        sortValue: (meter) => meter.effectiveRate,
        cell: (meter) => (
          <span className="tabular-nums">
            {formatMoney(meter.effectiveRate)}
            {meter.perUnitRate === null && (
              <span className="ml-1 text-xs text-muted-foreground">default</span>
            )}
          </span>
        ),
      },
      {
        id: 'pending',
        header: 'Since last bill',
        align: 'right',
        sortValue: (meter) => meter.pendingAmount,
        cell: (meter) => (
          <div className="tabular-nums">
            <p>{formatMoney(meter.pendingAmount)}</p>
            <p className="text-xs text-muted-foreground">{meter.pendingUnits} units</p>
          </div>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        sortValue: (meter) => (meter.isActive ? 'In service' : 'Out of service'),
        cell: (meter) => (
          <Badge variant={meter.isActive ? 'success' : 'secondary'}>
            {meter.isActive ? 'In service' : 'Out of service'}
          </Badge>
        ),
      },
    ],
    []
  );

  return (
    <>
      <PageHeader
        title="Meters"
        description="Electricity meters, their readings, and the charge each one carries."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add meter
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Total meters" value={String(rows.length)} icon={Gauge} />
        <StatCard
          label="Assigned"
          value={`${assigned} / ${rows.length}`}
          hint={`${rows.length - assigned} waiting in the pool`}
          tone="primary"
        />
        <StatCard
          label="Unbilled consumption"
          value={formatMoney(pendingCharge)}
          hint="Dial movement not yet on an invoice"
          tone="warning"
          icon={Zap}
        />
      </div>

      <Card>
        <CardContent className="pt-5">
          {meters.isError ? (
            <Alert tone="error" title="Could not load meters">
              {errorMessage(meters.error)}
            </Alert>
          ) : (
            <DataTable
              rows={rows}
              columns={columns}
              getRowId={(meter) => meter.id}
              isLoading={meters.isLoading}
              exportFileName="AmarBari-Meters"
              searchPlaceholder="Search by meter number, name or unit…"
              searchableText={(meter) =>
                [meter.meterNumber, meter.meterName, meter.unit?.label ?? ''].join(' ')
              }
              onServerSearch={async (query) => (await adminApi.meters({ search: query })).meters}
              emptyMessage="No meters yet — add the first one."
              actions={[
                { label: 'Record reading', icon: Gauge, onSelect: setReading },
                { label: 'Report', icon: BarChart3, onSelect: setReporting },
                { label: 'Change log', icon: History, onSelect: setHistoryOf },
                { label: 'Edit', icon: Pencil, onSelect: openEdit },
                {
                  label: 'Assign to a unit',
                  icon: Link2,
                  hidden: (meter) => Boolean(meter.unit),
                  onSelect: (meter) => {
                    assignForm.reset({ category: 'FLAT', unitId: '' });
                    setAssigning(meter);
                  },
                },
                {
                  label: 'Release',
                  icon: Link2Off,
                  hidden: (meter) => !meter.unit,
                  onSelect: setConfirmRelease,
                },
                {
                  label: 'Delete',
                  icon: Trash2,
                  destructive: true,
                  disabled: (meter) => Boolean(meter.unit),
                  onSelect: setConfirmDelete,
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      {/* Create / edit */}
      <Dialog open={Boolean(editor)} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editor?.meter ? `Edit meter ${editor.meter.meterNumber}` : 'Add a meter'}
            </DialogTitle>
            <DialogDescription>
              The bill is (current − previous) × per-unit rate. Leave the rate blank to follow the
              category default — {formatMoney(DEFAULT_PER_UNIT.FLAT)} for a flat,{' '}
              {formatMoney(DEFAULT_PER_UNIT.SHOP)} for a shop.
            </DialogDescription>
          </DialogHeader>

          <form
            id="meter-form"
            onSubmit={meterForm.handleSubmit((values) => saveMeter.mutate(values))}
            noValidate
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Meter name"
                htmlFor="meterName"
                error={meterForm.formState.errors.meterName?.message}
                required
              >
                <Input id="meterName" placeholder="Ground floor east" {...meterForm.register('meterName')} />
              </Field>
              <Field
                label="Meter number"
                htmlFor="meterNumber"
                error={meterForm.formState.errors.meterNumber?.message}
                required
              >
                <Input id="meterNumber" placeholder="MTR-0012" {...meterForm.register('meterNumber')} />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Previous reading"
                htmlFor="previousReading"
                error={meterForm.formState.errors.previousReading?.message}
                required
              >
                <Input
                  id="previousReading"
                  type="number"
                  min={0}
                  step="0.01"
                  {...meterForm.register('previousReading')}
                />
              </Field>
              <Field
                label="Current reading"
                htmlFor="currentReading"
                error={meterForm.formState.errors.currentReading?.message}
                required
              >
                <Input
                  id="currentReading"
                  type="number"
                  min={0}
                  step="0.01"
                  {...meterForm.register('currentReading')}
                />
              </Field>
              <Field
                label="Per-unit rate"
                htmlFor="perUnitRate"
                error={meterForm.formState.errors.perUnitRate?.message}
                hint="Blank = category default"
              >
                <Input
                  id="perUnitRate"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="10"
                  {...meterForm.register('perUnitRate')}
                />
              </Field>
            </div>

            {!editor?.meter && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Assign to"
                  htmlFor="meterCategory"
                  error={meterForm.formState.errors.category?.message}
                  hint="Optional — a meter can wait in the pool"
                >
                  <Select id="meterCategory" {...meterForm.register('category')}>
                    <option value="">Leave unassigned</option>
                    <option value="FLAT">Flat</option>
                    <option value="SHOP">Shop</option>
                  </Select>
                </Field>
                <Field
                  label="Unit"
                  htmlFor="meterUnitId"
                  error={meterForm.formState.errors.unitId?.message}
                >
                  <Select id="meterUnitId" {...meterForm.register('unitId')}>
                    <option value="">Choose a unit…</option>
                    {(meterForm.watch('category') === 'SHOP' ? shops.data ?? [] : flats.data ?? []).map(
                      (unit) => (
                        <option key={unit.id} value={unit.id}>
                          {'shopNumber' in unit
                            ? `${unit.shopNumber} · ${unit.shopName}`
                            : `${unit.flatNumber} — ${unit.building}`}
                        </option>
                      )
                    )}
                  </Select>
                </Field>
              </div>
            )}
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button type="submit" form="meter-form" loading={saveMeter.isPending}>
              {editor?.meter ? 'Save changes' : 'Add meter'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign */}
      <Dialog open={Boolean(assigning)} onOpenChange={(open) => !open && setAssigning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign meter {assigning?.meterNumber}</DialogTitle>
            <DialogDescription>
              A meter serves one unit at a time. To move an assigned meter, release it first — that
              is the act which says its readings up to now belong to the old unit.
            </DialogDescription>
          </DialogHeader>

          <form
            id="assign-meter-form"
            onSubmit={assignForm.handleSubmit((values) => assign.mutate(values))}
            noValidate
            className="space-y-4"
          >
            <Field label="Category" htmlFor="assignCategory" required>
              <Segmented
                value={assignCategory}
                onChange={(value) => {
                  assignForm.setValue('category', value as RentCategory);
                  assignForm.setValue('unitId', '');
                }}
                options={[
                  { value: 'FLAT', label: 'Flat' },
                  { value: 'SHOP', label: 'Shop' },
                ]}
                aria-label="Unit category"
              />
            </Field>

            <Field
              label="Unit"
              htmlFor="assignUnitId"
              error={assignForm.formState.errors.unitId?.message}
              required
            >
              <Select id="assignUnitId" {...assignForm.register('unitId')}>
                <option value="">Choose a unit…</option>
                {assignableUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.label}
                  </option>
                ))}
              </Select>
            </Field>
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssigning(null)}>
              Cancel
            </Button>
            <Button type="submit" form="assign-meter-form" loading={assign.isPending}>
              Assign meter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {reading && (
        <ReadingDialog meter={reading} onClose={() => setReading(null)} onSaved={invalidate} />
      )}
      {reporting && <ReportDialog meter={reporting} onClose={() => setReporting(null)} />}
      {historyOf && <HistoryDialog meter={historyOf} onClose={() => setHistoryOf(null)} />}

      {/* Release */}
      <Dialog open={Boolean(confirmRelease)} onOpenChange={(open) => !open && setConfirmRelease(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Release meter {confirmRelease?.meterNumber}?</DialogTitle>
            <DialogDescription>
              It leaves {confirmRelease?.unit?.label} and returns to the pool. Readings already filed
              stay on the record, and the invoices they were billed on are untouched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRelease(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={unassign.isPending}
              onClick={() => confirmRelease && unassign.mutate(confirmRelease.id)}
            >
              Release meter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={Boolean(confirmDelete)} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete meter {confirmDelete?.meterNumber}?</DialogTitle>
            <DialogDescription>
              This removes the meter and its reading history permanently. The change log entries
              describing those readings are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={remove.isPending}
              onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}
            >
              Delete meter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Files a reading for a chosen month — the admin-side counterpart of the resident form. */
function ReadingDialog({
  meter,
  onClose,
  onSaved,
}: {
  meter: MeterView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const form = useForm<{ currentReading: number }>({
    resolver: zodResolver(buildReadingSchema(meter.currentReading)),
    defaultValues: { currentReading: meter.currentReading },
  });

  const value = form.watch('currentReading');
  const units = Math.max(0, Number(value || 0) - meter.currentReading);

  const save = useMutation({
    mutationFn: (values: { currentReading: number }) =>
      meterApi.submitReading(meter.id, { ...values, month, year }),
    onSuccess: (result) => {
      toast.success(
        result.corrected ? 'Reading corrected' : 'Reading recorded',
        `${result.reading.unitsConsumed} units · ${formatMoney(result.reading.amount)}`
      );
      onSaved();
      onClose();
    },
    onError: (err) => toast.error('Could not record the reading', errorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a reading — {meter.meterNumber}</DialogTitle>
          <DialogDescription>
            The dial last read {meter.currentReading}. Consumption is charged at{' '}
            {formatMoney(meter.effectiveRate)} per unit.
          </DialogDescription>
        </DialogHeader>

        <form
          id="meter-reading-form"
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
          noValidate
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Month" htmlFor="readingMonth" required>
              <Select
                id="readingMonth"
                value={month}
                onChange={(event) => setMonth(Number(event.target.value))}
              >
                {MONTH_NAMES.map((name, index) => (
                  <option key={name} value={index + 1}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Year" htmlFor="readingYear" required>
              <Input
                id="readingYear"
                type="number"
                value={year}
                onChange={(event) => setYear(Number(event.target.value))}
              />
            </Field>
          </div>

          <Field
            label="Current reading"
            htmlFor="reading"
            error={form.formState.errors.currentReading?.message}
            required
            hint={`Cannot be below ${meter.currentReading}`}
          >
            <Input id="reading" type="number" min={meter.currentReading} step="0.01" {...form.register('currentReading')} />
          </Field>

          <Alert tone="info" title="This reading bills">
            {units} units × {formatMoney(meter.effectiveRate)} ={' '}
            <strong>{formatMoney(units * meter.effectiveRate)}</strong>
          </Alert>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="meter-reading-form" loading={save.isPending}>
            Save reading
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Monthly and yearly consumption for one meter (SRS 3.2.9 item 8). */
function ReportDialog({ meter, onClose }: { meter: MeterView; onClose: () => void }) {
  const [year, setYear] = useState<number | undefined>(undefined);
  const report = useQuery({
    queryKey: ['admin', 'meters', meter.id, 'report', year],
    queryFn: () => meterApi.report(meter.id, year),
  });

  // Once the report names the year it resolved to, pin the picker to it.
  useEffect(() => {
    if (year === undefined && report.data) setYear(report.data.year);
  }, [report.data, year]);

  const data = report.data;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {meter.meterNumber} — consumption report
          </DialogTitle>
          <DialogDescription>
            {meter.unit?.label ?? 'Unassigned'} · dial now reads {meter.currentReading}
          </DialogDescription>
        </DialogHeader>

        {report.isLoading ? (
          <LoadingState label="Loading the report…" />
        ) : report.isError ? (
          <Alert tone="error" title="Could not load the report">
            {errorMessage(report.error)}
          </Alert>
        ) : data ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Field label="Year" htmlFor="reportYear" className="w-32">
                <Select
                  id="reportYear"
                  value={data.year}
                  onChange={(event) => setYear(Number(event.target.value))}
                >
                  {(data.availableYears.length > 0 ? data.availableYears : [data.year]).map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid flex-1 gap-3 sm:grid-cols-3">
                <StatCard
                  label="Units this year"
                  value={String(data.yearTotals.unitsConsumed)}
                  hint={`${data.yearTotals.monthsRecorded} months recorded`}
                />
                <StatCard
                  label="Charged"
                  value={formatMoney(data.yearTotals.amount)}
                  tone="primary"
                />
                <StatCard
                  label="Closing reading"
                  value={String(data.yearTotals.closingReading)}
                  hint={
                    data.yearTotals.openingReading === null
                      ? 'No readings this year'
                      : `Opened at ${data.yearTotals.openingReading}`
                  }
                />
              </div>
            </div>

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Month</th>
                    <th className="px-3 py-2 text-right">Previous</th>
                    <th className="px-3 py-2 text-right">Current</th>
                    <th className="px-3 py-2 text-right">Units</th>
                    <th className="px-3 py-2 text-right">Rate</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">Recorded by</th>
                  </tr>
                </thead>
                <tbody>
                  {data.months.map((row) => (
                    <tr key={row.month} className="border-t">
                      <td className="px-3 py-2">{row.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.previousReading ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.currentReading ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.unitsConsumed}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.perUnitRate === null ? '—' : formatMoney(row.perUnitRate)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.amount)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {row.recordedByName ?? 'Not recorded'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data.yearly.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">Year by year</p>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Year</th>
                        <th className="px-3 py-2 text-right">Months</th>
                        <th className="px-3 py-2 text-right">Units</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2 text-right">Closing reading</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.yearly.map((row) => (
                        <tr key={row.year} className="border-t">
                          <td className="px-3 py-2">{row.year}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.months}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.unitsConsumed}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatMoney(row.amount)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.closingReading}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Everything that has ever been done to this meter, from the activity log. */
function HistoryDialog({ meter, onClose }: { meter: MeterView; onClose: () => void }) {
  const log = useQuery({
    queryKey: ['admin', 'activity', 'Meter', meter.id],
    queryFn: () => adminApi.activity({ entity: 'Meter', entityId: meter.id, pageSize: 50 }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{meter.meterNumber} — change log</DialogTitle>
          <DialogDescription>
            Every reading, edit and allocation, with who made it. This is the record a disputed bill
            is settled against.
          </DialogDescription>
        </DialogHeader>

        {log.isLoading ? (
          <LoadingState label="Loading the log…" />
        ) : log.isError ? (
          <Alert tone="error" title="Could not load the log">
            {errorMessage(log.error)}
          </Alert>
        ) : (log.data?.entries.length ?? 0) === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing recorded against this meter yet.
          </p>
        ) : (
          <ol className="max-h-[60vh] space-y-3 overflow-y-auto">
            {log.data!.entries.map((entry) => (
              <li key={entry.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="secondary">{entry.action}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(entry.createdAt)}
                  </span>
                </div>
                <p className="mt-2 text-sm">{entry.summary}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {entry.actorName} · {entry.actorRole}
                </p>
              </li>
            ))}
          </ol>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
