import { CalendarRange, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/form-controls';
import { cn, formatDate } from '@/lib/utils';

export interface DateRange {
  from: string;
  to: string;
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

/** Presets are computed per render so a session open past midnight stays honest. */
export function buildPresets(): { label: string; range: DateRange }[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const startOfMonth = new Date(year, month, 1);
  const last90 = new Date(year, month, now.getDate() - 89);

  return [
    { label: 'This month', range: { from: iso(startOfMonth), to: iso(now) } },
    { label: 'Last 90 days', range: { from: iso(last90), to: iso(now) } },
    { label: 'This year', range: { from: `${year}-01-01`, to: `${year}-12-31` } },
    { label: 'Last year', range: { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` } },
  ];
}

export const defaultRange = (): DateRange => buildPresets()[2]!.range;

function rangeSummary({ from, to }: DateRange) {
  if (!from || !to) return 'Pick a start and end date';
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '—';

  const days = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000)) + 1;
  const span =
    days >= 365
      ? `${(days / 365).toFixed(days % 365 === 0 ? 0 : 1)} years`
      : days >= 60
        ? `${Math.round(days / 30)} months`
        : `${days} days`;

  return `${formatDate(from)} → ${formatDate(to)} · ${span}`;
}

/**
 * Date range filter for the analytics views.
 *
 * The two native date fields stay on screen rather than hiding inside a popover:
 * this is a filter people re-aim constantly, and a extra click to reach it is a
 * click on every adjustment. The presets sit beside them as real buttons, since
 * they are the way the range is set most of the time.
 */
export function DateRangePicker({
  value,
  onChange,
  className,
  presets = buildPresets(),
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
  presets?: { label: string; range: DateRange }[];
}) {
  const activePreset = presets.find(
    (preset) => preset.range.from === value.from && preset.range.to === value.to
  );

  return (
    <section
      aria-label="Date range filter"
      className={cn('rounded-lg border bg-card p-4 shadow-sm', className)}
    >
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex items-center gap-2 self-center pr-1 text-sm font-medium">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <CalendarRange className="h-4 w-4" aria-hidden />
          </span>
          <span className="hidden sm:inline">Date range</span>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="from" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="from"
            type="date"
            value={value.from}
            max={value.to || undefined}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            className="w-[10.5rem]"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="to" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="to"
            type="date"
            value={value.to}
            min={value.from || undefined}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            className="w-[10.5rem]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {presets.map((preset) => {
            const selected = activePreset?.label === preset.label;
            return (
              <Button
                key={preset.label}
                type="button"
                size="sm"
                variant={selected ? 'default' : 'outline'}
                aria-pressed={selected}
                onClick={() => onChange(preset.range)}
              >
                {preset.label}
              </Button>
            );
          })}
          {!activePreset && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange(defaultRange())}
              aria-label="Reset the date range to this year"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
          )}
        </div>
      </div>

      <p className="mt-3 border-t pt-3 text-xs text-muted-foreground" aria-live="polite">
        Showing <span className="font-medium text-foreground">{rangeSummary(value)}</span>
      </p>
    </section>
  );
}
