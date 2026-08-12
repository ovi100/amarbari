import { BarChart3, Table2 } from 'lucide-react';
import { Segmented } from '@/components/ui/segmented';

export type ChartView = 'chart' | 'table';

/**
 * The chart/table switch, shared by every chart card so the control looks and
 * behaves the same wherever it appears.
 *
 * Both options are always visible and the active one is filled — a single
 * button that relabels itself on click is ambiguous about whether its label
 * names the current view or the next one.
 */
export function ChartViewToggle({
  value,
  onChange,
  label,
}: {
  value: ChartView;
  onChange: (view: ChartView) => void;
  label: string;
}) {
  return (
    <Segmented
      size="sm"
      aria-label={label}
      value={value}
      onChange={onChange}
      options={[
        { value: 'chart', label: 'Chart view', icon: BarChart3 },
        { value: 'table', label: 'Table view', icon: Table2 },
      ]}
    />
  );
}
