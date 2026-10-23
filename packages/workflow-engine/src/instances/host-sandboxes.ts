import type { FilterSandbox } from '../filters/filter-verdicts.ts';
import { filterContextOf } from '../programs/kept-contexts.ts';
import { reservedSandbox, type MachineSandbox } from '../programs/reserved-instances.ts';
import { threadStackBytes, unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import { instanceStock, type InstanceSource } from './instance-source.ts';

export function hostClock(): number {
  return performance.now();
}

export function machineSandboxOf(source: InstanceSource, clock: () => number = hostClock): MachineSandbox {
  return reservedSandbox(() => source(unitMemoryBytes), clock);
}

export function filterSandboxOf(source: InstanceSource, clock: () => number = hostClock): FilterSandbox {
  const instances = instanceStock(source);
  return {
    session: async (opening) => {
      const settings = { stackBytes: threadStackBytes, mostAnswerBytes: unitMemoryBytes, clock };
      const context = filterContextOf(await instances(unitMemoryBytes), settings, opening());
      return {
        define: (expression) => {
          const test = context.define(expression);
          return (value, evaluation) => Promise.resolve(test(value, evaluation));
        },
        freeze: () => Promise.resolve(context.freeze()),
        close: context.close,
      };
    },
    clock,
  };
}
