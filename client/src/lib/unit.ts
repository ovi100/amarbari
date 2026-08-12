import type { RentCategory, Shop, Tenancy, Flat } from '@/types';

/**
 * Flats and shops are separate tables, so a tenancy points at one or the other.
 * This resolves either into one display shape — the client mirror of the
 * server's `unit.service.ts`.
 */
export interface UnitView {
  category: RentCategory;
  /** Flat number or shop number. */
  number: string;
  /** "A-101", or "S-01 · Rahim Store". */
  label: string;
  /** Building for a flat, street address for a shop. */
  location: string;
  baseRent: number;
}

export function unitOf(
  tenancy?: (Tenancy & { flat?: Flat | null; shop?: Shop | null }) | null
): UnitView | null {
  if (!tenancy) return null;
  if (tenancy.flat) {
    return {
      category: 'FLAT',
      number: tenancy.flat.flatNumber,
      label: tenancy.flat.flatNumber,
      location: `${tenancy.flat.building}, floor ${tenancy.flat.floor}`,
      baseRent: tenancy.flat.baseRent,
    };
  }
  if (tenancy.shop) {
    return {
      category: 'SHOP',
      number: tenancy.shop.shopNumber,
      label: `${tenancy.shop.shopNumber} · ${tenancy.shop.shopName}`,
      location: tenancy.shop.address,
      baseRent: tenancy.shop.baseRent,
    };
  }
  return null;
}

/** "flat" / "shop", for copy that reads better with the specific word. */
export const unitNoun = (category: RentCategory) => (category === 'SHOP' ? 'shop' : 'flat');
