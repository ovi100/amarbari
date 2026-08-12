import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Columns3, Database, Lock, Pencil, Search, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/StatCard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Label, Select } from '@/components/ui/form-controls';
import { Alert, EmptyState, LoadingState } from '@/components/ui/feedback';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { adminApi } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { cn, formatDateTime } from '@/lib/utils';
import { toast } from '@/store/toast.store';
import { ColumnValues, columnSchema } from '@/lib/schemas';
import type { ColumnMeta } from '@/types';

/** Renders a cell value according to its declared column type. */
function renderCell(column: ColumnMeta, value: unknown) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground">—</span>;
  }
  if (column.type === 'Boolean' || column.type === 'BOOLEAN') {
    return <Badge variant={value ? 'success' : 'secondary'}>{value ? 'Yes' : 'No'}</Badge>;
  }
  if (column.type === 'DateTime' || column.type === 'DATE') {
    return <span className="whitespace-nowrap">{formatDateTime(value as string)}</span>;
  }
  if (column.kind === 'enum') {
    return <Badge variant="outline">{String(value)}</Badge>;
  }
  if (column.type === 'Json') {
    return <code className="text-xs">{JSON.stringify(value)}</code>;
  }
  const text = String(value);
  return (
    <span className="block max-w-[220px] truncate" title={text}>
      {text}
    </span>
  );
}

