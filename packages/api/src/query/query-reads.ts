import type { Dispatcher, DispatcherServices, OrgRequest, Outcome } from '@on.auto/operations';
import { Effect } from 'effect';

import type { ReadAsked } from './query-schema.ts';

export type ReadsTogether = (
  reads: readonly ReadAsked[],
) => Effect.Effect<readonly Outcome[], never, DispatcherServices>;

export type ReadsTogetherOf = (dispatcher: Dispatcher, asking: Pick<OrgRequest, 'caller' | 'org'>) => ReadsTogether;

export const readsDispatchedEach: ReadsTogetherOf =
  (dispatcher, { caller, org }) =>
  (reads) =>
    Effect.forEach(
      reads,
      ({ registration, playbook, input }) => {
        const request = { caller, org, input, encoding: 'json' as const };
        return registration.scope === 'org'
          ? dispatcher.dispatchToOrg(registration, request)
          : dispatcher.dispatchToPlaybook(registration, { ...request, playbook: String(playbook) });
      },
      { concurrency: 'unbounded' },
    );
