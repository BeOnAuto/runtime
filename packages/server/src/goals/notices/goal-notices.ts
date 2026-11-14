import { goalNoticesOf, noticedKeptOf, noticedPlaybookIn } from '@on.auto/goals';
import { Ledger } from '@on.auto/operations';
import { Effect } from 'effect';

import type { StartingWork } from '../../workflows/host-dependencies.ts';
import { inRuntime } from '../../workflows/in-runtime.ts';
import { goalLinksOf } from './goal-links.ts';

const noticedKeptMs = 5000;

export const goalNoticesOnNode: StartingWork = async ({ start, studioAddress, runtime, now }) => {
  const ledger = await Effect.runPromise(inRuntime(runtime, Effect.service(Ledger)));
  return goalNoticesOf({
    ledger,
    start,
    playbookOf: noticedKeptOf(noticedPlaybookIn(ledger), { keptMs: noticedKeptMs, now }),
    linkOf: goalLinksOf(studioAddress),
    now,
  });
};
