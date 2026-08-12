import bcrypt from 'bcryptjs';
import { DynamicColumnType, IdentityType, Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { ApiError } from '../utils/ApiError';
import { identityNumberError, normaliseIdentityNumber } from '../utils/validators';

/**
 * Admin Data Control (SRS 3.2.1).
 *
 * Design note: rather than issuing raw `ALTER TABLE` DDL from an HTTP handler —
 * which is unrecoverable, un-migratable and a trivial denial-of-service on the
 * relational core — admin-defined columns are registered in `DynamicColumn` and
 * their values stored in each model's `customFields` JSONB blob. The SRS
 * explicitly allows this ("...or JSON/PostgreSQL schema extensions"). Native
 * columns remain fully editable through the same API.
 */

export const MANAGED_TABLES = [
  'User',
  'Flat',
  'Shop',
  'Tenancy',
  'Invoice',
  'BuildingExpense',
  'MaintenanceTicket',
  'ChatMessage',
] as const;

export type ManagedTable = (typeof MANAGED_TABLES)[number];

/** Never leaked to the client and never writable through the generic endpoint. */
const HIDDEN_FIELDS: Record<string, string[]> = { User: ['passwordHash'] };

/** Structural fields the generic record editor must not touch. */
const IMMUTABLE_FIELDS = ['id', 'createdAt', 'updatedAt', 'customFields'];

const delegates: Record<ManagedTable, any> = {
  User: prisma.user,
  Flat: prisma.flat,
  Shop: prisma.shop,
  Tenancy: prisma.tenancy,
  Invoice: prisma.invoice,
  BuildingExpense: prisma.buildingExpense,
  MaintenanceTicket: prisma.maintenanceTicket,
  ChatMessage: prisma.chatMessage,
};

export function assertManagedTable(name: string): ManagedTable {
  const match = MANAGED_TABLES.find((t) => t.toLowerCase() === name.toLowerCase());
  if (!match) {
    throw ApiError.badRequest(
      `Unknown or unmanaged table "${name}". Managed tables: ${MANAGED_TABLES.join(', ')}`
    );
  }
  return match;
}

function delegateFor(table: ManagedTable) {
  return delegates[table];
}

export interface ColumnMeta {
  name: string;
  type: string;
  kind: 'scalar' | 'enum' | 'object' | 'unsupported';
  isRequired: boolean;
  isId: boolean;
  isUnique: boolean;
  isList: boolean;
  isReadOnly: boolean;
  isDynamic: boolean;
  enumValues?: string[];
  label?: string;
  defaultValue?: string | null;
}

function enumValues(name: string): string[] | undefined {
  return Prisma.dmmf.datamodel.enums.find((e) => e.name === name)?.values.map((v) => v.name);
}

/** Native column metadata read straight out of the Prisma DMMF. */
export function nativeColumns(table: ManagedTable): ColumnMeta[] {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === table);
  if (!model) throw ApiError.notFound(`Model ${table} not found in schema`);
  const hidden = HIDDEN_FIELDS[table] ?? [];

  return model.fields
    .filter((f) => !hidden.includes(f.name) && f.kind !== 'object')
    .map((f) => ({
      name: f.name,
      type: f.type,
      kind: f.kind as ColumnMeta['kind'],
      isRequired: f.isRequired,
      isId: Boolean(f.isId),
      isUnique: Boolean(f.isUnique),
      isList: f.isList,
      isReadOnly: IMMUTABLE_FIELDS.includes(f.name) || Boolean(f.isId) || Boolean(f.isUpdatedAt),
      isDynamic: false,
      ...(f.kind === 'enum' ? { enumValues: enumValues(f.type) } : {}),
    }));
}

