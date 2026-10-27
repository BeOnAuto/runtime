import { describe, expect, it } from 'vitest';

import { creditUnits, platformCreditUnits, resourceCreditUnits, TARIFF_VERSION, type ResourceCost } from '../index.ts';

const llm = (baseUsd: string, totalUsd?: string): ResourceCost => ({
  category: 'llm',
  payer: 'auto',
  baseUsd,
  ...(totalUsd === undefined ? {} : { totalUsd }),
});

describe('the resource tariff', () => {
  it('pins quotes and settlements to the approved tariff version', () => {
    expect(TARIFF_VERSION).toBe('2026-10-26.v4');
  });

  it('converts one dollar of LLM provider cost to forty credits, applying the markup once', () => {
    expect(resourceCreditUnits([llm('1')])).toBe(creditUnits('40'));
    expect(resourceCreditUnits([llm('1', '1.20')])).toBe(creditUnits('40'));
    expect(resourceCreditUnits([llm('1e-2', '0.012')])).toBe(creditUnits('0.4'));
  });

  it('converts allocated prediction compute at three times cost', () => {
    expect(resourceCreditUnits([{ category: 'prediction', payer: 'auto', baseUsd: '1', totalUsd: '3' }])).toBe(
      creditUnits('100'),
    );
  });

  it('rejects an incorrect, missing-markup or double-marked provider total', () => {
    for (const total of ['1', '1.44', '1.200001']) {
      expect(() => resourceCreditUnits([llm('1', total)])).toThrow('approved tariff');
    }
  });

  it('does not surcharge customer-funded providers or local compute', () => {
    const costs: readonly ResourceCost[] = [
      { category: 'llm', payer: 'customer', baseUsd: '1' },
      { category: 'prediction', payer: 'customer', baseUsd: '100' },
    ];
    expect(resourceCreditUnits(costs)).toBe(0n);
    expect(resourceCreditUnits([...costs, llm('1')])).toBe(creditUnits('40'));
  });
});

describe('resource rounding and bounds', () => {
  it('retains fractions across resource receipts and rounds only the aggregate', () => {
    const small = llm('0.00000001');
    expect(resourceCreditUnits([small])).toBe(0n);
    expect(resourceCreditUnits([small], 'up')).toBe(1n);
    expect(resourceCreditUnits([small, small, small, small, small])).toBe(2n);
    expect(resourceCreditUnits(Array.from({ length: 1_000 }, () => small))).toBe(400n);
  });

  it('conserves mixed resource precision instead of summing rounded charges', () => {
    expect(
      resourceCreditUnits([llm('0.00000001'), { category: 'prediction', payer: 'auto', baseUsd: '0.000000006' }]),
    ).toBe(1n);
  });

  it('reserves every fractional microcredit and does not add a unit to an exact maximum', () => {
    expect(resourceCreditUnits([llm('0.00000003')], 'up')).toBe(2n);
    expect(resourceCreditUnits([llm('1')], 'up')).toBe(creditUnits('40'));
  });

  it('allows a proven zero resource charge', () => {
    expect(resourceCreditUnits([])).toBe(0n);
    expect(resourceCreditUnits([llm('0', '0')])).toBe(0n);
  });

  it('refuses invalid or unsafe provider amounts', () => {
    expect(() => resourceCreditUnits([llm('NaN')])).toThrow(RangeError);
    expect(() => resourceCreditUnits([llm('1e36')])).toThrow('safe accounting range');
  });
});

describe('platform and combined charges', () => {
  it('charges one platform credit per logical run', () => {
    expect(platformCreditUnits(0n)).toBe(0n);
    expect(platformCreditUnits(6n)).toBe(creditUnits('6'));
    expect(() => platformCreditUnits(-1n)).toThrow('safe accounting range');
  });

  it('reproduces the complete Starter sizing example', () => {
    const run = platformCreditUnits(6n) + resourceCreditUnits([llm('0.03'), llm('0.03'), llm('0.03')]);
    const development = creditUnits('125') + platformCreditUnits(2n) + resourceCreditUnits([llm('1')]);
    expect(run).toBe(creditUnits('9.6'));
    const month = 22n * run + 2n * 4n * run + development;
    expect(month).toBe(creditUnits('455'));
    expect(creditUnits('500') - month).toBe(creditUnits('45'));
  });
});
