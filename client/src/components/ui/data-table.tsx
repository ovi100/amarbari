import * as React from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Database,
  Download,
  Loader2,
  MoreHorizontal,
  Search,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form-controls';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface DataTableColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** Supplying this makes the column sortable and gives the export its value. */
  sortValue?: (row: T) => string | number | boolean | null | undefined;
  /** Overrides `sortValue` when the exported text should differ from the sort key. */
  exportValue?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right';
  className?: string;
}

export interface DataTableAction<T> {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onSelect: (row: T) => void;
  destructive?: boolean;
  hidden?: (row: T) => boolean;
  disabled?: (row: T) => boolean;
}

type SortState = { columnId: string; direction: 'asc' | 'desc' } | null;

const PAGE_SIZES = [10, 25, 50, 100];

/** Quotes a CSV field only when it has to be, so the file stays readable. */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const body = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  // The BOM is what makes Excel open UTF-8 (Bengali names, ৳) correctly.
  const blob = new Blob([`﻿${body}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function compare(a: unknown, b: unknown) {
  if (a === b) return 0;
  // Empty cells sort last in both directions rather than pretending to be "".
  if (a === null || a === undefined || a === '') return 1;
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * The one grid every admin table is built from: searchable, sortable,
 * paginated, exportable, with row actions that collapse into a menu once there
 * are more than two of them.
 *
 * Search runs against the rows already on the client first. Only when that
 * finds nothing does it fall back to `onServerSearch`, which queries the
 * database for records outside the fetched page — so the common case costs no
 * round trip and a genuinely absent record is still findable.
 */
export function DataTable<T>({
  rows,
  columns,
  getRowId,
  actions = [],
  searchableText,
  onServerSearch,
  searchPlaceholder = 'Search…',
  exportFileName,
  exportable = true,
  initialPageSize = 10,
  initialSort = null,
  isLoading = false,
  toolbar,
  emptyMessage = 'Nothing to show yet.',
  noMatchMessage = 'No records match this search.',
}: {
  rows: T[];
  columns: DataTableColumn<T>[];
  getRowId: (row: T) => string;
  actions?: DataTableAction<T>[];
  searchableText?: (row: T) => string;
  onServerSearch?: (query: string) => Promise<T[]>;
  searchPlaceholder?: string;
  exportFileName: string;
  exportable?: boolean;
  initialPageSize?: number;
  initialSort?: SortState;
  isLoading?: boolean;
  toolbar?: React.ReactNode;
  emptyMessage?: React.ReactNode;
  noMatchMessage?: React.ReactNode;
}) {
  const [query, setQuery] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [sort, setSort] = React.useState<SortState>(initialSort);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(initialPageSize);
  const [remoteRows, setRemoteRows] = React.useState<T[] | null>(null);
  const [remoteSearching, setRemoteSearching] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  React.useEffect(() => {
    setPage(1);
  }, [debounced, pageSize, rows]);

  const localMatches = React.useMemo(() => {
    if (!debounced || !searchableText) return rows;
    const needle = debounced.toLowerCase();
    return rows.filter((row) => searchableText(row).toLowerCase().includes(needle));
  }, [rows, debounced, searchableText]);

  // Database fallback: only for a search that came up empty on the client.
  React.useEffect(() => {
    if (!onServerSearch || !debounced || localMatches.length > 0) {
      setRemoteRows(null);
      setRemoteSearching(false);
      return;
    }

    let cancelled = false;
    setRemoteSearching(true);
    onServerSearch(debounced)
      .then((found) => {
        if (!cancelled) setRemoteRows(found);
      })
      .catch(() => {
        if (!cancelled) setRemoteRows([]);
      })
      .finally(() => {
        if (!cancelled) setRemoteSearching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debounced, localMatches.length, onServerSearch]);

  const usingRemote = Boolean(debounced) && localMatches.length === 0 && remoteRows !== null;
  const matched = usingRemote ? remoteRows! : localMatches;

  const sorted = React.useMemo(() => {
    if (!sort) return matched;
    const column = columns.find((c) => c.id === sort.columnId);
    if (!column?.sortValue) return matched;
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...matched].sort(
      (a, b) => compare(column.sortValue!(a), column.sortValue!(b)) * direction
    );
  }, [matched, sort, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const toggleSort = (columnId: string) => {
    setSort((current) => {
      if (current?.columnId !== columnId) return { columnId, direction: 'asc' };
      if (current.direction === 'asc') return { columnId, direction: 'desc' };
      return null; // third click restores the natural order
    });
  };

  const exportRows = () => {
    // Only columns that declare a plain-text value are exportable — a cell
    // rendering badges and icons has no meaningful CSV form.
    const exportColumns = columns.filter((c) => c.sortValue || c.exportValue);
    downloadCsv(
      exportFileName,
      exportColumns.map((c) => c.header),
      sorted.map((row) =>
        exportColumns.map((c) => {
          const value = c.exportValue ? c.exportValue(row) : c.sortValue!(row);
          return value === null || value === undefined ? '' : String(value);
        })
      )
    );
  };

  const visibleActions = (row: T) => actions.filter((action) => !action.hidden?.(row));
  const columnCount = columns.length + (actions.length > 0 ? 1 : 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {searchableText && (
          <div className="relative min-w-[220px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="pl-9 pr-9"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-0 inset-y-0 grid w-9 place-items-center text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {toolbar}

        {exportable && (
          <Button variant="outline" size="sm" onClick={exportRows} disabled={sorted.length === 0}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        )}
      </div>

      {remoteSearching && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          No match on this page — searching the database…
        </p>
      )}
      {usingRemote && remoteRows!.length > 0 && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Database className="h-3.5 w-3.5" aria-hidden />
          Found {remoteRows!.length} {remoteRows!.length === 1 ? 'record' : 'records'} in the
          database beyond the loaded page.
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => {
              const sortable = Boolean(column.sortValue);
              const active = sort?.columnId === column.id;
              const Icon = !active ? ChevronsUpDown : sort!.direction === 'asc' ? ArrowUp : ArrowDown;

              return (
                <TableHead
                  key={column.id}
                  className={cn(column.align === 'right' && 'text-right', column.className)}
                  aria-sort={active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.id)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        column.align === 'right' && 'flex-row-reverse',
                        active && 'text-foreground'
                      )}
                    >
                      {column.header}
                      <Icon className={cn('h-3 w-3', !active && 'opacity-40')} aria-hidden />
                    </button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              );
            })}
            {actions.length > 0 && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>

        <TableBody>
          {isLoading ? (
            <TableEmpty colSpan={columnCount}>
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
              </span>
            </TableEmpty>
          ) : pageRows.length === 0 ? (
            <TableEmpty colSpan={columnCount}>{debounced ? noMatchMessage : emptyMessage}</TableEmpty>
          ) : (
            pageRows.map((row) => {
              const rowActions = visibleActions(row);
              return (
                <TableRow key={getRowId(row)}>
                  {columns.map((column) => (
                    <TableCell
                      key={column.id}
                      className={cn(column.align === 'right' && 'text-right', column.className)}
                    >
                      {column.cell(row)}
                    </TableCell>
                  ))}

                  {actions.length > 0 && (
                    <TableCell className="text-right">
                      {/* Two actions fit inline; more than that becomes a menu
                          so the row does not grow a toolbar. */}
                      {rowActions.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : rowActions.length <= 2 ? (
                        <div className="flex justify-end gap-1">
                          {rowActions.map((action) => (
                            <Button
                              key={action.label}
                              size="sm"
                              variant={action.destructive ? 'ghost' : 'outline'}
                              disabled={action.disabled?.(row)}
                              onClick={() => action.onSelect(row)}
                            >
                              {action.icon && (
                                <action.icon
                                  className={cn('h-3.5 w-3.5', action.destructive && 'text-destructive')}
                                />
                              )}
                              {action.label}
                            </Button>
                          ))}
                        </div>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost" aria-label="Row actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {rowActions.map((action) => (
                              <DropdownMenuItem
                                key={action.label}
                                destructive={action.destructive}
                                disabled={action.disabled?.(row)}
                                onSelect={() => action.onSelect(row)}
                              >
                                {action.icon && <action.icon className="h-3.5 w-3.5" />}
                                {action.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            {sorted.length === 0
              ? 'No records'
              : `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, sorted.length)} of ${sorted.length}`}
          </span>
          <Select
            aria-label="Rows per page"
            value={String(pageSize)}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="h-8 w-auto py-0 text-xs sm:h-8"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Previous
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">
            {currentPage} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => setPage(currentPage + 1)}
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
