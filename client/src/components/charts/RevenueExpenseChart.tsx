import { useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, Table2 } from 'lucide-react';
import { formatCompact, formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { MonthlyPoint } from '@/types';

/**
 * Revenue vs expense trend (SRS 3.2.4).
 *
 * All three measures are the same unit (currency) so they share one axis —
 * never a second y-scale. Colours come from the fixed chart palette in
 * index.css; the table view satisfies the relief rule for the lower-contrast
 * slot in light mode.
 */

const SERIES = [
  { key: 'revenue', label: 'Revenue (base rent)', color: 'var(--viz-1)' },
  { key: 'expenses', label: 'Operating expenses', color: 'var(--viz-2)' },
  { key: 'profit', label: 'Net profit', color: 'var(--viz-3)' },
] as const;

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover p-3 text-sm shadow-lg">
      <p className="mb-2 font-semibold">{label}</p>
      <dl className="space-y-1">
        {SERIES.map((series) => {
          const point = payload.find((p) => p.dataKey === series.key);
          if (!point) return null;
          return (
            <div key={series.key} className="flex items-center justify-between gap-6">
              <dt className="flex items-center gap-2 text-muted-foreground">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: series.color }}
                  aria-hidden
                />
                {series.label}
              </dt>
              <dd className="font-medium tabular-nums">{formatMoney(point.value)}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {SERIES.map((series) => (
        <li key={series.key} className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ background: series.color }}
            aria-hidden
          />
          {series.label}
        </li>
      ))}
    </ul>
  );
}

export function RevenueExpenseChart({ series }: { series: MonthlyPoint[] }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Legend />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setView(view === 'chart' ? 'table' : 'chart')}
          aria-pressed={view === 'table'}
        >
          {view === 'chart' ? (
            <>
              <Table2 className="h-3.5 w-3.5" /> Table view
            </>
          ) : (
            <>
              <BarChart3 className="h-3.5 w-3.5" /> Chart view
            </>
          )}
        </Button>
      </div>

      {view === 'chart' ? (
        <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--viz-grid)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'var(--viz-axis)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--viz-grid)' }}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--viz-axis)' }}
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={formatCompact}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ fill: 'var(--viz-grid)', fillOpacity: 0.35 }}
              />
              {/* 2px surface gap between adjacent bars. */}
              <Bar dataKey="revenue" fill="var(--viz-1)" radius={[4, 4, 0, 0]} barSize={14} />
              <Bar dataKey="expenses" fill="var(--viz-2)" radius={[4, 4, 0, 0]} barSize={14} />
              <Line
                type="monotone"
                dataKey="profit"
                stroke="var(--viz-3)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Expenses</TableHead>
              <TableHead className="text-right">Net profit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {series.map((point) => (
              <TableRow key={point.key}>
                <TableCell className="font-medium">{point.label}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(point.revenue)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(point.expenses)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatMoney(point.profit)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
