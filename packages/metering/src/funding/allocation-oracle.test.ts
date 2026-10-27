import { expect, it } from 'vitest';

import {
  reserveFromLots,
  type AvailableLot,
  type CreditSource,
  type FundingCategory,
  type FundingRequest,
} from '../index.ts';

const categories: readonly FundingCategory[] = ['platform', 'resource', 'development'];
const permissions: readonly (readonly FundingCategory[])[] = [
  ['platform'],
  ['resource'],
  ['development'],
  ['platform', 'resource'],
  ['platform', 'development'],
  ['resource', 'development'],
  categories,
];

type Split = Readonly<Record<FundingCategory, bigint>>;
const amounts = [0n, 1n, 2n];
const demands: readonly Split[] = amounts.flatMap((platform) =>
  amounts.flatMap((resource) => amounts.map<Split>((development) => ({ platform, resource, development }))),
);
const total = (split: Split): bigint => split.platform + split.resource + split.development;
const splits = demands.filter((split) => total(split) <= 2n);

function permittedSplits(allowed: readonly FundingCategory[]): readonly Split[] {
  return splits.filter((split) => categories.every((category) => split[category] === 0n || allowed.includes(category)));
}

function makeLot(id: string, allowed: readonly FundingCategory[], source: CreditSource): AvailableLot {
  return { id, categories: allowed, source, availableUnits: 2n, issuedAt: 0, expiresAt: 10 };
}

function oldestFeasible(first: AvailableLot, second: AvailableLot, demand: Split): bigint | undefined {
  let oldest: bigint | undefined;
  for (const a of permittedSplits(first.categories)) {
    for (const b of permittedSplits(second.categories)) {
      if (!categories.every((category) => a[category] + b[category] === demand[category])) continue;
      const freeUsed = (first.source === 'free' ? total(a) : 0n) + (second.source === 'free' ? total(b) : 0n);
      if (freeUsed > 1n) continue;
      if (oldest === undefined || total(a) > oldest) oldest = total(a);
    }
  }
  return oldest;
}

function checkPair(first: AvailableLot, second: AvailableLot, demand: Split): void {
  const expected = oldestFeasible(first, second, demand);
  const request: FundingRequest = {
    platformUnits: demand.platform,
    resourceUnits: demand.resource,
    developmentUnits: demand.development,
    now: 1,
    route: 'cloud',
    cloudFreeRemainingUnits: 1n,
  };
  if (expected === undefined) {
    expect(() => reserveFromLots([first, second], request)).toThrow('Insufficient eligible');
    return;
  }
  const parts = reserveFromLots([first, second], request);
  for (const category of categories) {
    expect(parts.filter((part) => part.category === category).reduce((sum, part) => sum + part.units, 0n)).toBe(
      demand[category],
    );
  }
  expect(parts.filter((part) => part.lotId === first.id).reduce((sum, part) => sum + part.units, 0n)).toBe(expected);
}

function checkPermissions(first: readonly FundingCategory[], second: readonly FundingCategory[]): number {
  const sources: readonly CreditSource[] = ['free', 'subscription'];
  let cases = 0;
  for (const a of sources) {
    for (const b of sources) {
      for (const demand of demands) {
        checkPair(makeLot('a', first, a), makeLot('b', second, b), demand);
        cases += 1;
      }
    }
  }
  return cases;
}

it('matches exhaustive funding feasibility and earliest-source preference in 5292 bounded cases', () => {
  let cases = 0;
  for (const first of permissions) {
    for (const second of permissions) cases += checkPermissions(first, second);
  }
  expect(cases).toBe(5_292);
});
