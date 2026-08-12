import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Home, Pencil, Plus, Trash2, UserX } from 'lucide-react';
import { PageHeader } from '@/components/StatCard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, PasswordInput, Select } from '@/components/ui/form-controls';
import { Alert, LoadingState } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/segmented';
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
import { formatDate, formatMoney, humanise } from '@/lib/utils';
import { toast } from '@/store/toast.store';
import {
  AdminUserValues,
  TenancyValues,
  buildUserSchema,
  tenancySchema,
} from '@/lib/schemas';
import { IDENTITY_RULES } from '@/lib/identity';
import { unitOf } from '@/lib/unit';
import type { IdentityType, User } from '@/types';

type Filter = 'all' | 'pending' | 'approved';

const DIVISIONS = [
  'Dhaka', 'Chattogram', 'Khulna', 'Rajshahi',
  'Barishal', 'Sylhet', 'Rangpur', 'Mymensingh',
];

const blankUser: AdminUserValues = {
  fullName: '',
  phone: '',
  password: '',
  dob: '',
  familyMembers: 1,
  identityType: 'NID',
  identityNumber: '',
  village: '',
  postOffice: '',
  district: '',
  policeStation: '',
  division: 'Dhaka',
  role: 'USER',
  isApproved: true,
  isPhoneVerified: true,
};

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; user: User | null } | null>(null);
  const [allocating, setAllocating] = useState<User | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);

  const users = useQuery({
    queryKey: ['admin', 'users', filter],
    queryFn: () => adminApi.users(filter === 'all' ? {} : { status: filter }),
  });

  const flats = useQuery({ queryKey: ['admin', 'flats'], queryFn: () => adminApi.flats() });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'flats'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'analytics'] });
  };

  // --- Mutations ------------------------------------------------------------

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
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => {
      toast.success('User removed');
      setConfirmDelete(null);
      invalidate();
    },
    onError: (err) => toast.error('Could not remove the user', errorMessage(err)),
  });

  const mode = editor?.mode ?? 'create';
  const userForm = useForm<AdminUserValues>({
    resolver: zodResolver(buildUserSchema(mode)),
    defaultValues: blankUser,
  });

  // The identity field's shape, hint and length cap follow the chosen document.
  const identityRule =
    IDENTITY_RULES[userForm.watch('identityType')] ?? IDENTITY_RULES.NID;

  const saveUser = useMutation({
    mutationFn: (values: AdminUserValues) => {
      const payload = {
        ...values,
        dob: values.dob || undefined,
        // On edit an empty password field means "leave it alone".
        password: values.password || undefined,
      };
      return editor?.user
        ? adminApi.updateUser(editor.user.id, payload)
        : adminApi.createUser({ ...payload, password: values.password });
    },
    onSuccess: () => {
      toast.success(editor?.user ? 'User updated' : 'User created');
      setEditor(null);
      userForm.reset(blankUser);
      invalidate();
    },
    onError: (err) =>
      toast.error(editor?.user ? 'Could not update the user' : 'Could not create the user', errorMessage(err)),
  });

  const allocateForm = useForm<TenancyValues>({
    resolver: zodResolver(tenancySchema),
    defaultValues: { userId: '', flatId: '', advanceDeposit: 0, startDate: '' },
  });

  const allocate = useMutation({
    mutationFn: (values: TenancyValues) =>
      adminApi.assignFlat(values.flatId, {
        userId: values.userId,
        advanceDeposit: values.advanceDeposit,
        startDate: values.startDate || undefined,
      }),
    onSuccess: () => {
      toast.success('Flat allocated');
      setAllocating(null);
      allocateForm.reset();
      invalidate();
    },
    onError: (err) => toast.error('Could not allocate the flat', errorMessage(err)),
  });

  // --- Dialog openers -------------------------------------------------------

  const openCreate = () => {
    userForm.reset(blankUser);
    setEditor({ mode: 'create', user: null });
  };

  const openEdit = (user: User) => {
    userForm.reset({
      fullName: user.fullName,
      // The API stores +8801… but the form validates either shape.
      phone: user.phone,
      password: '',
      dob: user.dob ? user.dob.slice(0, 10) : '',
      familyMembers: user.familyMembers,
      identityType: user.identityType,
      identityNumber: user.identityNumber,
      village: user.village,
      postOffice: user.postOffice,
      district: user.district,
      policeStation: user.policeStation,
      division: user.division,
      role: user.role,
      isApproved: user.isApproved,
      isPhoneVerified: user.isPhoneVerified,
    });
    setEditor({ mode: 'edit', user });
  };

  const openAllocate = (user: User) => {
    allocateForm.reset({ userId: user.id, flatId: '', advanceDeposit: 0, startDate: '' });
    setAllocating(user);
  };

  // --- Table ----------------------------------------------------------------

  const rows = users.data?.users ?? [];
  const vacantFlats = (flats.data ?? []).filter((flat) => !flat.isOccupied);

  const columns = useMemo<DataTableColumn<User>[]>(
    () => [
      {
        id: 'fullName',
        header: 'User',
        sortValue: (user) => user.fullName,
        cell: (user) => (
          <>
            <p className="font-medium">{user.fullName}</p>
            <p className="text-xs text-muted-foreground">{user.phone}</p>
            <p className="text-xs text-muted-foreground">
              {user.familyMembers} in family · joined {formatDate(user.createdAt)}
            </p>
          </>
        ),
      },
      {
        id: 'identity',
        header: 'Identity',
        sortValue: (user) => user.identityNumber,
        exportValue: (user) => `${humanise(user.identityType)} ${user.identityNumber}`,
        cell: (user) => (
          <>
            <p className="text-xs font-medium">{humanise(user.identityType)}</p>
            <p className="font-mono text-xs text-muted-foreground">{user.identityNumber}</p>
          </>
        ),
      },
      {
        id: 'address',
        header: 'Address',
        sortValue: (user) => user.district,
        exportValue: (user) =>
          `${user.village}, ${user.postOffice}, ${user.policeStation}, ${user.district}, ${user.division}`,
        className: 'max-w-[220px]',
        cell: (user) => (
          <>
            <p className="truncate text-xs text-muted-foreground">
              {user.village}, {user.postOffice}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {user.policeStation}, {user.district}, {user.division}
            </p>
          </>
        ),
      },
      {
        id: 'unit',
        header: 'Unit',
        sortValue: (user) => unitOf(user.tenancy)?.number ?? null,
        cell: (user) =>
          user.tenancy ? (
            <>
              {/* A user holds a flat or a shop — one label covers both. */}
              <p className="text-sm font-medium">{unitOf(user.tenancy)?.label ?? '—'}</p>
              <p className="text-xs text-muted-foreground">
                Advance {formatMoney(user.tenancy.advanceDeposit)}
              </p>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Unallocated</span>
          ),
      },
      {
        id: 'status',
        header: 'Status',
        sortValue: (user) => (user.isApproved ? 'Approved' : 'Pending'),
        cell: (user) => (
          <div className="flex flex-col items-start gap-1">
            <Badge variant={user.isApproved ? 'success' : 'warning'}>
              {user.isApproved ? 'Approved' : 'Pending'}
            </Badge>
            {!user.isPhoneVerified && <Badge variant="destructive">Phone unverified</Badge>}
          </div>
        ),
      },
    ],
    []
  );

  return (
    <>
      <PageHeader
        title="Users"
        description="Review registrations, verify identity documents, manage accounts and allocate flats."
        actions={
          <>
            <Segmented
              size="sm"
              aria-label="Filter users by approval status"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'pending', label: 'Pending' },
                { value: 'approved', label: 'Approved' },
              ]}
            />
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add user
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="pt-5">
          {users.isError ? (
            <Alert tone="error" title="Could not load users">
              {errorMessage(users.error)}
            </Alert>
          ) : (
            <DataTable
              rows={rows}
              columns={columns}
              getRowId={(user) => user.id}
              isLoading={users.isLoading}
              exportFileName="AmarBari-Users"
              searchPlaceholder="Search by name, phone, identity or address…"
              searchableText={(user) =>
                [
                  user.fullName,
                  user.phone,
                  user.identityNumber,
                  user.village,
                  user.postOffice,
                  user.policeStation,
                  user.district,
                  user.division,
                  unitOf(user.tenancy)?.label ?? '',
                ].join(' ')
              }
              onServerSearch={async (query) => (await adminApi.users({ search: query })).users}
              emptyMessage="No users in this view."
              actions={[
                {
                  label: 'Approve',
                  icon: Check,
                  hidden: (user) => user.isApproved,
                  onSelect: (user) => approval.mutate({ id: user.id, approved: true }),
                },
                {
                  label: 'Revoke access',
                  icon: UserX,
                  hidden: (user) => !user.isApproved,
                  onSelect: (user) => approval.mutate({ id: user.id, approved: false }),
                },
                { label: 'Edit', icon: Pencil, onSelect: openEdit },
                {
                  label: 'Allocate flat',
                  icon: Home,
                  hidden: (user) => Boolean(user.tenancy) || user.role === 'ADMIN',
                  onSelect: openAllocate,
                },
                { label: 'Delete', icon: Trash2, destructive: true, onSelect: setConfirmDelete },
              ]}
            />
          )}
        </CardContent>
      </Card>

      {/* Create / edit a user */}
      <Dialog open={Boolean(editor)} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editor?.user ? `Edit ${editor.user.fullName}` : 'Add a user'}</DialogTitle>
            <DialogDescription>
              {editor?.user
                ? 'Leave the password blank to keep the current one.'
                : 'Accounts created here skip self-registration and are approved straight away.'}
            </DialogDescription>
          </DialogHeader>

          <form
            id="user-form"
            onSubmit={userForm.handleSubmit((values) => saveUser.mutate(values))}
            noValidate
            className="max-h-[60vh] space-y-5 overflow-y-auto pr-1"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="fullName" error={userForm.formState.errors.fullName?.message} required>
                <Input id="fullName" {...userForm.register('fullName')} />
              </Field>
              <Field label="Phone number" htmlFor="user-phone" error={userForm.formState.errors.phone?.message} required>
                <Input id="user-phone" type="tel" placeholder="01712345678" {...userForm.register('phone')} />
              </Field>
              <Field
                label={editor?.user ? 'New password' : 'Password'}
                htmlFor="user-password"
                error={userForm.formState.errors.password?.message}
                required={!editor?.user}
                hint={editor?.user ? 'Leave blank to keep the existing password' : 'At least 8 characters, with a letter and a number'}
              >
                <PasswordInput
                  id="user-password"
                  autoComplete="new-password"
                  {...userForm.register('password')}
                />
              </Field>
              <Field label="Date of birth" htmlFor="user-dob" error={userForm.formState.errors.dob?.message}>
                <Input id="user-dob" type="date" {...userForm.register('dob')} />
              </Field>
              <Field
                label="Family members"
                htmlFor="familyMembers"
                error={userForm.formState.errors.familyMembers?.message}
                required
              >
                <Input id="familyMembers" type="number" min={1} max={30} {...userForm.register('familyMembers')} />
              </Field>
              <Field label="Role" htmlFor="role" error={userForm.formState.errors.role?.message} required>
                <Select id="role" {...userForm.register('role')}>
                  <option value="USER">Resident / shopkeeper</option>
                  <option value="ADMIN">Property admin</option>
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Identity type"
                htmlFor="identityType"
                error={userForm.formState.errors.identityType?.message}
                required
              >
                <Select id="identityType" {...userForm.register('identityType')}>
                  {(Object.keys(IDENTITY_RULES) as IdentityType[]).map((type) => (
                    <option key={type} value={type}>
                      {IDENTITY_RULES[type].label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Identity number"
                htmlFor="identityNumber"
                error={userForm.formState.errors.identityNumber?.message}
                required
                hint={identityRule.hint}
              >
                <Input
                  id="identityNumber"
                  inputMode={identityRule.inputMode}
                  maxLength={identityRule.maxLength}
                  placeholder={identityRule.placeholder}
                  autoComplete="off"
                  {...userForm.register('identityNumber')}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Village / street" htmlFor="village" error={userForm.formState.errors.village?.message} required>
                <Input id="village" {...userForm.register('village')} />
              </Field>
              <Field label="Post office" htmlFor="postOffice" error={userForm.formState.errors.postOffice?.message} required>
                <Input id="postOffice" {...userForm.register('postOffice')} />
              </Field>
              <Field
                label="Police station (thana)"
                htmlFor="policeStation"
                error={userForm.formState.errors.policeStation?.message}
                required
              >
                <Input id="policeStation" {...userForm.register('policeStation')} />
              </Field>
              <Field label="District" htmlFor="district" error={userForm.formState.errors.district?.message} required>
                <Input id="district" {...userForm.register('district')} />
              </Field>
              <Field label="Division" htmlFor="division" error={userForm.formState.errors.division?.message} required>
                <Select id="division" {...userForm.register('division')}>
                  {DIVISIONS.map((division) => (
                    <option key={division} value={division}>
                      {division}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="flex flex-wrap gap-5 border-t pt-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[hsl(var(--primary))]"
                  {...userForm.register('isApproved')}
                />
                Approved — may sign in
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[hsl(var(--primary))]"
                  {...userForm.register('isPhoneVerified')}
                />
                Phone already verified
              </label>
            </div>
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button type="submit" form="user-form" loading={saveUser.isPending}>
              {editor?.user ? 'Save changes' : 'Create user'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Allocate a flat */}
      <Dialog open={Boolean(allocating)} onOpenChange={(open) => !open && setAllocating(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Allocate a flat</DialogTitle>
            <DialogDescription>
              Assign {allocating?.fullName} to a vacant flat and record their advance deposit.
            </DialogDescription>
          </DialogHeader>

          {flats.isLoading ? (
            <LoadingState label="Loading flats…" />
          ) : (
            <form
              id="allocate-form"
              onSubmit={allocateForm.handleSubmit((values) => allocate.mutate(values))}
              noValidate
              className="space-y-4"
            >
              <input type="hidden" {...allocateForm.register('userId')} />

              <Field label="Flat" htmlFor="flatId" error={allocateForm.formState.errors.flatId?.message} required>
                <Select id="flatId" {...allocateForm.register('flatId')}>
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
                error={allocateForm.formState.errors.advanceDeposit?.message}
                required
                hint="Used to offset deferred rent later"
              >
                <Input
                  id="advanceDeposit"
                  type="number"
                  min={0}
                  step="0.01"
                  {...allocateForm.register('advanceDeposit')}
                />
              </Field>

              <Field
                label="Start date"
                htmlFor="startDate"
                error={allocateForm.formState.errors.startDate?.message}
                hint="Defaults to today"
              >
                <Input id="startDate" type="date" {...allocateForm.register('startDate')} />
              </Field>
            </form>
          )}

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
              This permanently removes the user, their tenancy, tickets and chat history. Their flat
              is released. This cannot be undone.
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
