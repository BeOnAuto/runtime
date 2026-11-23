import type { Dispatcher, DispatcherServices, OrgRequest, Outcome } from '@on.auto/operations';
import { Effect } from 'effect';

import type { ReadAsked } from './query-schema.ts';

/** Reads asked together, each told by its place among them as soon as it is answered, and done once every one is. */
export type ReadsTogether = (
  reads: readonly ReadAsked[],
  answered: (at: number, outcome: Outcome) => void,
) => Effect.Effect<void, never, DispatcherServices>;

export type ReadsTogetherOf = (dispatcher: Dispatcher, asking: Pick<OrgRequest, 'caller' | 'org'>) => ReadsTogether;

export const readsDispatchedEach: ReadsTogetherOf =
  (dispatcher, { caller, org }) =>
  (reads, answered) =>
    Effect.forEach(
      reads,
      ({ registration, playbook, input }, at) => {
        const request = { caller, org, input, encoding: 'json' as const };
        return (
          registration.scope === 'org'
            ? dispatcher.dispatchToOrg(registration, request)
            : dispatcher.dispatchToPlaybook(registration, { ...request, playbook: String(playbook) })
        ).pipe(
          Effect.tap((outcome) =>
            Effect.sync(() => {
              answered(at, outcome);
            }),
          ),
        );
      },
      { concurrency: 'unbounded', discard: true },
    );
