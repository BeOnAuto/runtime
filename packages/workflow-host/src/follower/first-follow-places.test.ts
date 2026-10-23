import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import {
  definitionRecordAt,
  definitionRecorded,
  eventTrigger,
  playbookCreated,
  published,
} from '../reaction-testing/playbook-writes.ts';
import { recordedReactions } from '../reaction-testing/recorded-reactions.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { until } from '../testing/until.ts';
import { followedThroughTheLatest } from '../waiting-testing/followed-host.ts';

const aPlaybookWithoutIt = 'playbook/acme/elsewhere/';

function withoutThePlaceOf(database: HostDatabase, id: string): HostDatabase {
  return {
    ...database,
    store: {
      ...database.store,
      readRecordedEvent: (playbookKey, asked) =>
        database.store.readRecordedEvent(asked === id ? aPlaybookWithoutIt : playbookKey, asked),
    },
  };
}

describe('a definition record whose place the first follow of its playbook cannot find', () => {
  it('is noted as unreadable and applied neither as before the open nor after it, so its trigger starts no run', async () => {
    const database = await openedOn(await onSQLite());
    await playbookCreated(database.store, 'alpha');
    await definitionRecorded(database.store, {
      name: 'close',
      version: 1,
      triggers: [eventTrigger({ type: 'com.acme.closed' })],
    });
    const reactions = recordedReactions();
    const hosted = await hostedOn(
      { database: withoutThePlaceOf(database, definitionRecordAt(1)) },
      {
        reactions: reactions.options,
      },
    );

    await published(database.store, { id: 'e1', type: 'com.acme.closed' });
    const notes = await until(
      () => Promise.resolve(hosted.notes()),
      (noted) => noted.length > 0,
    );
    await followedThroughTheLatest(database);

    expect([notes, reactions.starts()]).toEqual([
      [
        {
          kind: 'record_unreadable',
          org: 'acme',
          playbook: 'alpha',
          recordId: definitionRecordAt(1),
          type: 'definition_created',
        },
      ],
      [],
    ]);
  });
});
