import { messageIdOf } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { statement } from '../database/statement.ts';
import {
  alpha,
  playbookCreated,
  playbookRenamed,
  byAdmin,
  definitionRecorded,
  eventTrigger,
  published,
  recorded,
} from '../reaction-testing/playbook-writes.ts';
import { reactingHost, type ReactingHost } from '../reaction-testing/reacting-host.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { until } from '../testing/until.ts';

const beta = 'playbook/acme/beta/';

const closed = eventTrigger({ type: 'com.acme.closed' });

const sentinel = eventTrigger({ type: 'com.acme.sentinel' });

function startsReaching(reacting: ReactingHost, count: number) {
  return until(
    () => Promise.resolve(reacting.reactions.starts()),
    (starts) => starts.length >= count,
  );
}

describe('a playbook its org created before the host started', () => {
  it('is followed from where the ledger stood as the host opened, with the triggers its workflows already had', async () => {
    const settings = await onSQLite();
    const { store } = await openedOn(settings);
    await playbookCreated(store, 'alpha');
    await definitionRecorded(store, { name: 'close', version: 1, triggers: [closed] });
    await published(store, { id: 'before', type: 'com.acme.closed' });

    const reacting = await reactingHost({ settings });
    await published(store, { id: 'after', type: 'com.acme.closed' });
    const starts = await startsReaching(reacting, 1);

    expect(starts.map(({ cause }) => cause)).toEqual([messageIdOf(`${alpha}events/after`, 1)]);
  });
});

describe('a stream of an org whose name only ends as its registry’s does', () => {
  it('is not read as a registry of playbooks', async () => {
    const settings = await onSQLite();
    const { store } = await openedOn(settings);
    await recorded(store, 'org/acme/elsewhere/playbooks', {
      type: 'playbook_created',
      data: { playbook: 'gamma', name: 'gamma', description: '' },
    });
    await playbookCreated(store, 'alpha');
    await definitionRecorded(store, { name: 'close', version: 1, triggers: [closed] });

    const reacting = await reactingHost({ settings });
    await published(store, { id: 'after', type: 'com.acme.closed' });
    await startsReaching(reacting, 1);
    const read = (text: ReturnType<typeof statement>) => Effect.runPromise(reacting.database.read(text));

    expect([
      await read(statement`SELECT playbook_key FROM workflow_followed_playbooks`),
      await read(statement`SELECT stream_id FROM workflow_followed_orgs`),
    ]).toEqual([[{ playbook_key: alpha }], [{ stream_id: 'org/acme/playbooks' }]]);
  });
});

describe('a playbook its org creates while the host runs', () => {
  it('is followed from its first record', async () => {
    const reacting = await reactingHost();
    const { store } = reacting.database;
    await playbookCreated(store, 'alpha');
    await playbookRenamed(store, 'alpha');

    await playbookCreated(store, 'beta');
    await definitionRecorded(store, { name: 'watch', version: 1, triggers: [sentinel] }, beta);
    await published(store, { id: 's1', type: 'com.acme.sentinel' }, byAdmin, beta);
    const starts = await startsReaching(reacting, 1);

    expect(starts.map(({ playbook, workflow }) => [playbook, workflow])).toEqual([['beta', 'watch']]);
  });
});

describe('a playbook its org created while the host was stopped', () => {
  it('is followed from its first record when the host starts again', async () => {
    const settings = await onSQLite();
    const first = await reactingHost({ settings });
    await playbookCreated(first.database.store, 'alpha');
    await until(
      () => Effect.runPromise(first.database.read(statement`SELECT position FROM workflow_followed_orgs`)),
      (rows) => rows.length > 0,
    );
    await first.host.stop();

    await playbookCreated(first.database.store, 'beta');
    await definitionRecorded(first.database.store, { name: 'watch', version: 1, triggers: [sentinel] }, beta);
    await published(first.database.store, { id: 's1', type: 'com.acme.sentinel' }, byAdmin, beta);
    const second = await reactingHost({ settings });
    const starts = await startsReaching(second, 1);

    expect(starts.map(({ playbook, workflow }) => [playbook, workflow])).toEqual([['beta', 'watch']]);
  });
});
