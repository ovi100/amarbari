import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader, StatCard } from '@/components/StatCard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { Alert } from '@/components/ui/feedback';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { adminApi } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { formatDate, formatMoney } from '@/lib/utils';
import { toast } from '@/store/toast.store';
import { CUSTOM_EXPENSE_CATEGORY, ExpenseValues, expenseSchema } from '@/lib/schemas';
import type { BuildingExpense } from '@/types';

const COMMON_CATEGORIES = [
  'Electricity',
  'Water Maintenance',
  'Internet Trunk',
  'Lift & Generator Servicing',
  'Cleaning & Security',
  'Repairs',
  'Municipal Tax',
];

const today = () => new Date().toISOString().slice(0, 10);

const blankExpense: ExpenseValues = {
  category: 'Electricity',
  customCategory: '',
  amount: 0,
  description: '',
  expenseDate: today(),
  flatId: '',
};

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<{ expense: BuildingExpense | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BuildingExpense | null>(null);

  const expenses = useQuery({ queryKey: ['admin', 'expenses'], queryFn: () => adminApi.expenses() });
  const flats = useQuery({ queryKey: ['admin', 'flats'], queryFn: () => adminApi.flats() });

  const form = useForm<ExpenseValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: blankExpense,
  });

  const isCustom = form.watch('category') === CUSTOM_EXPENSE_CATEGORY;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin'] });

  const save = useMutation({
    mutationFn: (values: ExpenseValues) => {
      const payload = {
        // The sentinel never reaches the API — the typed name replaces it.
        category:
          values.category === CUSTOM_EXPENSE_CATEGORY
            ? values.customCategory!.trim()
            : values.category,
        amount: values.amount,
        description: values.description || undefined,
        expenseDate: values.expenseDate || undefined,
        flatId: values.flatId || null,
      };
      return editor?.expense
        ? adminApi.updateExpense(editor.expense.id, payload)
        : adminApi.createExpense(payload);
    },
    onSuccess: () => {
      toast.success(editor?.expense ? 'Expense updated' : 'Expense recorded');
      setEditor(null);
      form.reset(blankExpense);
      invalidate();
    },
    onError: (err) =>
      toast.error(
        editor?.expense ? 'Could not update the expense' : 'Could not record the expense',
        errorMessage(err)
      ),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminApi.deleteExpense(id),
    onSuccess: () => {
      toast.success('Expense deleted');
      setConfirmDelete(null);
      invalidate();
    },
    onError: (err) => toast.error('Could not delete the expense', errorMessage(err)),
  });

  const openCreate = () => {
    form.reset({ ...blankExpense, expenseDate: today() });
    setEditor({ expense: null });
  };

  const openEdit = (expense: BuildingExpense) => {
    const known = COMMON_CATEGORIES.includes(expense.category);
    form.reset({
      category: known ? expense.category : CUSTOM_EXPENSE_CATEGORY,
      customCategory: known ? '' : expense.category,
      amount: expense.amount,
      description: expense.description ?? '',
      expenseDate: expense.expenseDate.slice(0, 10),
      flatId: expense.flatId ?? '',
    });
    setEditor({ expense });
  };

  const rows = expenses.data?.expenses ?? [];
  const total = rows.reduce((sum, e) => sum + e.amount, 0);
  const thisMonth = rows
    .filter((e) => new Date(e.expenseDate).getMonth() === new Date().getMonth())
    .reduce((sum, e) => sum + e.amount, 0);

  const columns = useMemo<DataTableColumn<BuildingExpense>[]>(
    () => [
      {
        id: 'expenseDate',
        header: 'Date',
        sortValue: (expense) => expense.expenseDate,
        exportValue: (expense) => formatDate(expense.expenseDate),
        cell: (expense) => <span className="whitespace-nowrap">{formatDate(expense.expenseDate)}</span>,
      },
      {
        id: 'category',
        header: 'Category',
        sortValue: (expense) => expense.category,
        cell: (expense) => <span className="font-medium">{expense.category}</span>,
      },
      {
        id: 'flat',
        header: 'Flat',
        sortValue: (expense) => expense.flat?.flatNumber ?? 'Building-wide',
        cell: (expense) => (
          <span className="text-muted-foreground">{expense.flat?.flatNumber ?? 'Building-wide'}</span>
        ),
      },
      {
        id: 'description',
        header: 'Description',
        sortValue: (expense) => expense.description ?? null,
        className: 'max-w-[280px] truncate',
        cell: (expense) => (
          <span className="text-muted-foreground">{expense.description ?? '—'}</span>
        ),
      },
      {
        id: 'amount',
        header: 'Amount',
        align: 'right',
        sortValue: (expense) => expense.amount,
        cell: (expense) => <span className="tabular-nums">{formatMoney(expense.amount)}</span>,
      },
    ],
    []
  );

  return (
    <>
      <PageHeader
        title="Building expenses"
        description="Operating costs deducted from rent revenue to give net profit."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Record expense
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Expenses on record" value={String(rows.length)} icon={ClipboardList} />
        <StatCard label="Total logged" value={formatMoney(total)} />
        <StatCard label="This month" value={formatMoney(thisMonth)} tone="warning" />
      </div>

      <Card>
        <CardContent className="pt-5">
          {expenses.isError ? (
            <Alert tone="error" title="Could not load expenses">
              {errorMessage(expenses.error)}
            </Alert>
          ) : (
            <DataTable
              rows={rows}
              columns={columns}
              getRowId={(expense) => expense.id}
              isLoading={expenses.isLoading}
              exportFileName="AmarBari-Expenses"
              searchPlaceholder="Search by category, description or flat…"
              searchableText={(expense) =>
                [expense.category, expense.description ?? '', expense.flat?.flatNumber ?? ''].join(' ')
              }
              onServerSearch={async (query) => (await adminApi.expenses({ search: query })).expenses}
              emptyMessage="No expenses recorded — log utilities and maintenance so profit reflects reality."
              initialSort={{ columnId: 'expenseDate', direction: 'desc' }}
              actions={[
                { label: 'Edit', icon: Pencil, onSelect: openEdit },
                { label: 'Delete', icon: Trash2, destructive: true, onSelect: setConfirmDelete },
              ]}
            />
          )}
        </CardContent>
      </Card>

      {/* Record / edit an expense */}
      <Dialog open={Boolean(editor)} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editor?.expense ? 'Edit expense' : 'Record an expense'}</DialogTitle>
            <DialogDescription>
              Leave the flat unset for costs that apply to the whole building.
            </DialogDescription>
          </DialogHeader>

          <form
            id="expense-form"
            onSubmit={form.handleSubmit((values) => save.mutate(values))}
            noValidate
            className="space-y-4"
          >
            <Field label="Category" htmlFor="category" error={form.formState.errors.category?.message} required>
              <Select id="category" {...form.register('category')}>
                {COMMON_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
                <option value={CUSTOM_EXPENSE_CATEGORY}>Other — enter a custom category…</option>
              </Select>
            </Field>

            {/* Revealed only when nothing in the list fits. */}
            {isCustom && (
              <Field
                label="Custom category"
                htmlFor="customCategory"
                error={form.formState.errors.customCategory?.message}
                required
                hint="Name it as you would want it to read on the expense report"
              >
                <Input
                  id="customCategory"
                  placeholder="e.g. Rooftop waterproofing"
                  autoFocus
                  {...form.register('customCategory')}
                />
              </Field>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount" htmlFor="amount" error={form.formState.errors.amount?.message} required>
                <Input id="amount" type="number" min={0} step="0.01" {...form.register('amount')} />
              </Field>
              <Field label="Date" htmlFor="expenseDate" error={form.formState.errors.expenseDate?.message}>
                <Input id="expenseDate" type="date" {...form.register('expenseDate')} />
              </Field>
            </div>

            <Field label="Flat (optional)" htmlFor="flatId" error={form.formState.errors.flatId?.message}>
              <Select id="flatId" {...form.register('flatId')}>
                <option value="">Building-wide</option>
                {(flats.data ?? []).map((flat) => (
                  <option key={flat.id} value={flat.id}>
                    {flat.flatNumber}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Description" htmlFor="description" error={form.formState.errors.description?.message}>
              <Textarea id="description" rows={3} {...form.register('description')} />
            </Field>
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button type="submit" form="expense-form" loading={save.isPending}>
              {editor?.expense ? 'Save changes' : 'Record expense'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={Boolean(confirmDelete)} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this expense?</DialogTitle>
            <DialogDescription>
              {confirmDelete &&
                `${confirmDelete.category} · ${formatMoney(confirmDelete.amount)} · ${formatDate(
                  confirmDelete.expenseDate
                )}`}
            </DialogDescription>
          </DialogHeader>
          <Alert tone="warning">Net profit for the affected period will move accordingly.</Alert>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={remove.isPending}
              onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}
            >
              Delete expense
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
