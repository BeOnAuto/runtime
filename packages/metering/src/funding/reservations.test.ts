import { describe, expect, it } from 'vitest';

import { creditUnits, MOST_CREDIT_UNITS, reserveFromLots, type AvailableLot, type FundingRequest } from '../index.ts';

function lot(id: string, available = '75'): AvailableLot {
  return {
    id,
    source: 'subscription',
    issuedAt: 0,
    expiresAt: 10_000,
    availableUnits: creditUnits(available),
    categories: ['platform', 'resource', 'development'],
  };
}

function request(platform = '1', resources = '0', development = '0'): FundingRequest {
  return {
    platformUnits: creditUnits(platform),
    resourceUnits: creditUnits(resources),
    developmentUnits: creditUnits(development),
    route: 'cloud',
    cloudFreeRemainingUnits: creditUnits('15'),
    now: 1_000,
  };
}

describe('source-lot reservations', () => {
  it('reserves each category from an eligible source without changing the caller snapshot', () => {
    const source = Object.freeze(lot('paid'));
    expect(reserveFromLots([source], request('1', '2', '3'))).toEqual([
      { lotId: 'paid', category: 'resource', units: creditUnits('2') },
      { lotId: 'paid', category: 'development', units: creditUnits('3') },
      { lotId: 'paid', category: 'platform', units: creditUnits('1') },
    ]);
    expect(source.availableUnits).toBe(creditUnits('75'));
  });

  it('uses expiry, then issue time, then lot ID independently of input order', () => {
    const first = { ...lot('first', '1'), expiresAt: 2_000 };
    const older = lot('older', '1');
    const a = { ...lot('a', '1'), issuedAt: 1 };
    const b = { ...lot('b', '1'), issuedAt: 1 };
    for (const lots of [
      [b, a, older, first],
      [first, older, a, b],
      [a, b, first, older],
    ]) {
      expect(reserveFromLots(lots, request('4')).map((part) => part.lotId)).toEqual(['first', 'older', 'a', 'b']);
    }
  });

  it('preserves eligible funds for resources even when an earlier assignment must move', () => {
    const flexible = lot('flexible', '1');
    const platform: AvailableLot = { ...lot('platform', '1'), expiresAt: 20_000, categories: ['platform'] };
    expect(reserveFromLots([flexible, platform], request('1', '1'))).toEqual([
      { lotId: 'flexible', category: 'resource', units: creditUnits('1') },
      { lotId: 'platform', category: 'platform', units: creditUnits('1') },
    ]);
  });

  it('refuses resources when only platform-only Enterprise credits remain', () => {
    const enterprise: AvailableLot = { ...lot('contract'), source: 'enterprise', categories: ['platform'] };
    expect(() => reserveFromLots([enterprise], request('0', '1'))).toThrow('Insufficient eligible credits');
  });
});

describe('shared Free allowance', () => {
  it('caps Cloud recurring Free reservations across charge categories and all source lots', () => {
    const free: AvailableLot = { ...lot('free'), source: 'free' };
    expect(() => reserveFromLots([free], request('10', '6'))).toThrow('daily allowance');
    expect(reserveFromLots([free], request('10', '5')).reduce((sum, part) => sum + part.units, 0n)).toBe(
      creditUnits('15'),
    );
    const another: AvailableLot = { ...free, id: 'another-free' };
    expect(() => reserveFromLots([free, another], request('16'))).toThrow('daily allowance');
  });

  it('does not apply the Cloud day quota to welcome or purchased credits', () => {
    const free: AvailableLot = { ...lot('free'), source: 'free' };
    const welcome: AvailableLot = { ...lot('welcome', '100'), source: 'welcome', expiresAt: 20_000 };
    expect(reserveFromLots([free, welcome], request('20'))).toEqual([
      { lotId: 'free', category: 'platform', units: creditUnits('15') },
      { lotId: 'welcome', category: 'platform', units: creditUnits('5') },
    ]);
    expect(reserveFromLots([welcome], { ...request(), cloudFreeRemainingUnits: 0n })[0]?.units).toBe(creditUnits('1'));
  });

  it('uses the same monthly lot for customer-hosted work without the Cloud day restriction', () => {
    const free: AvailableLot = { ...lot('free'), source: 'free' };
    expect(reserveFromLots([free], { ...request('75'), route: 'customer-hosted' })[0]?.units).toBe(creditUnits('75'));
    expect(() => reserveFromLots([free], { ...request('76'), route: 'customer-hosted' })).toThrow('shared balance');
  });
});

