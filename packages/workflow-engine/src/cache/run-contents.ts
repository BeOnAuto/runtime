import type { PayloadToKeep } from '@on.auto/operations/payloads';
import { Effect } from 'effect';

import { keptValuesReached, type HeldContent, type HeldContents } from '../machine/held-contents.ts';
import type { RunState } from '../machine/run-state.ts';
import type { RunLogEvent } from '../run-log/run-event.ts';
import type { RunPayloads } from '../run-log/run-payloads.ts';
import { sinceSnapshotAfter } from '../run-log/snapshot.ts';
import type { CachedRun, RunCache } from './run-cache.ts';

interface DecidedRun {
  readonly loaded: CachedRun;
  readonly events: readonly RunLogEvent[];
  readonly payloads: readonly PayloadToKeep[];
  readonly state: RunState;
  readonly version: number;
  readonly format: number;
}

export function resolvedIn<Unavailable>(
  cache: RunCache,
  payloads: RunPayloads<Unavailable>,
  [runId, run]: readonly [string, CachedRun],
): Effect.Effect<CachedRun, Unavailable> {
  const unread = keptValuesReached(run.state).filter(({ sha256 }) => !run.contents.has(sha256));
  if (unread.length === 0) {
    return Effect.succeed(run);
  }
  return payloads.read(runId, unread).pipe(
    Effect.map((read): CachedRun => ({ ...run, contents: new Map<string, HeldContent>([...run.contents, ...read]) })),
    Effect.tap((withContents) =>
      Effect.sync(() => {
        cache.put(runId, withContents);
      }),
    ),
  );
}

function contentsReachedBy(state: RunState, contents: HeldContents): HeldContents {
  const reached = new Set(keptValuesReached(state).map(({ sha256 }) => sha256));
  return new Map([...contents].filter(([sha256]: readonly [string, HeldContent]) => reached.has(sha256)));
}

export function contentsAtHandAfter({ loaded, payloads }: Pick<DecidedRun, 'loaded' | 'payloads'>): HeldContents {
  const decided = payloads.map(({ sha256, text }) => [sha256, { kind: 'read', text }] as const);
  return new Map<string, HeldContent>([...loaded.contents, ...decided]);
}

export function keptAfter(cache: RunCache, runId: string, decided: DecidedRun): void {
  if (decided.events.length > 0) {
    const sinceSnapshot = sinceSnapshotAfter(decided.loaded.sinceSnapshot, decided.events);
    const { state, version, format } = decided;
    cache.put(runId, {
      state,
      version,
      sinceSnapshot,
      format,
      contents: contentsReachedBy(state, contentsAtHandAfter(decided)),
    });
  }
}
