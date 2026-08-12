import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}

/**
 * A single-choice control where every option stays visible and the selected one
 * is filled in.
 *
 * Used for the chart/table switch on every card and for the status filters, so
 * those two things behave identically everywhere: a toggle button that swaps
 * its own label leaves you guessing whether it names the current view or the
 * one you'd get by pressing it. Here both options are on screen and the filled
 * one is the state.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'default',
  className,
  'aria-label': ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: 'default' | 'sm';
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('inline-flex items-center gap-1 rounded-md border bg-muted/40 p-1', className)}
    >
      {options.map(({ value: option, label, icon: Icon }) => {
        const selected = option === value;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={selected}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3 text-sm',
              selected
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
            )}
          >
            {Icon && <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
            {label}
          </button>
        );
      })}
    </div>
  );
}
