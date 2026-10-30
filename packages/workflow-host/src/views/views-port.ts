import { streamPrefixOfPlaybook, type PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';

import { rowsOf, type HostDatabase } from '../database/host-database.ts';
import { keptViewOf, KeptRowSchema, viewRowOf, type KeptView } from './view-rows.ts';
import { viewNamed } from './view-statements.ts';

export interface ViewsPort {
  readonly viewOf: (playbook: PlaybookAddress, name: string) => Effect.Effect<KeptView | undefined>;
  readonly newestRecordAt: (playbook: PlaybookAddress) => Effect.Effect<string | undefined>;
}

export function viewsPortOn(database: HostDatabase): ViewsPort {
  return {
    viewOf: (playbook, name) =>
      Effect.orDie(rowsOf(KeptRowSchema, database.read(viewNamed(streamPrefixOfPlaybook(playbook), name)))).pipe(
        Effect.map(([row]) => (row === undefined ? undefined : keptViewOf(viewRowOf(row), row.view))),
      ),
    newestRecordAt: (playbook) =>
      Effect.promise(() =>
        database.store.readRecorded(
          streamPrefixOfPlaybook(playbook),
          { kind: 'everything' },
          { order: 'desc', limit: 1 },
        ),
      ).pipe(Effect.map(({ records: [newest] }) => newest?.recordedAt)),
  };
}