export async function dynamicColumns(table: ManagedTable): Promise<ColumnMeta[]> {
  const rows = await prisma.dynamicColumn.findMany({
    where: { tableName: table },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => ({
    name: row.columnName,
    type: row.type,
    kind: 'scalar' as const,
    isRequired: row.required,
    isId: false,
    isUnique: false,
    isList: false,
    isReadOnly: false,
    isDynamic: true,
    label: row.label,
    defaultValue: row.defaultValue,
  }));
}

export async function describeTable(table: ManagedTable) {
  const [dynamic, count] = await Promise.all([
    dynamicColumns(table),
    delegateFor(table).count(),
  ]);
  return {
    name: table,
    recordCount: count,
    columns: [...nativeColumns(table), ...dynamic],
  };
}

export async function listTables() {
  return Promise.all(MANAGED_TABLES.map((t) => describeTable(t)));
}

export interface QueryOptions {
  page: number;
  pageSize: number;
  search?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

/** Builds a case-insensitive OR filter across every String column of the model. */
function searchFilter(table: ManagedTable, search?: string) {
  if (!search?.trim()) return undefined;
  const stringFields = nativeColumns(table).filter(
    (c) => c.type === 'String' && !c.isList && c.kind === 'scalar'
  );
  if (stringFields.length === 0) return undefined;
  return {
    OR: stringFields.map((f) => ({
      [f.name]: { contains: search.trim(), mode: 'insensitive' as const },
    })),
  };
}

export async function queryTable(table: ManagedTable, options: QueryOptions) {
  const delegate = delegateFor(table);
  const columns = nativeColumns(table);
  const where = searchFilter(table, options.search);

  const sortable = columns.find((c) => c.name === options.sortBy && !c.isDynamic);
  const orderBy = sortable
    ? { [sortable.name]: options.sortDir ?? 'desc' }
    : columns.some((c) => c.name === 'createdAt')
      ? { createdAt: 'desc' as const }
      : { id: 'asc' as const };

  const select = Object.fromEntries(columns.map((c) => [c.name, true]));
  select.customFields = true;

  const [total, rows, dynamic] = await Promise.all([
    delegate.count({ where }),
    delegate.findMany({
      where,
      orderBy,
      select,
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
    }),
    dynamicColumns(table),
  ]);

  // Flatten customFields onto each row and backfill declared defaults so the
  // grid always renders a cell for every registered dynamic column.
  const records = rows.map((row: Record<string, unknown>) => {
    const custom = (row.customFields ?? {}) as Record<string, unknown>;
    const flattened: Record<string, unknown> = { ...row };
    delete flattened.customFields;
    for (const col of dynamic) {
      flattened[col.name] = custom[col.name] ?? coerceDefault(col);
    }
    return flattened;
  });

  return {
    table,
    columns: [...columns, ...dynamic],
    records,
    pagination: {
      page: options.page,
      pageSize: options.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / options.pageSize)),
    },
  };
}

function coerceDefault(col: ColumnMeta): unknown {
  if (col.defaultValue === null || col.defaultValue === undefined) return null;
  return castDynamic(col.defaultValue, col.type as DynamicColumnType, col.name);
}

function castDynamic(value: unknown, type: DynamicColumnType, columnName: string): unknown {
  if (value === null || value === '') return null;
  switch (type) {
    case 'NUMBER': {
      const n = Number(value);
      if (Number.isNaN(n)) throw ApiError.badRequest(`"${columnName}" must be a number`);
      return n;
    }
    case 'BOOLEAN':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 'false') return value === 'true';
      throw ApiError.badRequest(`"${columnName}" must be a boolean`);
    case 'DATE': {
      const d = new Date(value as string);
      if (Number.isNaN(d.getTime())) throw ApiError.badRequest(`"${columnName}" must be a date`);
      return d.toISOString();
    }
    case 'STRING':
    default:
      return String(value);
  }
}

const COLUMN_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,48}$/;

export interface AddColumnInput {
  columnName: string;
  label?: string;
  type: DynamicColumnType;
  required?: boolean;
  defaultValue?: string | null;
}

export async function addColumn(table: ManagedTable, input: AddColumnInput) {
  if (!COLUMN_NAME_PATTERN.test(input.columnName)) {
    throw ApiError.badRequest(
      'Column name must start with a letter and contain only letters, digits and underscores'
    );
  }
  if (nativeColumns(table).some((c) => c.name === input.columnName)) {
    throw ApiError.conflict(`"${input.columnName}" already exists as a native column on ${table}`);
  }
  const existing = await prisma.dynamicColumn.findUnique({
    where: { tableName_columnName: { tableName: table, columnName: input.columnName } },
  });
  if (existing) throw ApiError.conflict(`Column "${input.columnName}" already exists on ${table}`);

  if (input.defaultValue != null && input.defaultValue !== '') {
    castDynamic(input.defaultValue, input.type, input.columnName); // validate up front
  }

  return prisma.dynamicColumn.create({
    data: {
      tableName: table,
      columnName: input.columnName,
      label: input.label?.trim() || input.columnName,
      type: input.type,
      required: input.required ?? false,
      defaultValue: input.defaultValue ?? null,
    },
  });
}

export async function dropColumn(table: ManagedTable, columnName: string) {
  const column = await prisma.dynamicColumn.findUnique({
    where: { tableName_columnName: { tableName: table, columnName } },
  });
  if (!column) throw ApiError.notFound(`Dynamic column "${columnName}" not found on ${table}`);
  await prisma.dynamicColumn.delete({ where: { id: column.id } });
  return { removed: columnName };
}

