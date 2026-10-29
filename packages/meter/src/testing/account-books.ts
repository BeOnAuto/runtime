import type { Standing } from '../licensing/signed-answers.ts';

export interface Books {
  readonly plan: string;
  readonly monthly: number;
  readonly available: number;
  readonly owed: number;
  readonly overage_cap: number;
}

export const freshBooks: Books = { plan: 'free', monthly: 1000, available: 1000, owed: 0, overage_cap: 0 };

export interface Policy {
  readonly version: string;
  readonly warn_after_days: number;
  readonly limit_after_days: number;
  readonly per_day: number;
  readonly per_month: number;
}

export const startingPolicy: Policy = {
  version: '2026-10-28',
  warn_after_days: 14,
  limit_after_days: 28,
  per_day: 15,
  per_month: 75,
};

export function chargedFrom(books: Books, credits: number): Books {
  const fromCredits = Math.min(Math.max(0, books.available), credits);
  return { ...books, available: books.available - fromCredits, owed: books.owed + credits - fromCredits };
}

export function spendableOf({ plan, available, owed, overage_cap: cap }: Books): number {
  return plan === 'free' ? Math.max(0, available) : Math.max(0, available + cap - owed);
}

export function standingOf({ monthly, available, owed, overage_cap: cap }: Books): Standing {
  if (cap > 0 && owed >= cap) return 'capped';
  if (cap > 0 && owed >= cap * 0.8) return 'near_cap';
  if (owed > 0) return 'overage';
  if (available <= 0) return cap > 0 ? 'empty' : 'capped';
  return available < monthly * 0.2 ? 'low' : 'ok';
}
