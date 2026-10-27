import { checkedCreditUnits } from '../quantities/credits.ts';

export type FundingCategory = 'platform' | 'resource' | 'development';
export type CreditSource = 'welcome' | 'free' | 'subscription' | 'topup' | 'enterprise' | 'adjustment';

export interface AvailableLot {
  readonly id: string;
  readonly source: CreditSource;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly availableUnits: bigint;
  readonly categories: readonly FundingCategory[];
}

export interface FundingRequest {
  readonly platformUnits: bigint;
  readonly resourceUnits: bigint;
  readonly developmentUnits: bigint;
  readonly route: 'cloud' | 'customer-hosted';
  readonly cloudFreeRemainingUnits: bigint;
  readonly now: number;
}

export interface LotReservation {
  readonly lotId: string;
  readonly category: FundingCategory;
  readonly units: bigint;
}

function validTime(time: number): void {
  if (!Number.isSafeInteger(time) || time < 0) throw new RangeError('Funding times must be safe non-negative integers');
}

function validLot(lot: AvailableLot): void {
  if (lot.id.length === 0 || lot.id.length > 512) throw new RangeError('A source lot needs a bounded identifier');
  validTime(lot.issuedAt);
  validTime(lot.expiresAt);
  if (lot.expiresAt <= lot.issuedAt) throw new RangeError('A source lot must expire after issuance');
  if (lot.categories.length === 0 || new Set(lot.categories).size !== lot.categories.length) {
    throw new RangeError('A source lot needs distinct permitted charge categories');
  }
  checkedCreditUnits(lot.availableUnits);
}

export function usableLots(lots: readonly AvailableLot[], request: FundingRequest): readonly AvailableLot[] {
  validTime(request.now);
  checkedCreditUnits(request.cloudFreeRemainingUnits);
  if (lots.length > 1_024 || new Set(lots.map((lot) => lot.id)).size !== lots.length) {
    throw new RangeError('Funding requires at most 1024 uniquely identified source lots');
  }
  for (const lot of lots) validLot(lot);
  return lots
    .filter((lot) => lot.issuedAt <= request.now && lot.expiresAt > request.now && lot.availableUnits > 0n)
    .toSorted((first, second) => {
      if (first.expiresAt !== second.expiresAt) return first.expiresAt - second.expiresAt;
      if (first.issuedAt !== second.issuedAt) return first.issuedAt - second.issuedAt;
      return first.id < second.id ? -1 : 1;
    });
}
