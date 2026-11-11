import type { SQL } from '@event-driven-io/dumbo';
import type { CircuitBreakers } from '@on.auto/operations';

import type { InTransaction } from '../event-store.ts';
import type { FailedCheck } from './build-checks.ts';
import type { Built } from './catch-up.ts';

export type Kept =
  | ({ readonly kept: 'built'; readonly projection: string } & Built)
  | { readonly kept: 'reset'; readonly projection: string; readonly playbook: string; readonly because: ResetBecause }
  | { readonly kept: 'disagreed'; readonly projection: string; readonly playbook: string }
  | { readonly kept: 'refused'; readonly projection: string; readonly playbook: string };

export type ResetBecause = 'checkpoint_ahead' | FailedCheck | 'asked';

export interface StreamStatements {
  readonly query: (sql: SQL) => Promise<readonly unknown[]>;
  readonly inTransaction: InTransaction;
}

export function playbookOf(prefix: string): string {
  return prefix.slice(0, -1);
}

interface Guarded {
  readonly projection: string;
  readonly prefix: string;
}

export async function guardedBuild(
  breakers: CircuitBreakers,
  { projection, prefix }: Guarded,
  at: number,
  build: (again: boolean) => Promise<readonly Kept[]>,
): Promise<readonly Kept[]> {
  const key = `${projection}:${prefix}`;
  const state = breakers.stateAt(key, at);
  if (state === 'open') {
    return [{ kept: 'refused', projection, playbook: playbookOf(prefix) }];
  }
  if (state === 'half_open') {
    breakers.opened(key, at);
  }
  const kept = await build(state === 'half_open');
  if (kept.some((each) => each.kept === 'disagreed')) {
    breakers.opened(key, at);
  } else {
    breakers.closed(key);
  }
  return kept;
}