/**
 * Coerces an inbound value to the native Prisma type of the target column,
 * rejecting anything structural, hidden or type-incompatible.
 */
function castNative(column: ColumnMeta, raw: unknown): unknown {
  if (raw === null || raw === '') {
    if (column.isRequired) throw ApiError.badRequest(`"${column.name}" cannot be empty`);
    return null;
  }

  switch (column.type) {
    case 'String':
      return String(raw);
    case 'Int': {
      const n = Number(raw);
      if (!Number.isInteger(n)) throw ApiError.badRequest(`"${column.name}" must be an integer`);
      return n;
    }
    case 'Float':
    case 'Decimal': {
      const n = Number(raw);
      if (Number.isNaN(n)) throw ApiError.badRequest(`"${column.name}" must be a number`);
      return n;
    }
    case 'Boolean':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 'false') return raw === 'true';
      throw ApiError.badRequest(`"${column.name}" must be a boolean`);
    case 'DateTime': {
      const d = new Date(raw as string);
      if (Number.isNaN(d.getTime())) throw ApiError.badRequest(`"${column.name}" must be a date`);
      return d;
    }
    case 'Json':
      return raw;
    default: {
      if (column.kind === 'enum') {
        const allowed = column.enumValues ?? [];
        if (!allowed.includes(String(raw))) {
          throw ApiError.badRequest(
            `"${column.name}" must be one of: ${allowed.join(', ')}`
          );
        }
        return String(raw);
      }
      return raw;
    }
  }
}

/**
 * Updates any mix of native and admin-defined columns on a single record
 * (SRS 6.2 `PATCH /admin/tables/:tableName/records/:id`).
 */
export async function updateRecord(
  table: ManagedTable,
  id: string,
  payload: Record<string, unknown>
) {
  const delegate = delegateFor(table);
  const native = nativeColumns(table);
  const dynamic = await dynamicColumns(table);
  const hidden = HIDDEN_FIELDS[table] ?? [];

  const existing = await delegate.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound(`${table} record not found`);

  const data: Record<string, unknown> = {};
  const customFields: Record<string, unknown> = {
    ...((existing.customFields as Record<string, unknown> | null) ?? {}),
  };
  let touchedCustom = false;

  for (const [key, value] of Object.entries(payload)) {
    // Password is write-only and must be hashed, never stored raw.
    if (table === 'User' && key === 'password') {
      if (typeof value !== 'string' || value.length < 8) {
        throw ApiError.badRequest('Password must be at least 8 characters');
      }
      data.passwordHash = await bcrypt.hash(value, 12);
      continue;
    }
    if (hidden.includes(key)) {
      throw ApiError.forbidden(`"${key}" cannot be modified through this endpoint`);
    }
    if (IMMUTABLE_FIELDS.includes(key)) {
      throw ApiError.badRequest(`"${key}" is read-only`);
    }

    const nativeColumn = native.find((c) => c.name === key);
    if (nativeColumn) {
      if (nativeColumn.isReadOnly) throw ApiError.badRequest(`"${key}" is read-only`);
      data[key] = castNative(nativeColumn, value);
      continue;
    }

    const dynamicColumn = dynamic.find((c) => c.name === key);
    if (dynamicColumn) {
      const cast = castDynamic(value, dynamicColumn.type as DynamicColumnType, key);
      if (cast === null && dynamicColumn.isRequired) {
        throw ApiError.badRequest(`"${key}" is required`);
      }
      customFields[key] = cast;
      touchedCustom = true;
      continue;
    }

    throw ApiError.badRequest(
      `"${key}" is not a column on ${table}. Register it first via POST /admin/tables/${table}/columns`
    );
  }

  if (touchedCustom) data.customFields = customFields;
  if (Object.keys(data).length === 0) throw ApiError.badRequest('No updatable fields supplied');

  // The generic editor is a back door into the same columns the user form
  // guards, so the identity pairing is re-checked here too. The half that is
  // not being edited comes from the stored record.
  if (table === 'User' && (data.identityType || data.identityNumber)) {
    const identityType = (data.identityType ?? existing.identityType) as IdentityType;
    const identityNumber = String(data.identityNumber ?? existing.identityNumber);
    const message = identityNumberError(identityType, identityNumber);
    if (message) throw ApiError.badRequest(message);
    if (data.identityNumber) data.identityNumber = normaliseIdentityNumber(identityNumber);
  }

  const select = Object.fromEntries(native.map((c) => [c.name, true]));
  select.customFields = true;

  return delegate.update({ where: { id }, data, select });
}

export async function deleteRecord(table: ManagedTable, id: string) {
  await delegateFor(table).delete({ where: { id } });
  return { deleted: id };
}
