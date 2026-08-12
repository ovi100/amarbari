import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus, Store, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { PageHeader, StatCard } from '@/components/StatCard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
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
import { AssignFlatValues, ShopValues, assignFlatSchema, shopSchema } from '@/lib/schemas';
import type { Shop } from '@/types';

const blankShop: ShopValues = { shopName: '', shopNumber: '', address: '', baseRent: 0 };

/**
 * Shops are the commercial rent category, managed alongside flats.
 *
 * Mirrors `FlatsPage` deliberately: the two categories are separate tables but
 * the same workflow, so an admin who knows one already knows the other.
 */
export default function ShopsPage() {
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<{ shop: Shop | null } | null>(null);
  const [assigning, setAssigning] = useState<Shop | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Shop | null>(null);
  const [confirmRelease, setConfirmRelease] = useState<Shop | null>(null);

  const shops = useQuery({ queryKey: ['admin', 'shops'], queryFn: () => adminApi.shops() });

  // A user holds one unit in total, across both categories — so anyone already
  // in a flat is excluded here as well.
  const users = useQuery({
    queryKey: ['admin', 'users', 'all'],
    queryFn: () => adminApi.users(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin'] });

  const shopForm = useForm<ShopValues>({
    resolver: zodResolver(shopSchema),
    defaultValues: blankShop,
  });

  const saveShop = useMutation({
    mutationFn: (values: ShopValues) =>
      editor?.shop ? adminApi.updateShop(editor.shop.id, values) : adminApi.createShop(values),
    onSuccess: () => {
      toast.success(editor?.shop ? 'Shop updated' : 'Shop added');
      setEditor(null);
      shopForm.reset(blankShop);
      invalidate();
    },
    onError: (err) =>
      toast.error(editor?.shop ? 'Could not update the shop' : 'Could not add the shop', errorMessage(err)),
  });

  const assignForm = useForm<AssignFlatValues>({
    resolver: zodResolver(assignFlatSchema),
    defaultValues: { userId: '', advanceDeposit: 0, startDate: '' },
  });

  const assign = useMutation({
    mutationFn: (values: AssignFlatValues) =>
      adminApi.assignShop(assigning!.id, {
        userId: values.userId,
        advanceDeposit: values.advanceDeposit,
        startDate: values.startDate || undefined,
      }),
    onSuccess: () => {
      toast.success('User assigned to the shop');
      setAssigning(null);
      assignForm.reset();
      invalidate();
    },
    onError: (err) => toast.error('Could not assign the user', errorMessage(err)),
  });

  const release = useMutation({
    mutationFn: (id: string) => adminApi.releaseShop(id),
    onSuccess: () => {
      toast.success('Tenancy ended', 'The shop is now vacant.');
      setConfirmRelease(null);
      invalidate();
    },
    onError: (err) => toast.error('Could not end the tenancy', errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminApi.deleteShop(id),
    onSuccess: () => {
      toast.success('Shop deleted');
      setConfirmDelete(null);
      invalidate();
    },
    onError: (err) => toast.error('Could not delete the shop', errorMessage(err)),
  });

  const openCreate = () => {
    shopForm.reset(blankShop);
    setEditor({ shop: null });
  };

  const openEdit = (shop: Shop) => {
    shopForm.reset({
      shopName: shop.shopName,
      shopNumber: shop.shopNumber,
      address: shop.address,
      baseRent: shop.baseRent,
    });
    setEditor({ shop });
  };

  const openAssign = (shop: Shop) => {
    assignForm.reset({ userId: '', advanceDeposit: 0, startDate: '' });
    setAssigning(shop);
  };

  const rows = shops.data ?? [];
  const occupied = rows.filter((s) => s.isOccupied).length;
  const monthlyRent = rows.filter((s) => s.isOccupied).reduce((sum, s) => sum + s.baseRent, 0);
  const assignableUsers = (users.data?.users ?? []).filter(
    (user) => !user.tenancy && user.role === 'USER'
  );

  const columns = useMemo<DataTableColumn<Shop>[]>(
    () => [
      {
        id: 'shopNumber',
        header: 'Shop no.',
        sortValue: (shop) => shop.shopNumber,
        cell: (shop) => <span className="font-medium">{shop.shopNumber}</span>,
      },
      {
        id: 'shopName',
        header: 'Shop name',
        sortValue: (shop) => shop.shopName,
        cell: (shop) => shop.shopName,
      },
      {
        id: 'address',
        header: 'Address',
        sortValue: (shop) => shop.address,
        className: 'max-w-[260px]',
        cell: (shop) => (
          <span className="block truncate text-muted-foreground" title={shop.address}>
            {shop.address}
          </span>
        ),
      },
      {
        id: 'baseRent',
        header: 'Base rent',
        align: 'right',
        sortValue: (shop) => shop.baseRent,
        cell: (shop) => <span className="tabular-nums">{formatMoney(shop.baseRent)}</span>,
      },
      {
        id: 'occupancy',
        header: 'Occupancy',
        sortValue: (shop) => (shop.isOccupied ? 'Occupied' : 'Vacant'),
        cell: (shop) => (
          <Badge variant={shop.isOccupied ? 'success' : 'secondary'}>
            {shop.isOccupied ? 'Occupied' : 'Vacant'}
          </Badge>
        ),
      },
      {
        id: 'user',
        header: 'User',
        sortValue: (shop) => shop.tenancies?.[0]?.user.fullName ?? null,
        cell: (shop) => {
          const tenancy = shop.tenancies?.[0];
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
        title="Shops"
        description="Commercial units in the portfolio and who trades from them."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add shop
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Total shops" value={String(rows.length)} icon={Store} />
        <StatCard
          label="Occupied"
          value={`${occupied} / ${rows.length}`}
          hint={`${rows.length - occupied} vacant`}
          tone="primary"
        />
        <StatCard
          label="Contracted monthly rent"
          value={formatMoney(monthlyRent)}
          hint="Base rent of occupied shops"
          tone="success"
        />
      </div>

      <Card>
        <CardContent className="pt-5">
          {shops.isError ? (
            <Alert tone="error" title="Could not load shops">
              {errorMessage(shops.error)}
            </Alert>
          ) : (
            <DataTable
              rows={rows}
              columns={columns}
              getRowId={(shop) => shop.id}
              isLoading={shops.isLoading}
              exportFileName="AmarBari-Shops"
              searchPlaceholder="Search by shop number, name, address or user…"
              searchableText={(shop) =>
                [shop.shopNumber, shop.shopName, shop.address, shop.tenancies?.[0]?.user.fullName ?? ''].join(' ')
              }
              onServerSearch={(query) => adminApi.shops({ search: query })}
              emptyMessage="No shops yet — add your first commercial unit."
              actions={[
                { label: 'Edit', icon: Pencil, onSelect: openEdit },
                {
                  label: 'Assign user',
                  icon: UserPlus,
                  hidden: (shop) => shop.isOccupied,
                  onSelect: openAssign,
                },
                {
                  label: 'End tenancy',
                  icon: UserMinus,
                  hidden: (shop) => !shop.isOccupied,
                  onSelect: setConfirmRelease,
                },
                {
                  label: 'Delete',
                  icon: Trash2,
                  destructive: true,
                  disabled: (shop) => shop.isOccupied,
                  onSelect: setConfirmDelete,
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      {/* Create / edit a shop */}
      <Dialog open={Boolean(editor)} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editor?.shop ? `Edit ${editor.shop.shopNumber}` : 'Add a shop'}</DialogTitle>
            <DialogDescription>
              Base rent is what the revenue engine counts as income from this unit.
            </DialogDescription>
          </DialogHeader>

          <form
            id="shop-form"
            onSubmit={shopForm.handleSubmit((values) => saveShop.mutate(values))}
            noValidate
            className="space-y-4"
          >
            <Field
              label="Shop name"
              htmlFor="shopName"
              error={shopForm.formState.errors.shopName?.message}
              required
              hint="The trading name, as it appears on the shopfront"
            >
              <Input id="shopName" placeholder="Rahim General Store" {...shopForm.register('shopName')} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Shop number"
                htmlFor="shopNumber"
                error={shopForm.formState.errors.shopNumber?.message}
                required
              >
                <Input id="shopNumber" placeholder="S-01" {...shopForm.register('shopNumber')} />
              </Field>
              <Field
                label="Base rent"
                htmlFor="shopBaseRent"
                error={shopForm.formState.errors.baseRent?.message}
                required
              >
                <Input id="shopBaseRent" type="number" min={0} step="0.01" {...shopForm.register('baseRent')} />
              </Field>
            </div>

            <Field
              label="Address"
              htmlFor="address"
              error={shopForm.formState.errors.address?.message}
              required
            >
              <Textarea id="address" rows={2} placeholder="12 Mirpur Road, Dhaka" {...shopForm.register('address')} />
            </Field>
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button type="submit" form="shop-form" loading={saveShop.isPending}>
              {editor?.shop ? 'Save changes' : 'Add shop'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign a user */}
      <Dialog open={Boolean(assigning)} onOpenChange={(open) => !open && setAssigning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign a user to {assigning?.shopNumber}</DialogTitle>
            <DialogDescription>
              A user holds one unit at a time across the whole portfolio, so anyone already in a flat
              or another shop is left out of this list.
            </DialogDescription>
          </DialogHeader>

          {users.isLoading ? (
            <LoadingState label="Loading users…" />
          ) : (
            <form
              id="assign-shop-form"
              onSubmit={assignForm.handleSubmit((values) => assign.mutate(values))}
              noValidate
              className="space-y-4"
            >
              <Field
                label="User"
                htmlFor="shopUserId"
                error={assignForm.formState.errors.userId?.message}
                required
              >
                <Select id="shopUserId" {...assignForm.register('userId')}>
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
                  Every user already holds a unit. Add a user, or end an existing tenancy first.
                </Alert>
              )}

              <Field
                label="Advance deposit"
                htmlFor="shopAdvance"
                error={assignForm.formState.errors.advanceDeposit?.message}
                required
                hint="Used to offset deferred rent later"
              >
                <Input
                  id="shopAdvance"
                  type="number"
                  min={0}
                  step="0.01"
                  {...assignForm.register('advanceDeposit')}
                />
              </Field>

              <Field
                label="Start date"
                htmlFor="shopStart"
                error={assignForm.formState.errors.startDate?.message}
                hint="Defaults to today"
              >
                <Input id="shopStart" type="date" {...assignForm.register('startDate')} />
              </Field>
            </form>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssigning(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="assign-shop-form"
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
            <DialogTitle>End the tenancy on {confirmRelease?.shopNumber}?</DialogTitle>
            <DialogDescription>
              {confirmRelease?.tenancies?.[0]?.user.fullName} is released from this shop and the unit
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

      {/* Delete shop */}
      <Dialog open={Boolean(confirmDelete)} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {confirmDelete?.shopNumber}?</DialogTitle>
            <DialogDescription>
              This removes {confirmDelete?.shopName} permanently. Invoices already issued against it
              are kept.
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
              Delete shop
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
