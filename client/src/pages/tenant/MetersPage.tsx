import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { BarChart3, CheckCircle2, Gauge, Zap } from 'lucide-react';
import { PageHeader, StatCard } from '@/components/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input } from '@/components/ui/form-controls';
import { Alert, EmptyState, LoadingState } from '@/components/ui/feedback';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { meterApi } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { MONTH_NAMES, formatDateTime, formatMoney } from '@/lib/utils';
import { toast } from '@/store/toast.store';
import { buildReadingSchema } from '@/lib/schemas';
import type { MeterView } from '@/types';

/**
 * The resident's side of metering (SRS 3.2.9 item 2).
 *
 * A resident does one thing here: enter what their meter reads this month. They
 * cannot add, move or delete a meter, and cannot change the tariff — those are
 * admin actions. Every submission, including a correction to one they filed
 * earlier this month, is written to the audit trail with its previous value.
 */
export default function TenantMetersPage() {
  const queryClient = useQueryClient();
  const [filing, setFiling] = useState<MeterView | null>(null);
  const [reportOf, setReportOf] = useState<MeterView | null>(null);

  const meters = useQuery({ queryKey: ['meters', 'mine'], queryFn: () => meterApi.mine() });

  const data = meters.data;
  const rows = data?.meters ?? [];
  const filed = rows.filter((meter) => meter.currentMonthReading).length;
  const monthCharge = rows.reduce(
    (sum, meter) => sum + (meter.currentMonthReading?.amount ?? 0),
    0
  );

  if (meters.isLoading) return <LoadingState label="Loading your meters…" />;

  if (meters.isError) {
    return (
      <>
        <PageHeader title="My Meters" />
        <Alert tone="error" title="Could not load your meters">
          {errorMessage(meters.error)}
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="My Meters"
        description={
          data?.unit
            ? `Electricity meters on ${data.unit.label}. Enter this month's reading and the charge is worked out for you.`
            : 'Electricity meters on your unit.'
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title="No meters on your unit yet"
          description="Your landlord assigns meters to a unit. Once one is attached, you can file its monthly reading here."
        />
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <StatCard label="Meters" value={String(rows.length)} icon={Gauge} />
            <StatCard
              label="Filed this month"
              value={`${filed} / ${rows.length}`}
              hint={
                data ? `${MONTH_NAMES[data.month - 1]} ${data.year}` : undefined
              }
              tone={filed === rows.length ? 'success' : 'warning'}
            />
            <StatCard
              label="Electricity this month"
              value={formatMoney(monthCharge)}
              hint="From the readings you have filed"
              icon={Zap}
              tone="primary"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {rows.map((meter) => {
              const reading = meter.currentMonthReading;
              return (
                <Card key={meter.id}>
                  <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                    <div>
                      <CardTitle>{meter.meterNumber}</CardTitle>
                      <p className="text-sm text-muted-foreground">{meter.meterName}</p>
                    </div>
                    {reading ? (
                      <Badge variant="success">
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Filed
                      </Badge>
                    ) : (
                      <Badge variant="warning">Reading due</Badge>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-muted-foreground">Previous reading</dt>
                        <dd className="tabular-nums font-medium">{meter.previousReading}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Current reading</dt>
                        <dd className="tabular-nums font-medium">{meter.currentReading}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Rate per unit</dt>
                        <dd className="tabular-nums">{formatMoney(meter.effectiveRate)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">This month</dt>
                        <dd className="tabular-nums">
                          {reading
                            ? `${reading.unitsConsumed} units · ${formatMoney(reading.amount)}`
                            : 'Not filed'}
                        </dd>
                      </div>
                    </dl>

                    {reading && (
                      <p className="text-xs text-muted-foreground">
                        Filed by {reading.recordedByName} on {formatDateTime(reading.updatedAt)}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => setFiling(meter)}>
                        <Gauge className="h-4 w-4" />
                        {reading ? 'Update the reading' : 'Enter this month’s reading'}
                      </Button>
                      <Button variant="outline" onClick={() => setReportOf(meter)}>
                        <BarChart3 className="h-4 w-4" /> History
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {filing && (
        <FileReadingDialog
          meter={filing}
          onClose={() => setFiling(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['meters'] })}
        />
      )}
      {reportOf && <MeterHistoryDialog meter={reportOf} onClose={() => setReportOf(null)} />}
    </>
  );
}

function FileReadingDialog({
  meter,
  onClose,
  onSaved,
}: {
  meter: MeterView;
  onClose: () => void;
  onSaved: () => void;
}) {
  // A correction re-uses the month's own baseline, so the floor is the reading
  // the month opened at rather than what was last typed.
  const floor = meter.currentMonthReading?.previousReading ?? meter.currentReading;

  const form = useForm<{ currentReading: number }>({
    resolver: zodResolver(buildReadingSchema(floor)),
    defaultValues: { currentReading: meter.currentMonthReading?.currentReading ?? floor },
  });

  const entered = Number(form.watch('currentReading') || 0);
  const units = Math.max(0, entered - floor);

  const save = useMutation({
    mutationFn: (values: { currentReading: number }) =>
      meterApi.submitReading(meter.id, values),
    onSuccess: (result) => {
      toast.success(
        result.corrected ? 'Reading updated' : 'Reading recorded',
        `${result.reading.unitsConsumed} units · ${formatMoney(result.reading.amount)}`
      );
      onSaved();
      onClose();
    },
    onError: (err) => toast.error('Could not save the reading', errorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{meter.meterNumber} — this month’s reading</DialogTitle>
          <DialogDescription>
            Enter the number shown on the dial. Your bill is (this reading − {floor}) ×{' '}
            {formatMoney(meter.effectiveRate)} per unit. Every change is logged with what it was
            before.
          </DialogDescription>
        </DialogHeader>

        <form
          id="tenant-reading-form"
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
          noValidate
          className="space-y-4"
        >
          <Field
            label="Meter reading"
            htmlFor="tenantReading"
            error={form.formState.errors.currentReading?.message}
            required
            hint={`Cannot be below ${floor} — a meter does not run backwards`}
          >
            <Input
              id="tenantReading"
              type="number"
              min={floor}
              step="0.01"
              autoFocus
              {...form.register('currentReading')}
            />
          </Field>

          <Alert tone="info" title="What this comes to">
            {units} units × {formatMoney(meter.effectiveRate)} ={' '}
            <strong>{formatMoney(units * meter.effectiveRate)}</strong>
          </Alert>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="tenant-reading-form" loading={save.isPending}>
            Save reading
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The resident's own consumption report — the same data the admin sees. */
function MeterHistoryDialog({ meter, onClose }: { meter: MeterView; onClose: () => void }) {
  const [year, setYear] = useState<number | undefined>(undefined);
  const report = useQuery({
    queryKey: ['meters', meter.id, 'report', year],
    queryFn: () => meterApi.report(meter.id, year),
  });
  const data = report.data;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{meter.meterNumber} — consumption</DialogTitle>
          <DialogDescription>
            What this meter has used month by month, and what it was charged.
          </DialogDescription>
        </DialogHeader>

        {report.isLoading ? (
          <LoadingState label="Loading…" />
        ) : report.isError ? (
          <Alert tone="error" title="Could not load the history">
            {errorMessage(report.error)}
          </Alert>
        ) : data ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              {data.availableYears.length > 1 && (
                <div className="flex gap-1">
                  {data.availableYears.map((y) => (
                    <Button
                      key={y}
                      size="sm"
                      variant={y === data.year ? 'default' : 'outline'}
                      onClick={() => setYear(y)}
                    >
                      {y}
                    </Button>
                  ))}
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                {data.yearTotals.unitsConsumed} units in {data.year} ·{' '}
                {formatMoney(data.yearTotals.amount)}
              </p>
            </div>

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Month</th>
                    <th className="px-3 py-2 text-right">Reading</th>
                    <th className="px-3 py-2 text-right">Units</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.months.map((row) => (
                    <tr key={row.month} className="border-t">
                      <td className="px-3 py-2">{row.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.currentReading ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.unitsConsumed}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
