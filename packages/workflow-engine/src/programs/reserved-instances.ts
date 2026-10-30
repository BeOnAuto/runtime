import { Effect } from 'effect';

import { expressionUnitOf, type ExpressionUnit } from './expression-units.ts';
import { threadStackBytes, unitMemoryBytes } from './sandbox-bounds.ts';
import type { SandboxInstance, SandboxSettings } from './sandbox-session.ts';

export interface MachineSandbox {
  readonly reserve: Effect.Effect<void>;
  readonly unit: () => ExpressionUnit;
  readonly clock: () => number;
  readonly mostStepsWithoutWaiting?: number;
}

interface Stock {
  readonly setAside: () => boolean;
  readonly waitFor: () => Promise<void>;
  readonly taken: () => SandboxInstance | undefined;
  readonly released: () => void;
}

const spareInstances = 1;

function stockOf(prepare: () => Promise<SandboxInstance>): Stock {
  const ready: SandboxInstance[] = [];
  const waiters: (() => void)[] = [];
  const counts = { setAside: 0, preparing: 0 };
  const serve = (): void => {
    const served = Math.max(0, Math.min(waiters.length, ready.length - counts.setAside));
    counts.setAside += served;
    for (const waiter of waiters.splice(0, served)) {
      waiter();
    }
  };
  const refill = (): void => {
    while (ready.length + counts.preparing < counts.setAside + waiters.length + spareInstances) {
      counts.preparing += 1;
      void prepare().then((instance) => {
        counts.preparing -= 1;
        ready.push(instance);
        serve();
        refill();
        return instance;
      });
    }
  };
  refill();
  return {
    setAside: () => {
      const free = ready.length > counts.setAside;
      counts.setAside += free ? 1 : 0;
      refill();
      return free;
    },
    waitFor: () =>
      new Promise<void>((resolve) => {
        waiters.push(resolve);
        refill();
      }),
    taken: () => {
      counts.setAside = Math.max(0, counts.setAside - 1);
      const instance = ready.pop();
      refill();
      return instance;
    },
    released: () => {
      counts.setAside = Math.max(0, counts.setAside - 1);
    },
  };
}

function inThread(clock: () => number): SandboxSettings {
  return { stackBytes: threadStackBytes, mostAnswerBytes: unitMemoryBytes, clock };
}

function takenFrom(stock: Stock): SandboxInstance {
  const instance = stock.taken();
  if (instance === undefined) {
    throw new Error('A decision took a sandbox no input had set aside');
  }
  return instance;
}

export function reservedSandbox(prepare: () => Promise<SandboxInstance>, clock: () => number): MachineSandbox {
  const stock = stockOf(prepare);
  return {
    reserve: Effect.suspend(() => (stock.setAside() ? Effect.void : Effect.promise(stock.waitFor))),
    unit: () => {
      const unit = expressionUnitOf(() => takenFrom(stock), inThread(clock));
      return {
        evaluate: unit.evaluate,
        close: () => {
          unit.close();
          if (!unit.took()) {
            stock.released();
          }
        },
      };
    },
    clock,
  };
}

export function reusedSandbox(instance: SandboxInstance, clock: () => number): MachineSandbox {
  return { reserve: Effect.void, unit: () => expressionUnitOf(() => instance, inThread(clock)), clock };
}
