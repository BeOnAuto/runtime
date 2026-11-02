import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';

export type Rider = (execute: StatementExecutor) => Promise<void>;

interface CommitContext {
  readonly transaction: { readonly execute: StatementExecutor };
}

export interface AppendRiders {
  readonly ridden: (carriers: readonly unknown[], rider: Rider) => () => boolean;
  readonly beforeCommit: (messages: readonly unknown[], context: CommitContext) => Promise<void>;
}

export function appendRiders(): AppendRiders {
  const riders = new Map<unknown, Rider>();
  const rode = new Set<unknown>();
  return {
    ridden: (carriers, rider) => {
      for (const carrier of carriers) {
        riders.set(carrier, rider);
      }
      return () => {
        for (const carrier of carriers) {
          riders.delete(carrier);
        }
        return carriers.map((carrier) => rode.delete(carrier)).includes(true);
      };
    },
    beforeCommit: (messages, { transaction }) =>
      inTurn(messages, async (message) => {
        const carrier: unknown = Reflect.get(new Object(message), 'data');
        const rider = riders.get(carrier);
        if (rider !== undefined) {
          rode.add(carrier);
          await rider(transaction.execute);
        }
      }),
  };
}

export function afterTheHook<Args extends readonly unknown[]>(
  hook: ((...args: Args) => unknown) | undefined,
  then: (...args: Args) => Promise<void>,
): (...args: Args) => Promise<void> {
  return async (...args) => {
    await hook?.(...args);
    await then(...args);
  };
}
