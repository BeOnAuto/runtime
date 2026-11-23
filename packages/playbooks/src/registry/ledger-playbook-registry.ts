import {
  Ledger,
  PlaybookRegistry,
  rowKeyColumn,
  type OrgAddress,
  type PlaybookAddress,
  type StreamReader,
} from '@on.auto/operations';
import { Effect, Layer } from 'effect';

import { playbookRowsName, registryOfRows } from './playbook-rows.ts';
import { playbooksStreamOfOrg } from './playbooks-stream.ts';
import { registryDecider } from './registry-decider.ts';

export const ledgerPlaybookRegistry: Layer.Layer<PlaybookRegistry, never, Ledger> = Layer.effect(
  PlaybookRegistry,
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    return PlaybookRegistry.of({
      status: ({ org, playbook }) =>
        ledger
          .readProjectedRows(
            playbookRowsName,
            { org },
            { where: [{ column: rowKeyColumn, equals: playbook }], orderBy: [], order: 'asc', limit: 1 },
          )
          .pipe(Effect.map((rows) => registryOfRows(rows).get(playbook)?.status ?? 'unknown')),
    });
  }),
);

export function activePlaybooksOf(
  ledger: Pick<StreamReader, 'load'>,
  { org }: OrgAddress,
): Effect.Effect<readonly PlaybookAddress[]> {
  return Effect.map(ledger.load(playbooksStreamOfOrg(org), registryDecider), ({ state }) =>
    [...state.values()].filter(({ status }) => status === 'active').map(({ id }) => ({ org, playbook: id })),
  );
}
