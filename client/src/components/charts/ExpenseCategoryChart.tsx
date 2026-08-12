import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCompact, formatMoney } from '@/lib/utils';
import { EmptyState } from '@/components/ui/feedback';
import { PieChart } from 'lucide-react';

/**
 * Expense breakdown by category — one measure, one series, so a single hue and
 * no legend (the card title names it). Horizontal bars keep long category
 * labels readable without rotation.
 */
export function ExpenseCategoryChart({
  data,
}: {
  data: { category: string; amount: number }[];
}) {
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

  return (
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
  );
}
