import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ClipboardList, Plus, Trash2 } from 'lucide-react';
import { PageHeader, StatCard } from '@/components/StatCard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { Alert, EmptyState, LoadingState } from '@/components/ui/feedback';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { adminApi } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { formatDate, formatMoney } from '@/lib/utils';
import { toast } from '@/store/toast.store';
import { ExpenseValues, expenseSchema } from '@/lib/schemas';

const COMMON_CATEGORIES = [
  'Electricity',
  'Water Maintenance',
  'Internet Trunk',
  'Lift & Generator Servicing',
  'Cleaning & Security',
  'Repairs',
  'Municipal Tax',
  'Other',
];

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const expenses = useQuery({ queryKey: ['admin', 'expenses'], queryFn: () => adminApi.expenses() });
  const flats = useQuery({ queryKey: ['admin', 'flats'], queryFn: adminApi.flats });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ExpenseValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      category: 'Electricity',
      amount: 0,
      description: '',
      expenseDate: new Date().toISOString().slice(0, 10),
      flatId: '',
    },
  });

  const create = useMutation({
    mutationFn: (values: ExpenseValues) =>
      adminApi.createExpense({
        category: values.category,
        amount: values.amount,
        description: values.description || undefined,
        expenseDate: values.expenseDate || undefined,
        flatId: values.flatId || null,
      }),
    onSuccess: () => {
      toast.success('Expense recorded');
      setCreateOpen(false);
      reset();
      queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => toast.error('Could not record the expense', errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminApi.deleteExpense(id),
    onSuccess: () => {
      toast.success('Expense deleted');
      queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => toast.error('Could not delete the expense', errorMessage(err)),
  });

  const rows = expenses.data?.expenses ?? [];
  const total = rows.reduce((sum, e) => sum + e.amount, 0);
  const thisMonth = rows
    .filter((e) => new Date(e.expenseDate).getMonth() === new Date().getMonth())
    .reduce((sum, e) => sum + e.amount, 0);

  return (
    <>
      <PageHeader
        title="Building expenses"
        description="Operating costs deducted from rent revenue to give net profit."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
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
          {expenses.isLoading ? (
            <LoadingState label="Loading expenses…" />
          ) : expenses.isError ? (
            <Alert tone="error" title="Could not load expenses">
              {errorMessage(expenses.error)}
            </Alert>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No expenses recorded"
              description="Log utilities and maintenance costs so profit reflects reality."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Flat</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((expense) => (
                  <TableRow key={expense.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(expense.expenseDate)}
                    </TableCell>
                    <TableCell className="font-medium">{expense.category}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {expense.flat?.flatNumber ?? 'Building-wide'}
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-muted-foreground">
                      {expense.description ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(expense.amount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => remove.mutate(expense.id)}
                        aria-label={`Delete ${expense.category} expense`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record an expense</DialogTitle>
            <DialogDescription>
              Leave the flat unset for costs that apply to the whole building.
            </DialogDescription>
          </DialogHeader>

          <form
            id="expense-form"
            onSubmit={handleSubmit((values) => create.mutate(values))}
            noValidate
            className="space-y-4"
          >
            <Field label="Category" htmlFor="category" error={errors.category?.message} required>
              <Input id="category" list="expense-categories" {...register('category')} />
              <datalist id="expense-categories">
                {COMMON_CATEGORIES.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount" htmlFor="amount" error={errors.amount?.message} required>
                <Input id="amount" type="number" min={0} step="0.01" {...register('amount')} />
              </Field>
              <Field label="Date" htmlFor="expenseDate" error={errors.expenseDate?.message}>
                <Input id="expenseDate" type="date" {...register('expenseDate')} />
              </Field>
            </div>

            <Field label="Flat (optional)" htmlFor="flatId" error={errors.flatId?.message}>
              <Select id="flatId" {...register('flatId')}>
                <option value="">Building-wide</option>
                {(flats.data ?? []).map((flat) => (
                  <option key={flat.id} value={flat.id}>
                    {flat.flatNumber}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Description" htmlFor="description" error={errors.description?.message}>
              <Textarea id="description" rows={3} {...register('description')} />
            </Field>
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="expense-form" loading={create.isPending}>
              Record expense
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
