import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, Pencil, Plus, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { PageHeader, StatCard } from '@/components/StatCard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { Alert, LoadingState } from '@/components/ui/feedback';
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
import { AssignFlatValues, FlatValues, assignFlatSchema, flatSchema } from '@/lib/schemas';
import type { Flat } from '@/types';

const blankFlat: FlatValues = { flatNumber: '', floor: 1, building: 'Main Building', baseRent: 0 };

export default function FlatsPage() {
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<{ flat: Flat | null } | null>(null);
  const [assigning, setAssigning] = useState<Flat | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Flat | null>(null);
  const [confirmRelease, setConfirmRelease] = useState<Flat | null>(null);

  const flats = useQuery({ queryKey: ['admin', 'flats'], queryFn: () => adminApi.flats() });

  // Only users without a flat can be assigned — the API enforces this too, but
  // offering an impossible choice and then rejecting it is a worse experience.
  const users = useQuery({
    queryKey: ['admin', 'users', 'all'],
    queryFn: () => adminApi.users(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin'] });

  const flatForm = useForm<FlatValues>({
    resolver: zodResolver(flatSchema),
    defaultValues: blankFlat,
  });

  const saveFlat = useMutation({
    mutationFn: (values: FlatValues) =>
      editor?.flat ? adminApi.updateFlat(editor.flat.id, values) : adminApi.createFlat(values),
    onSuccess: () => {
      toast.success(editor?.flat ? 'Flat updated' : 'Flat added');
      setEditor(null);
      flatForm.reset(blankFlat);
      invalidate();
    },
    onError: (err) =>
      toast.error(editor?.flat ? 'Could not update the flat' : 'Could not add the flat', errorMessage(err)),
  });

  const assignForm = useForm<AssignFlatValues>({
    resolver: zodResolver(assignFlatSchema),
    defaultValues: { userId: '', advanceDeposit: 0, startDate: '' },
  });

  const assign = useMutation({
    mutationFn: (values: AssignFlatValues) =>
      adminApi.assignFlat(assigning!.id, {
        userId: values.userId,
        advanceDeposit: values.advanceDeposit,
        startDate: values.startDate || undefined,
      }),
    onSuccess: () => {
      toast.success('User assigned to the flat');
      setAssigning(null);
      assignForm.reset();
      invalidate();
    },
    onError: (err) => toast.error('Could not assign the user', errorMessage(err)),
  });

  const release = useMutation({
    mutationFn: (id: string) => adminApi.releaseFlat(id),
    onSuccess: () => {
      toast.success('Tenancy ended', 'The flat is now vacant.');
      setConfirmRelease(null);
      invalidate();
    },
    onError: (err) => toast.error('Could not end the tenancy', errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminApi.deleteFlat(id),
    onSuccess: () => {
      toast.success('Flat deleted');
      setConfirmDelete(null);
      invalidate();
    },
    onError: (err) => toast.error('Could not delete the flat', errorMessage(err)),
  });

  const openCreate = () => {
    flatForm.reset(blankFlat);
    setEditor({ flat: null });
  };

  const openEdit = (flat: Flat) => {
    flatForm.reset({
      flatNumber: flat.flatNumber,
      floor: flat.floor,
      building: flat.building,
      baseRent: flat.baseRent,
    });
    setEditor({ flat });
  };

  const openAssign = (flat: Flat) => {
    assignForm.reset({ userId: '', advanceDeposit: 0, startDate: '' });
    setAssigning(flat);
  };

  const rows = flats.data ?? [];
  const occupied = rows.filter((f) => f.isOccupied).length;
  const monthlyRent = rows.filter((f) => f.isOccupied).reduce((sum, f) => sum + f.baseRent, 0);
  const assignableUsers = (users.data?.users ?? []).filter(
    (user) => !user.tenancy && user.role === 'TENANT'
  );

  const columns = useMemo<DataTableColumn<Flat>[]>(
    () => [
      {
        id: 'flatNumber',
        header: 'Flat',
        sortValue: (flat) => flat.flatNumber,
        cell: (flat) => <span className="font-medium">{flat.flatNumber}</span>,
      },
      {
        id: 'building',
        header: 'Building',
        sortValue: (flat) => flat.building,
        cell: (flat) => <span className="text-muted-foreground">{flat.building}</span>,
      },
      {
        id: 'floor',
        header: 'Floor',
        sortValue: (flat) => flat.floor,
        cell: (flat) => <span className="text-muted-foreground">{flat.floor}</span>,
      },
      {
        id: 'baseRent',
        header: 'Base rent',
        align: 'right',
        sortValue: (flat) => flat.baseRent,
        cell: (flat) => <span className="tabular-nums">{formatMoney(flat.baseRent)}</span>,
      },
      {
        id: 'occupancy',
        header: 'Occupancy',
        sortValue: (flat) => (flat.isOccupied ? 'Occupied' : 'Vacant'),
        cell: (flat) => (
          <Badge variant={flat.isOccupied ? 'success' : 'secondary'}>
            {flat.isOccupied ? 'Occupied' : 'Vacant'}
          </Badge>
        ),
      },
      {
        id: 'user',
        header: 'User',
        sortValue: (flat) => flat.tenancies?.[0]?.user.fullName ?? null,
        cell: (flat) => {
          const tenancy = flat.tenancies?.[0];
          return tenancy ? (
            <>
              <p className="text-sm">{tenancy.user.fullName}</p>
              <p className="text-xs text-muted-foreground">Since {formatDate(tenancy.startDate)}</p>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          );
        },
      },
    ],
    []
  );

  return (
    <>
      <PageHeader
        title="Flats"
        description="Every unit in the portfolio and who lives in it."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add flat
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Total flats" value={String(rows.length)} icon={Building2} />
        <StatCard
          label="Occupied"
          value={`${occupied} / ${rows.length}`}
          hint={`${rows.length - occupied} vacant`}
          tone="primary"
        />
        <StatCard
          label="Contracted monthly rent"
          value={formatMoney(monthlyRent)}
          hint="Base rent of occupied flats"
          tone="success"
        />
      </div>

      <Card>
        <CardContent className="pt-5">
          {flats.isError ? (
            <Alert tone="error" title="Could not load flats">
              {errorMessage(flats.error)}
            </Alert>
          ) : (
            <DataTable
              rows={rows}
              columns={columns}
              getRowId={(flat) => flat.id}
              isLoading={flats.isLoading}
              exportFileName="AmarBari-Flats"
              searchPlaceholder="Search by flat number, building or user…"
              searchableText={(flat) =>
                [flat.flatNumber, flat.building, flat.tenancies?.[0]?.user.fullName ?? ''].join(' ')
              }
              onServerSearch={(query) => adminApi.flats({ search: query })}
              emptyMessage="No flats yet — add your first unit to start allocating users."
              actions={[
                { label: 'Edit', icon: Pencil, onSelect: openEdit },
                {
                  label: 'Assign user',
                  icon: UserPlus,
                  hidden: (flat) => flat.isOccupied,
                  onSelect: openAssign,
                },
                {
                  label: 'End tenancy',
                  icon: UserMinus,
                  hidden: (flat) => !flat.isOccupied,
                  onSelect: setConfirmRelease,
                },
                {
                  label: 'Delete',
                  icon: Trash2,
                  destructive: true,
                  disabled: (flat) => flat.isOccupied,
                  onSelect: setConfirmDelete,
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      {/* Create / edit a flat */}
      <Dialog open={Boolean(editor)} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editor?.flat ? `Edit flat ${editor.flat.flatNumber}` : 'Add a flat'}</DialogTitle>
            <DialogDescription>
              Base rent is what the revenue engine counts as income.
            </DialogDescription>
          </DialogHeader>

          <form
            id="flat-form"
            onSubmit={flatForm.handleSubmit((values) => saveFlat.mutate(values))}
            noValidate
            className="space-y-4"
          >
            <Field
              label="Flat number"
              htmlFor="flatNumber"
              error={flatForm.formState.errors.flatNumber?.message}
              required
            >
              <Input id="flatNumber" placeholder="A-101" {...flatForm.register('flatNumber')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Floor" htmlFor="floor" error={flatForm.formState.errors.floor?.message} required>
                <Input id="floor" type="number" {...flatForm.register('floor')} />
              </Field>
              <Field
                label="Base rent"
                htmlFor="baseRent"
                error={flatForm.formState.errors.baseRent?.message}
                required
              >
                <Input id="baseRent" type="number" min={0} step="0.01" {...flatForm.register('baseRent')} />
              </Field>
            </div>
            <Field label="Building" htmlFor="building" error={flatForm.formState.errors.building?.message} required>
              <Input id="building" {...flatForm.register('building')} />
            </Field>
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button type="submit" form="flat-form" loading={saveFlat.isPending}>
              {editor?.flat ? 'Save changes' : 'Add flat'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign a user */}
      <Dialog open={Boolean(assigning)} onOpenChange={(open) => !open && setAssigning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign a user to flat {assigning?.flatNumber}</DialogTitle>
            <DialogDescription>
              A flat holds one user at a time, and a user holds one flat — anyone already allocated
              is left out of this list.
            </DialogDescription>
          </DialogHeader>

          {users.isLoading ? (
            <LoadingState label="Loading users…" />
          ) : (
            <form
              id="assign-form"
              onSubmit={assignForm.handleSubmit((values) => assign.mutate(values))}
              noValidate
              className="space-y-4"
            >
              <Field label="User" htmlFor="userId" error={assignForm.formState.errors.userId?.message} required>
                <Select id="userId" {...assignForm.register('userId')}>
                  <option value="">Choose an unallocated user…</option>
                  {assignableUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.fullName} · {user.phone}
                      {user.isApproved ? '' : ' (pending approval)'}
                    </option>
                  ))}
                </Select>
              </Field>

              {assignableUsers.length === 0 && (
                <Alert tone="warning" title="No unallocated users">
                  Every user already has a flat. Add a user, or end an existing tenancy first.
                </Alert>
              )}

              <Field
                label="Advance deposit"
                htmlFor="assign-advance"
                error={assignForm.formState.errors.advanceDeposit?.message}
                required
                hint="Used to offset deferred rent later"
              >
                <Input
                  id="assign-advance"
                  type="number"
                  min={0}
                  step="0.01"
                  {...assignForm.register('advanceDeposit')}
                />
              </Field>

              <Field
                label="Start date"
                htmlFor="assign-start"
                error={assignForm.formState.errors.startDate?.message}
                hint="Defaults to today"
              >
                <Input id="assign-start" type="date" {...assignForm.register('startDate')} />
              </Field>
            </form>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssigning(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="assign-form"
              loading={assign.isPending}
              disabled={assignableUsers.length === 0}
            >
              Assign user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* End tenancy */}
      <Dialog open={Boolean(confirmRelease)} onOpenChange={(open) => !open && setConfirmRelease(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End the tenancy on flat {confirmRelease?.flatNumber}?</DialogTitle>
            <DialogDescription>
              {confirmRelease?.tenancies?.[0]?.user.fullName} is released from this flat and the unit
              becomes vacant. Their invoice history is kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRelease(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={release.isPending}
              onClick={() => confirmRelease && release.mutate(confirmRelease.id)}
            >
              End tenancy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete flat */}
      <Dialog open={Boolean(confirmDelete)} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete flat {confirmDelete?.flatNumber}?</DialogTitle>
            <DialogDescription>
              This removes the unit permanently. Invoices already issued against it are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={remove.isPending}
              onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}
            >
              Delete flat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
