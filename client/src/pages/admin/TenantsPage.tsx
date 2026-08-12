import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Home, Trash2, UserX, Users } from 'lucide-react';
import { PageHeader } from '@/components/StatCard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select } from '@/components/ui/form-controls';
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
import { formatDate, formatMoney, humanise } from '@/lib/utils';
import { toast } from '@/store/toast.store';
import { TenancyValues, tenancySchema } from '@/lib/schemas';
import type { User } from '@/types';

type Filter = 'all' | 'pending' | 'approved';

export default function TenantsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [allocating, setAllocating] = useState<User | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);

  const tenants = useQuery({
    queryKey: ['admin', 'tenants', filter],
    queryFn: () => adminApi.tenants(filter === 'all' ? {} : { status: filter }),
  });

  const flats = useQuery({ queryKey: ['admin', 'flats'], queryFn: adminApi.flats });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'flats'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'analytics'] });
  };

  const approval = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) =>
      adminApi.setApproval(id, approved),
    onSuccess: (result) => {
      toast.success(result.message);
      invalidate();
    },
    onError: (err) => toast.error('Could not update approval', errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminApi.deleteTenant(id),
    onSuccess: () => {
      toast.success('Tenant removed');
      setConfirmDelete(null);
      invalidate();
    },
    onError: (err) => toast.error('Could not remove the tenant', errorMessage(err)),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TenancyValues>({
    resolver: zodResolver(tenancySchema),
    defaultValues: { userId: '', flatId: '', advanceDeposit: 0, startDate: '' },
  });

  const allocate = useMutation({
    mutationFn: (values: TenancyValues) =>
      adminApi.createTenancy({
        userId: values.userId,
        flatId: values.flatId,
        advanceDeposit: values.advanceDeposit,
        startDate: values.startDate || undefined,
      }),
    onSuccess: () => {
      toast.success('Flat allocated');
      setAllocating(null);
      reset();
      invalidate();
    },
    onError: (err) => toast.error('Could not allocate the flat', errorMessage(err)),
  });

  const vacantFlats = (flats.data ?? []).filter((flat) => !flat.isOccupied);
  const rows = tenants.data?.tenants ?? [];

  return (
    <>
      <PageHeader
        title="Tenants"
        description="Review registrations, verify identity documents and allocate flats."
        actions={
          <div className="flex gap-1 rounded-md border p-1">
            {(['all', 'pending', 'approved'] as Filter[]).map((option) => (
              <Button
                key={option}
                size="sm"
                variant={filter === option ? 'default' : 'ghost'}
                onClick={() => setFilter(option)}
              >
                {humanise(option)}
              </Button>
            ))}
          </div>
        }
      />

      <Card>
        <CardContent className="pt-5">
          {tenants.isLoading ? (
            <LoadingState label="Loading tenants…" />
          ) : tenants.isError ? (
            <Alert tone="error" title="Could not load tenants">
              {errorMessage(tenants.error)}
            </Alert>
          ) : rows.length === 0 ? (
            <EmptyState icon={Users} title="No tenants in this view" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Identity</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Flat</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableEmpty colSpan={6}>Nothing here.</TableEmpty>
                ) : (
                  rows.map((tenant) => (
                    <TableRow key={tenant.id}>
                      <TableCell>
                        <p className="font-medium">{tenant.fullName}</p>
                        <p className="text-xs text-muted-foreground">{tenant.phone}</p>
                        <p className="text-xs text-muted-foreground">
                          {tenant.familyMembers} in family · joined {formatDate(tenant.createdAt)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs font-medium">{humanise(tenant.identityType)}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {tenant.identityNumber}
                        </p>
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        <p className="truncate text-xs text-muted-foreground">
                          {tenant.village}, {tenant.postOffice}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {tenant.policeStation}, {tenant.district}, {tenant.division}
                        </p>
                      </TableCell>
                      <TableCell>
                        {tenant.tenancy ? (
                          <>
                            <p className="text-sm font-medium">{tenant.tenancy.flat.flatNumber}</p>
                            <p className="text-xs text-muted-foreground">
                              Advance {formatMoney(tenant.tenancy.advanceDeposit)}
                            </p>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">Unallocated</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant={tenant.isApproved ? 'success' : 'warning'}>
                            {tenant.isApproved ? 'Approved' : 'Pending'}
                          </Badge>
                          {!tenant.isPhoneVerified && (
                            <Badge variant="destructive">Phone unverified</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {tenant.isApproved ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => approval.mutate({ id: tenant.id, approved: false })}
                              aria-label={`Revoke access for ${tenant.fullName}`}
                            >
                              <UserX className="h-3.5 w-3.5" /> Revoke
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="success"
                              onClick={() => approval.mutate({ id: tenant.id, approved: true })}
                              aria-label={`Approve ${tenant.fullName}`}
                            >
                              <Check className="h-3.5 w-3.5" /> Approve
                            </Button>
                          )}
                          {!tenant.tenancy && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                reset({
                                  userId: tenant.id,
                                  flatId: '',
                                  advanceDeposit: 0,
                                  startDate: '',
                                });
                                setAllocating(tenant);
                              }}
                            >
                              <Home className="h-3.5 w-3.5" /> Allocate
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmDelete(tenant)}
                            aria-label={`Delete ${tenant.fullName}`}
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
          )}
        </CardContent>
      </Card>

      {/* Allocate a flat */}
      <Dialog open={Boolean(allocating)} onOpenChange={(open) => !open && setAllocating(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Allocate a flat</DialogTitle>
            <DialogDescription>
              Assign {allocating?.fullName} to a vacant flat and record their advance deposit.
            </DialogDescription>
          </DialogHeader>

          <form
            id="allocate-form"
            onSubmit={handleSubmit((values) => allocate.mutate(values))}
            noValidate
            className="space-y-4"
          >
            <input type="hidden" {...register('userId')} />

            <Field label="Flat" htmlFor="flatId" error={errors.flatId?.message} required>
              <Select id="flatId" {...register('flatId')}>
                <option value="">Choose a vacant flat…</option>
                {vacantFlats.map((flat) => (
                  <option key={flat.id} value={flat.id}>
                    {flat.flatNumber} · Floor {flat.floor} · {formatMoney(flat.baseRent)}
                  </option>
                ))}
              </Select>
            </Field>

            {vacantFlats.length === 0 && (
              <Alert tone="warning" title="No vacant flats">
                Every flat is currently occupied. End a tenancy or add a new flat first.
              </Alert>
            )}

            <Field
              label="Advance deposit"
              htmlFor="advanceDeposit"
              error={errors.advanceDeposit?.message}
              required
              hint="Used to offset deferred rent later"
            >
              <Input id="advanceDeposit" type="number" min={0} step="0.01" {...register('advanceDeposit')} />
            </Field>

            <Field label="Start date" htmlFor="startDate" error={errors.startDate?.message}
              hint="Defaults to today">
              <Input id="startDate" type="date" {...register('startDate')} />
            </Field>
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAllocating(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="allocate-form"
              loading={allocate.isPending}
              disabled={vacantFlats.length === 0}
            >
              Allocate flat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={Boolean(confirmDelete)} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {confirmDelete?.fullName}?</DialogTitle>
            <DialogDescription>
              This permanently removes the tenant, their tenancy, tickets and chat history. Their
              flat is released. This cannot be undone.
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
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
