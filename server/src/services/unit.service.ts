import { Flat, Prisma, Shop } from '@prisma/client';
import prisma from '../utils/prisma';
import { ApiError } from '../utils/ApiError';

/**
 * Flats and shops are separate tables, so anything that hangs off a rented unit
 * — tenancies, invoices, tickets, expenses — carries a nullable FK to each with
 * exactly one set (enforced by a CHECK constraint per table).
 *
 * That shape would otherwise force a `flat ?? shop` branch into every renderer,
 * exporter, chatbot reply and rent calculation. This module is the single place
 * that branch lives: everything downstream works with a `RentedUnit`.
 */

export type RentCategory = 'FLAT' | 'SHOP';

export interface RentedUnit {
  category: RentCategory;
  id: string;
  /** Flat number or shop number — the identifier a person would quote. */
  number: string;
  /** Display label: "A-101", or "S-12 · Rahim Store". */
  label: string;
  /** Building + floor for a flat, street address for a shop. */
  location: string;
  baseRent: number;
  isOccupied: boolean;
}

/** Included alongside any record that points at a unit. */
export const unitInclude = { flat: true, shop: true } satisfies Prisma.InvoiceInclude;

export function fromFlat(flat: Flat): RentedUnit {
  return {
    category: 'FLAT',
    id: flat.id,
    number: flat.flatNumber,
    label: flat.flatNumber,
    location: `${flat.building}, floor ${flat.floor}`,
    baseRent: flat.baseRent,
    isOccupied: flat.isOccupied,
  };
}

export function fromShop(shop: Shop): RentedUnit {
  return {
    category: 'SHOP',
    id: shop.id,
    number: shop.shopNumber,
    label: `${shop.shopNumber} · ${shop.shopName}`,
    location: shop.address,
    baseRent: shop.baseRent,
    isOccupied: shop.isOccupied,
  };
}

/**
 * The identifying fields only, so callers that `select` a narrow projection
 * (exports, chat previews) can still resolve a unit without loading the row.
 */
export interface UnitSummary {
  category: RentCategory;
  number: string;
  label: string;
  location: string;
}

type FlatFacts = { flatNumber: string; building: string };
type ShopFacts = { shopNumber: string; shopName: string; address: string };

export function summariseFlat(flat: FlatFacts): UnitSummary {
  return {
    category: 'FLAT',
    number: flat.flatNumber,
    label: flat.flatNumber,
    location: flat.building,
  };
}

export function summariseShop(shop: ShopFacts): UnitSummary {
  return {
    category: 'SHOP',
    number: shop.shopNumber,
    label: `${shop.shopNumber} · ${shop.shopName}`,
    location: shop.address,
  };
}

/**
 * Resolves the unit a record points at. Throws if neither side is loaded —
 * which means either the CHECK constraint was bypassed or the caller forgot to
 * `include` both relations. Both are bugs worth surfacing loudly rather than
 * rendering "—" and moving on.
 */
export function describeUnit(record: {
  flat?: FlatFacts | null;
  shop?: ShopFacts | null;
}): UnitSummary {
  const unit = describeUnitOrNull(record);
  if (!unit) {
    throw new Error(
      'Record points at neither a flat nor a shop — include both relations, or check the *_one_unit constraint'
    );
  }
  return unit;
}

/** Same as `describeUnit` but tolerates a genuinely unattached record. */
export function describeUnitOrNull(record: {
  flat?: FlatFacts | null;
  shop?: ShopFacts | null;
}): UnitSummary | null {
  if (record.flat) return summariseFlat(record.flat);
  if (record.shop) return summariseShop(record.shop);
  return null;
}

/** `{ flatId: id }` or `{ shopId: id }` — for where-clauses and writes. */
export function unitRef(category: RentCategory, id: string) {
  return category === 'FLAT' ? { flatId: id } : { shopId: id };
}

/** The unit a tenancy is attached to, as `{ category, id }`. */
export function unitRefOf(record: { flatId?: string | null; shopId?: string | null }): {
  category: RentCategory;
  id: string;
} {
  if (record.flatId) return { category: 'FLAT', id: record.flatId };
  if (record.shopId) return { category: 'SHOP', id: record.shopId };
  throw new Error('Record points at neither a flat nor a shop');
}

/** Loads a unit by category, for validation before writing. */
export async function loadUnit(category: RentCategory, id: string): Promise<RentedUnit> {
  if (category === 'FLAT') {
    const flat = await prisma.flat.findUnique({ where: { id } });
    if (!flat) throw ApiError.notFound('Flat not found');
    return fromFlat(flat);
  }
  const shop = await prisma.shop.findUnique({ where: { id } });
  if (!shop) throw ApiError.notFound('Shop not found');
  return fromShop(shop);
}

/**
 * Which charges appear on an invoice depends on the unit type.
 *
 * Flats are billed for the utilities a household consumes; shops are billed a
 * service and maintenance charge instead of water and internet, which a
 * commercial tenant arranges directly. Adjust here — the API, the form and the
 * PDF all read this table.
 */
export const LINE_ITEMS = {
  FLAT: ['flatRent', 'electricityBill', 'waterBill', 'internetBill', 'utilityBill'],
  SHOP: ['flatRent', 'electricityBill', 'serviceCharge', 'maintenanceCharge'],
} as const satisfies Record<RentCategory, readonly string[]>;

/** Human labels for the line items, for forms and documents. */
export const LINE_ITEM_LABELS: Record<string, string> = {
  flatRent: 'Rent',
  electricityBill: 'Electricity',
  waterBill: 'Water',
  internetBill: 'Internet',
  utilityBill: 'Utility & service',
  serviceCharge: 'Service charge',
  maintenanceCharge: 'Maintenance charge',
  previousDue: 'Previous due',
};

export function lineItemsFor(category: RentCategory): readonly string[] {
  return LINE_ITEMS[category];
}
