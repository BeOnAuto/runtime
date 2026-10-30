import { PlaybookRegistry, Ledger } from '@on.auto/operations';
import { Effect, Layer } from 'effect';

import { playbooksStreamOfOrg } from './playbooks-stream.ts';
import { registryDecider } from './registry-decider.ts';

export const ledgerPlaybookRegistry: Layer.Layer<PlaybookRegistry, never, Ledger> = Layer.effect(
  PlaybookRegistry,
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    return PlaybookRegistry.of({
      status: ({ org, playbook }) =>
        ledger
          .load(playbooksStreamOfOrg(org), registryDecider)
          .pipe(Effect.map(({ state }) => state.get(playbook)?.status ?? 'unknown')),
    });
  }),
);
