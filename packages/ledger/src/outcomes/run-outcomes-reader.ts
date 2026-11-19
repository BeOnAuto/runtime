import { streamPrefixOfPlaybook, type RunOutcomeMapping, type RunOutcomesReader } from '@on.auto/operations';
import { Effect } from 'effect';

import type { RunOutcomesStore } from '../event-store.ts';
import type { ServedOnceCaughtUp } from '../projection-catch-up/catching-up.ts';
import { runOutcomesVersioned } from './run-outcome-projection.ts';

export function keptOutcomesOnly(
  mapping: RunOutcomeMapping | undefined,
  read: RunOutcomesStore['readRunOutcomes'],
  served: ServedOnceCaughtUp,
): RunOutcomesStore['readRunOutcomes'] {
  if (mapping === undefined) {
    return () => Promise.resolve([]);
  }
  return async (playbookKey, window, selection) => {
    await Effect.runPromise(served(runOutcomesVersioned));
    return read(playbookKey, window, selection);
  };
}

export function runOutcomesReaderOf(store: RunOutcomesStore): RunOutcomesReader['readRunOutcomes'] {
  return (playbook, window, selection) =>
    Effect.promise(() => store.readRunOutcomes(streamPrefixOfPlaybook(playbook), window, selection));
}
