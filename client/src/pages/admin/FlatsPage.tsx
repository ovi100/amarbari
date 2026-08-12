import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, Plus, Trash2 } from 'lucide-react';
import { PageHeader, StatCard } from '@/components/StatCard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input } from '@/components/ui/form-controls';
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
import { FlatValues, flatSchema } from '@/lib/schemas';
import type { Flat } from '@/types';

export default function FlatsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Flat | null>(null);

  const flats = useQuery({ queryKey: ['admin', 'flats'], queryFn: adminApi.flats });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FlatValues>({
    resolver: zodResolver(flatSchema),
    defaultValues: { flatNumber: '', floor: 1, building: 'Main Building', baseRent: 0 },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin'] });

  const create = useMutation({
    mutationFn: (values: FlatValues) => adminApi.createFlat(values),
    onSuccess: () => {
      toast.success('Flat added');
      setCreateOpen(false);
      reset();
      invalidate();
    },
    onError: (err) => toast.error('Could not add the flat', errorMessage(err)),
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

  const rows = flats.data ?? [];
  const occupied = rows.filter((f) => f.isOccupied).length;
  const monthlyRent = rows.filter((f) => f.isOccupied).reduce((sum, f) => sum + f.baseRent, 0);

  return (
    <>
      <PageHeader
        title="Flats"
        description="Every unit in the portfolio and who lives in it."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
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
          {flats.isLoading ? (
            <LoadingState label="Loading flats…" />
          ) : flats.isError ? (
            <Alert tone="error" title="Could not load flats">
              {errorMessage(flats.error)}
            </Alert>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No flats yet"
              description="Add your first unit to start allocating tenants."
              action={
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" /> Add flat
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Flat</TableHead>
                  <TableHead>Building</TableHead>
                  <TableHead>Floor</TableHead>
                  <TableHead className="text-right">Base rent</TableHead>
                  <TableHead>Occupancy</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((flat) => {
                  const tenancy = flat.tenancies?.[0];
                  return (
                    <TableRow key={flat.id}>
                      <TableCell className="font-medium">{flat.flatNumber}</TableCell>
                      <TableCell className="text-muted-foreground">{flat.building}</TableCell>
                      <TableCell className="text-muted-foreground">{flat.floor}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(flat.baseRent)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={flat.isOccupied ? 'success' : 'secondary'}>
                          {flat.isOccupied ? 'Occupied' : 'Vacant'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {tenancy ? (
                          <>
                            <p className="text-sm">{tenancy.user.fullName}</p>
                            <p className="text-xs text-muted-foreground">
                              Since {formatDate(tenancy.startDate)}
                            </p>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmDelete(flat)}
                          disabled={flat.isOccupied}
                          aria-label={`Delete flat ${flat.flatNumber}`}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a flat</DialogTitle>
            <DialogDescription>Base rent is what the revenue engine counts as income.</DialogDescription>
          </DialogHeader>

          <form
            id="flat-form"
            onSubmit={handleSubmit((values) => create.mutate(values))}
            noValidate
            className="space-y-4"
          >
            <Field label="Flat number" htmlFor="flatNumber" error={errors.flatNumber?.message} required>
              <Input id="flatNumber" placeholder="A-101" {...register('flatNumber')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Floor" htmlFor="floor" error={errors.floor?.message} required>
                <Input id="floor" type="number" {...register('floor')} />
              </Field>
              <Field label="Base rent" htmlFor="baseRent" error={errors.baseRent?.message} required>
                <Input id="baseRent" type="number" min={0} step="0.01" {...register('baseRent')} />
              </Field>
            </div>
            <Field label="Building" htmlFor="building" error={errors.building?.message} required>
              <Input id="building" {...register('building')} />
            </Field>
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="flat-form" loading={create.isPending}>
              Add flat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