/** Converts a stored value into something an <input> can hold. */
function toInputValue(column: ColumnMeta, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (column.type === 'DateTime' || column.type === 'DATE') {
    const date = new Date(value as string);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function DataControlPage() {
  const queryClient = useQueryClient();
  const [table, setTable] = useState('User');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [columnOpen, setColumnOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const tables = useQuery({ queryKey: ['admin', 'tables'], queryFn: adminApi.tables });
  const data = useQuery({
    queryKey: ['admin', 'table', table, page, debouncedSearch],
    queryFn: () => adminApi.table(table, { page, search: debouncedSearch || undefined }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'table'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'tables'] });
  };

  const columnForm = useForm<ColumnValues>({
    resolver: zodResolver(columnSchema),
    defaultValues: { columnName: '', label: '', type: 'STRING', required: false, defaultValue: '' },
  });

  const addColumn = useMutation({
    mutationFn: (values: ColumnValues) =>
      adminApi.addColumn(table, {
        columnName: values.columnName,
        label: values.label || undefined,
        type: values.type,
        required: values.required,
        defaultValue: values.defaultValue || null,
      }),
    onSuccess: () => {
      toast.success('Column added', `${table} now has a new field.`);
      setColumnOpen(false);
      columnForm.reset();
      invalidate();
    },
    onError: (err) => toast.error('Could not add the column', errorMessage(err)),
  });

  const dropColumn = useMutation({
    mutationFn: (columnName: string) => adminApi.dropColumn(table, columnName),
    onSuccess: (result) => {
      toast.success(`Column "${result.removed}" removed`);
      invalidate();
    },
    onError: (err) => toast.error('Could not remove the column', errorMessage(err)),
  });

  const patch = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      adminApi.patchRecord(table, id, payload),
    onSuccess: () => {
      toast.success('Record updated');
      setEditing(null);
      invalidate();
    },
    onError: (err) => toast.error('Could not update the record', errorMessage(err)),
  });

  const removeRecord = useMutation({
    mutationFn: (id: string) => adminApi.deleteRecord(table, id),
    onSuccess: () => {
      toast.success('Record deleted');
      setConfirmDelete(null);
      invalidate();
    },
    onError: (err) => toast.error('Could not delete the record', errorMessage(err)),
  });

  const columns = data.data?.columns ?? [];
  const editable = useMemo(() => columns.filter((c) => !c.isReadOnly), [columns]);
  const dynamicColumns = columns.filter((c) => c.isDynamic);
  const records = data.data?.records ?? [];
  const pagination = data.data?.pagination;

  const openEditor = (record: Record<string, unknown>) => {
    setEditing(record);
    setDraft(
      Object.fromEntries(editable.map((column) => [column.name, toInputValue(column, record[column.name])]))
    );
  };

  const saveEdits = () => {
    if (!editing) return;
    const payload: Record<string, unknown> = {};
    for (const column of editable) {
      const next = draft[column.name] ?? '';
      const before = toInputValue(column, editing[column.name]);
      if (next === before) continue; // only send what actually changed
      payload[column.name] =
        next === ''
          ? null
          : column.type === 'Boolean' || column.type === 'BOOLEAN'
            ? next === 'true'
            : next;
    }
    if (Object.keys(payload).length === 0) {
      toast.info('Nothing to save', 'No fields were changed.');
      return;
    }
    patch.mutate({ id: String(editing.id), payload });
  };

  return (
    <>
      <PageHeader
        title="Data control"
        description="Inspect and edit any column on any table, and extend the schema with your own fields."
        actions={
          <Button onClick={() => setColumnOpen(true)}>
            <Columns3 className="h-4 w-4" /> Add column to {table}
          </Button>
        }
      />

      <Alert tone="info" className="mb-6" title="How dynamic columns work">
        Columns you add here are stored in each record&rsquo;s JSON field and registered in a
        schema registry — no migration and no risk to the relational core. Native columns are
        editable in place; identifiers, timestamps and password hashes are locked.
      </Alert>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="table">Table</Label>
          <Select
            id="table"
            value={table}
            onChange={(e) => {
              setTable(e.target.value);
              setPage(1);
              setSearch('');
            }}
            className="w-auto"
          >
            {(tables.data ?? []).map((descriptor) => (
              <option key={descriptor.name} value={descriptor.name}>
                {descriptor.name} ({descriptor.recordCount})
              </option>
            ))}
          </Select>
        </div>

        <div className="min-w-[220px] flex-1 space-y-1.5">
          <Label htmlFor="search">Search</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search across ${table} text fields…`}
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {dynamicColumns.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Custom columns:</span>
          {dynamicColumns.map((column) => (
            <span
              key={column.name}
              className="inline-flex items-center gap-1.5 rounded-full border bg-card py-1 pl-3 pr-1.5 text-xs"
            >
              <span className="font-medium">{column.label ?? column.name}</span>
              <span className="text-muted-foreground">{column.type}</span>
              <button
                type="button"
                onClick={() => dropColumn.mutate(column.name)}
                className="rounded-full p-1 hover:bg-destructive/10"
                aria-label={`Remove the ${column.name} column`}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </button>
            </span>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="pt-5">
          {data.isLoading ? (
            <LoadingState label={`Loading ${table}…`} />
          ) : data.isError ? (
            <Alert tone="error" title="Could not load the table">
              {errorMessage(data.error)}
            </Alert>
          ) : columns.length === 0 ? (
            <EmptyState icon={Database} title="No columns" />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((column) => (
                      <TableHead key={column.name}>
                        <span className="inline-flex items-center gap-1">
                          {column.label ?? column.name}
                          {column.isDynamic && (
                            <span className="text-[10px] font-normal normal-case text-primary">
                              custom
                            </span>
                          )}
                          {column.isReadOnly && <Lock className="h-3 w-3 opacity-50" />}
                        </span>
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.length === 0 ? (
                    <TableEmpty colSpan={columns.length + 1}>
                      No records match this search.
                    </TableEmpty>
                  ) : (
                    records.map((record) => (
                      <TableRow key={String(record.id)}>
                        {columns.map((column) => (
                          <TableCell
                            key={column.name}
                            className={cn(column.isId && 'font-mono text-xs text-muted-foreground')}
                          >
                            {renderCell(column, record[column.name])}
                          </TableCell>
                        ))}
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openEditor(record)}
                              aria-label="Edit record"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmDelete(record)}
                              aria-label="Delete record"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              {pagination && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    {pagination.total} records · page {pagination.page} of {pagination.totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= pagination.totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Record editor */}
      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit {table} record</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {String(editing?.id ?? '')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[55vh] gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
            {editable.map((column) => {
              const id = `field-${column.name}`;
              const value = draft[column.name] ?? '';
              const onChange = (next: string) =>
                setDraft((prev) => ({ ...prev, [column.name]: next }));

              return (
                <Field
                  key={column.name}
                  label={column.label ?? column.name}
                  htmlFor={id}
                  required={column.isRequired}
                  hint={column.isDynamic ? `Custom · ${column.type}` : column.type}
                >
                  {column.kind === 'enum' ? (
                    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
                      {!column.isRequired && <option value="">—</option>}
                      {(column.enumValues ?? []).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                  ) : column.type === 'Boolean' || column.type === 'BOOLEAN' ? (
                    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </Select>
                  ) : (
                    <Input
                      id={id}
                      type={
                        column.type === 'DateTime' || column.type === 'DATE'
                          ? 'date'
                          : ['Int', 'Float', 'Decimal', 'NUMBER'].includes(column.type)
                            ? 'number'
                            : 'text'
                      }
                      step={['Float', 'Decimal', 'NUMBER'].includes(column.type) ? '0.01' : undefined}
                      value={value}
                      onChange={(e) => onChange(e.target.value)}
                    />
                  )}
                </Field>
              );
            })}

            {table === 'User' && (
              <Field
                label="Set new password"
                htmlFor="field-password"
                hint="Leave blank to keep the current password"
              >
                <Input
                  id="field-password"
                  type="password"
                  autoComplete="new-password"
                  value={draft.password ?? ''}
                  onChange={(e) => setDraft((prev) => ({ ...prev, password: e.target.value }))}
                />
              </Field>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdits} loading={patch.isPending}>
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add a dynamic column */}
      <Dialog open={columnOpen} onOpenChange={setColumnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a column to {table}</DialogTitle>
            <DialogDescription>
              The field becomes available on every {table} record immediately.
            </DialogDescription>
          </DialogHeader>

          <form
            id="column-form"
            onSubmit={columnForm.handleSubmit((values) => addColumn.mutate(values))}
            noValidate
            className="space-y-4"
          >
            <Field
              label="Column name"
              htmlFor="columnName"
              error={columnForm.formState.errors.columnName?.message}
              required
              hint="Used as the storage key, e.g. parkingSlots"
            >
              <Input id="columnName" placeholder="parkingSlots" {...columnForm.register('columnName')} />
            </Field>

            <Field label="Display label" htmlFor="label" error={columnForm.formState.errors.label?.message}>
              <Input id="label" placeholder="Parking Slots" {...columnForm.register('label')} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type" htmlFor="type" error={columnForm.formState.errors.type?.message} required>
                <Select id="type" {...columnForm.register('type')}>
                  <option value="STRING">Text</option>
                  <option value="NUMBER">Number</option>
                  <option value="BOOLEAN">Yes / No</option>
                  <option value="DATE">Date</option>
                </Select>
              </Field>
              <Field
                label="Default value"
                htmlFor="defaultValue"
                error={columnForm.formState.errors.defaultValue?.message}
              >
                <Input id="defaultValue" {...columnForm.register('defaultValue')} />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[hsl(var(--primary))]"
                {...columnForm.register('required')}
              />
              Required — reject empty values on save
            </label>
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setColumnOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="column-form" loading={addColumn.isPending}>
              Add column
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete record */}
      <Dialog open={Boolean(confirmDelete)} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this {table} record?</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {String(confirmDelete?.id ?? '')}
            </DialogDescription>
          </DialogHeader>
          <Alert tone="warning">
            Deleting a record cascades to anything that depends on it. This cannot be undone.
          </Alert>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={removeRecord.isPending}
              onClick={() => confirmDelete && removeRecord.mutate(String(confirmDelete.id))}
            >
              Delete record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
