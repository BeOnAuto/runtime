import { checkedCreditUnits, MICROCREDITS_PER_CREDIT } from '../quantities/credits.ts';
import { addedFractions, multipliedFraction, roundedFraction, type Fraction } from '../quantities/fraction.ts';
import { resourceCreditFraction, type ResourceCost } from '../tariff/resources.ts';

export type WorkBound =
  | {
      readonly type: 'run';
      readonly resources: readonly ResourceCost[] | undefined;
      readonly developmentUnits: bigint;
    }
  | { readonly type: 'sequence' | 'parallel'; readonly steps: readonly WorkBound[] }
  | { readonly type: 'branch'; readonly paths: readonly WorkBound[] }
  | { readonly type: 'repeat'; readonly iterations: bigint | undefined; readonly body: WorkBound };

interface ExactBound {
  readonly platform: bigint;
  readonly resources: Fraction;
  readonly development: bigint;
}

export interface SpendingBound {
  readonly platformUnits: bigint;
  readonly resourceUnits: bigint;
  readonly developmentUnits: bigint;
  readonly totalUnits: bigint;
}

const zero: ExactBound = { platform: 0n, resources: { numerator: 0n, denominator: 1n }, development: 0n };

function combined(first: ExactBound, second: ExactBound): ExactBound {
  return {
    platform: first.platform + second.platform,
    resources: addedFractions(first.resources, second.resources),
    development: first.development + second.development,
  };
}

function greatest(first: ExactBound, second: ExactBound): ExactBound {
  const { resources: a } = first;
  const { resources: b } = second;
  return {
    platform: first.platform > second.platform ? first.platform : second.platform,
    resources: a.numerator * b.denominator > b.numerator * a.denominator ? a : b,
    development: first.development > second.development ? first.development : second.development,
  };
}

function repeated(bound: ExactBound, iterations: bigint | undefined): ExactBound {
  if (iterations === undefined) throw new RangeError('A quote needs a finite iteration limit');
  const count = checkedCreditUnits(iterations);
  return {
    platform: bound.platform * count,
    resources: multipliedFraction(bound.resources, count),
    development: bound.development * count,
  };
}

function runBound(bound: Extract<WorkBound, { readonly type: 'run' }>): ExactBound {
  if (bound.resources === undefined)
    throw new RangeError('A quote needs known resource rates and enforced resource limits');
  return {
    platform: MICROCREDITS_PER_CREDIT,
    resources: resourceCreditFraction(bound.resources),
    development: checkedCreditUnits(bound.developmentUnits),
  };
}

function exactBound(plan: WorkBound): ExactBound {
  let visited = 0;
  const inspect = (node: WorkBound, depth: number): ExactBound => {
    visited += 1;
    if (visited > 4_096 || depth > 32) throw new RangeError('The quote exceeds the plan size or nesting limit');
    const next = (child: WorkBound): ExactBound => inspect(child, depth + 1);
    if (node.type === 'run') return runBound(node);
    if (node.type === 'repeat') return repeated(next(node.body), node.iterations);
    if (node.type === 'branch') {
      if (node.paths.length === 0) throw new RangeError('A quote needs at least one possible branch');
      return node.paths.map(next).reduce((first, second) => greatest(first, second), zero);
    }
    return node.steps.map(next).reduce((first, second) => combined(first, second), zero);
  };
  return inspect(plan, 0);
}

export function maximumSpend(plan: WorkBound): SpendingBound {
  const bound = exactBound(plan);
  const platformUnits = checkedCreditUnits(bound.platform);
  const resourceUnits = checkedCreditUnits(roundedFraction(bound.resources, 'up'));
  const developmentUnits = checkedCreditUnits(bound.development);
  const totalUnits = checkedCreditUnits(platformUnits + resourceUnits + developmentUnits);
  return { platformUnits, resourceUnits, developmentUnits, totalUnits };
}
