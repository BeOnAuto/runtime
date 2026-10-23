import { Effect } from 'effect';

import { openCallsUnder, startedRow } from '../src/calls/call-rows.ts';
import { hostDatabaseOpenedOn, type DatabaseSettings } from '../src/ledger-testing/ledger-connections.ts';

export interface OpenCallsCount {
  readonly underTheRoot: number;
  readonly inAll: number;
  readonly p50Ms: number;
  readonly p99Ms: number;
}

const counts = 200;

function startedUnder(root: string, index: number) {
  const runId = `acme/alpha/${root}-${index}`;
  return {
    call: {
      kind: 'start_call' as const,
      key: { runId, reference: '/do/0/ask', run: 1 },
      function: 'notify',
      arguments: { to: 'ada' },
      longestMs: 60_000,
    },
    run: { runId, attributes: {} },
    origin: { version: 1 },
    child: `${root}-${index}-child`,
    root,
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

export async function openCallsCountOn(database: DatabaseSettings, underTheRoot: number): Promise<OpenCallsCount> {
  const opened = await hostDatabaseOpenedOn(database);
  const roots = ['root-0', 'root-1', 'root-2', 'root-3', 'root-4', 'root-5', 'root-6', 'root-7', 'root-8', 'root-9'];
  await Effect.runPromise(
    Effect.forEach(roots, (root) =>
      Effect.forEach(
        Array.from({ length: underTheRoot }, (_, index) => index),
        (index) => startedRow(opened, `${root}/${index}`, startedUnder(root, index)),
      ),
    ),
  );
  const took = await Effect.runPromise(
    Effect.forEach(
      Array.from({ length: counts }, (_, index) => index),
      () =>
        Effect.suspend(() => {
          const started = performance.now();
          return Effect.map(openCallsUnder(opened, 'root-0'), () => performance.now() - started);
        }),
    ),
  );
  await opened.close();
  const sorted = took.toSorted((a, b) => a - b);
  return {
    underTheRoot,
    inAll: underTheRoot * roots.length,
    p50Ms: percentile(sorted, 0.5),
    p99Ms: percentile(sorted, 0.99),
  };
}
