import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import { followerOver } from '../reaction-testing/follower-over.ts';
import {
  playbookCreated,
  byAdmin,
  definitionRecorded,
  eventTrigger,
  published,
} from '../reaction-testing/playbook-writes.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { until } from '../testing/until.ts';

const beta = 'playbook/acme/beta/';

interface HeldBack {
  readonly database: HostDatabase;
  readonly release: () => void;
}

function sweptAtOnceAndRegistryFailing(database: HostDatabase, playbookKey: string): HeldBack {
  const state = { released: false, swept: false };
  const store: HostDatabase['store'] = {
    ...database.store,
    readAppended: (after, most) =>
      after === undefined || state.released
        ? database.store.readAppended(after, most)
        : Promise.resolve({ streams: [], through: after, more: false }),
  };
  return {
    database: {
      ...database,
      store,
      read: (statement) =>
        Effect.suspend(() => {
          const text = statement.strings.join('');
          state.swept ||= text.includes('FROM workflow_followed_playbooks') && statement.values.includes(playbookKey);
          const registry = text.includes('FROM workflow_followed_orgs WHERE stream_id');
          return registry && !state.swept
            ? Effect.fail(new DatabaseFailed({ detail: 'The registry could not be read' }))
            : database.read(statement);
        }),
    },
    release: () => {
      state.released = true;
    },
  };
}

describe('a playbook another process creates, swept before its registry could be read', () => {
  it('is passed from its first record, so its first event starts a workflow without another append', async () => {
    const database = await openedOn(await onSQLite());
    const held = sweptAtOnceAndRegistryFailing(database, beta);
    const reactions = await followerOver(held.database, 20);
    const trigger = eventTrigger({ type: 'com.acme.closed' });

    await playbookCreated(database.store, 'beta');
    await definitionRecorded(database.store, { name: 'close', version: 1, triggers: [trigger] }, beta);
    await published(database.store, { id: 'first', type: 'com.acme.closed' }, byAdmin, beta);
    held.release();
    const starts = await until(
      () => Promise.resolve(reactions.starts()),
      (found) => found.length > 0,
    );

    expect(starts.map(({ playbook, workflow }) => [playbook, workflow])).toEqual([['beta', 'close']]);
  });
});