describe('source priority under a shared free cap', () => {
  it('prioritizes earliest expiry even when a free-budget reassignment would be cheaper in rank sum', () => {
    const first: AvailableLot = {
      ...lot('first-free', '1'),
      source: 'free',
      categories: ['platform'],
      expiresAt: 2_000,
    };
    const middle: AvailableLot = { ...lot('paid-platform', '1'), categories: ['platform'], expiresAt: 3_000 };
    const otherFree: AvailableLot = {
      ...lot('later-free', '1'),
      source: 'free',
      categories: ['resource'],
      expiresAt: 4_000,
    };
    const last: AvailableLot = { ...lot('last-paid', '1'), categories: ['resource'], expiresAt: 8_000 };
    const parts = reserveFromLots([first, middle, otherFree, last], {
      ...request('1', '1'),
      cloudFreeRemainingUnits: creditUnits('1'),
    });
    expect(parts.map((part) => part.lotId)).toEqual(['first-free', 'last-paid']);
    const necessary = reserveFromLots([first, middle, otherFree], {
      ...request('1', '1'),
      cloudFreeRemainingUnits: creditUnits('1'),
    });
    expect(necessary.map((part) => part.lotId)).toEqual(['paid-platform', 'later-free']);
  });
});

describe('lot validity and quantity bounds', () => {
  it('admits no new work against future, expired or already-unavailable credits', () => {
    const lots = [{ ...lot('future'), issuedAt: 1_001 }, { ...lot('expired'), expiresAt: 1_000 }, lot('empty', '0')];
    expect(() => reserveFromLots(lots, request())).toThrow('Insufficient eligible');
    expect(reserveFromLots(lots, request('0'))).toEqual([]);
    expect(reserveFromLots([], request('0'))).toEqual([]);
  });

  it('preserves one-microcredit capacities and large safe quantities exactly', () => {
    const small = lot('small', '0.000001');
    expect(reserveFromLots([small], request('0.000001'))[0]?.units).toBe(1n);
    const large = { ...lot('large'), availableUnits: MOST_CREDIT_UNITS };
    expect(reserveFromLots([large], { ...request(), platformUnits: MOST_CREDIT_UNITS })[0]?.units).toBe(
      MOST_CREDIT_UNITS,
    );
  });

  it('refuses unsafe quantities in each source or request boundary', () => {
    expect(() => reserveFromLots([lot('paid')], { ...request(), platformUnits: -1n })).toThrow('safe accounting');
    expect(() =>
      reserveFromLots([lot('paid')], { ...request(), platformUnits: MOST_CREDIT_UNITS, resourceUnits: 1n }),
    ).toThrow('safe accounting');
    expect(() => reserveFromLots([{ ...lot('paid'), availableUnits: -1n }], request())).toThrow('safe accounting');
    expect(() => reserveFromLots([], { ...request(), cloudFreeRemainingUnits: -1n })).toThrow('safe accounting');
  });
});

describe('invalid source snapshots', () => {
  it.each([-1, Number.NaN, 1.5])('refuses invalid funding time %s', (now) => {
    expect(() => reserveFromLots([], { ...request(), now })).toThrow('Funding times');
  });

  it('refuses invalid identities, validity windows and duplicate category permissions', () => {
    for (const id of ['', 'x'.repeat(513)])
      expect(() => reserveFromLots([lot(id)], request())).toThrow('bounded identifier');
    expect(() => reserveFromLots([{ ...lot('paid'), expiresAt: 0 }], request())).toThrow('expire after issuance');
    expect(() => reserveFromLots([{ ...lot('paid'), issuedAt: -1 }], request())).toThrow('Funding times');
    expect(() => reserveFromLots([{ ...lot('paid'), categories: [] }], request())).toThrow('distinct permitted');
    expect(() => reserveFromLots([{ ...lot('paid'), categories: ['platform', 'platform'] }], request())).toThrow(
      'distinct permitted',
    );
  });

  it('refuses ambiguous or oversized source snapshots', () => {
    expect(() => reserveFromLots([lot('same'), lot('same')], request())).toThrow('uniquely identified');
    expect(() =>
      reserveFromLots(
        Array.from({ length: 1_025 }, (_, index) => lot(String(index))),
        request(),
      ),
    ).toThrow('at most 1024');
  });
});
