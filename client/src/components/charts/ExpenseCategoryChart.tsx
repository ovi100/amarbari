import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCompact, formatMoney } from '@/lib/utils';
import { EmptyState } from '@/components/ui/feedback';
import { ChartViewToggle, type ChartView } from '@/components/charts/ChartViewToggle';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PieChart } from 'lucide-react';

/**
 * Expense breakdown by category — one measure, one series, so a single hue and
 * no legend (the card title names it). Horizontal bars keep long category
 * labels readable without rotation.
 *
 * Carries the same chart/table switch as the revenue card: both cards on the
 * overview offer the same affordance in the same place.
 */
export function ExpenseCategoryChart({
  data,
}: {
  data: { category: string; amount: number }[];
}) {
  const [view, setView] = useState<ChartView>('chart');

  if (data.length === 0) {
    return (
      <EmptyState
        icon={PieChart}
        title="No expenses recorded"
        description="Log building expenses to see where the money goes."
      />
    );
  }

  const top = data.slice(0, 8);
  const height = Math.max(180, top.length * 40 + 24);
  const total = data.reduce((sum, entry) => sum + entry.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ChartViewToggle value={view} onChange={setView} label="Expenses by category view" />
      </div>

      {view === 'chart' ? (
        <div style={{ height }} className="w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={top} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="var(--viz-grid)" strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: 'var(--viz-axis)' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={formatCompact}
              />
              <YAxis
                type="category"
                dataKey="category"
                width={132}
                tick={{ fontSize: 11, fill: 'var(--viz-axis)' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: 'var(--viz-grid)', fillOpacity: 0.35 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0]!.payload as { category: string; amount: number };
                  return (
                    <div className="rounded-lg border bg-popover p-3 text-sm shadow-lg">
                      <p className="font-semibold">{point.category}</p>
                      <p className="tabular-nums text-muted-foreground">{formatMoney(point.amount)}</p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="amount" radius={[0, 4, 4, 0]} barSize={18}>
                {top.map((entry) => (
                  <Cell key={entry.category} fill="var(--viz-2)" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((entry) => (
              <TableRow key={entry.category}>
                <TableCell className="font-medium">{entry.category}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(entry.amount)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {total > 0 ? `${Math.round((entry.amount / total) * 100)}%` : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
