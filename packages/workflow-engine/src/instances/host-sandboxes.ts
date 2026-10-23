import type { ShippedFiles } from '@on.auto/operations';

import type { FilterSandbox } from '../filters/filter-verdicts.ts';
import { filterContextOf } from '../programs/kept-contexts.ts';
import { reservedSandbox, type MachineSandbox } from '../programs/reserved-instances.ts';
import { threadStackBytes, unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import { freshInstance } from './fresh-instances.ts';
import { instanceStock } from './instance-stock.ts';

export function hostClock(): number {
  return performance.now();
}

export function machineSandboxOf(shippedFiles: ShippedFiles, clock: () => number = hostClock): MachineSandbox {
  return reservedSandbox(() => freshInstance(shippedFiles, unitMemoryBytes), clock);
}

export function filterSandboxOf(shippedFiles: ShippedFiles, clock: () => number = hostClock): FilterSandbox {
  const instances = instanceStock((memoryBytes) => freshInstance(shippedFiles, memoryBytes));
  return {
    session: async (opening) => {
      const settings = { stackBytes: threadStackBytes, mostAnswerBytes: unitMemoryBytes, clock };
      const context = filterContextOf(await instances(unitMemoryBytes), settings, opening());
      return {
        define: (source) => {
          const test = context.define(source);
          return (value, evaluation) => Promise.resolve(test(value, evaluation));
        },
        freeze: () => Promise.resolve(context.freeze()),
        close: context.close,
      };
    },
    clock,
  };
}
