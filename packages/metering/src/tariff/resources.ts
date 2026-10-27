import { checkedCreditUnits, MICROCREDITS_PER_CREDIT } from '../quantities/credits.ts';
import {
  addedFractions,
  decimalFraction,
  equalFractions,
  multipliedFraction,
  roundedFraction,
  type Fraction,
  type Rounding,
} from '../quantities/fraction.ts';

export const TARIFF_VERSION = '2026-10-26.v4';

export type ResourceCategory = 'llm' | 'prediction';

export interface ResourceCost {
  readonly category: ResourceCategory;
  readonly payer: 'auto' | 'customer';
  readonly baseUsd: string;
  readonly totalUsd?: string;
}

function markedUp(base: Fraction, category: ResourceCategory): Fraction {
  return category === 'llm' ? multipliedFraction(base, 6n, 5n) : multipliedFraction(base, 3n);
}

function billedCost({ category, payer, baseUsd, totalUsd }: ResourceCost): Fraction {
  if (payer === 'customer') {
    return { numerator: 0n, denominator: 1n };
  }
  const total = markedUp(decimalFraction(baseUsd), category);
  if (totalUsd !== undefined && !equalFractions(total, decimalFraction(totalUsd))) {
    throw new RangeError('The resource total does not match the approved tariff');
  }
  return multipliedFraction(total, 100n * MICROCREDITS_PER_CREDIT, 3n);
}

export function resourceCreditFraction(costs: readonly ResourceCost[]): Fraction {
  return costs.reduce<Fraction>((sum, cost) => addedFractions(sum, billedCost(cost)), {
    numerator: 0n,
    denominator: 1n,
  });
}

export function resourceCreditUnits(costs: readonly ResourceCost[], rounding: Rounding = 'nearest'): bigint {
  return checkedCreditUnits(roundedFraction(resourceCreditFraction(costs), rounding));
}

export function platformCreditUnits(executions: bigint): bigint {
  return checkedCreditUnits(executions * MICROCREDITS_PER_CREDIT);
}
