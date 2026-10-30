import { streamSignalOf } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import {
  playbookCreated,
  byAdmin,
  definitionRecorded,
  eventTrigger,
  published,
} from '../reaction-testing/playbook-writes.ts';
import { reactingHost, type ReactingHost } from '../reaction-testing/reacting-host.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { until } from '../testing/until.ts';

const beta = 'playbook/acme/beta/';

const closed = eventTrigger({ type: 'com.acme.closed' });

function startsReaching(reacting: ReactingHost, count: number) {
  return until(
    () => Promise.resolve(reacting.reactions.starts()),
    (starts) => starts.length >= count,
  );
}

describe('the playbooks another process writes to, which raises no signal here', () => {
  it('passes a playbook it followed at its start at the sweep after the playbook was appended to', async () => {
    const settings = await onSQLite();
    const { store } = await openedOn(settings);
    await playbookCreated(store, 'alpha');
    await definitionRecorded(store, { name: 'close', version: 1, triggers: [closed] });
    const reacting = await reactingHost({ settings, appended: streamSignalOf(), sweepEveryMs: 20 });

    await published(store, { id: 'after', type: 'com.acme.closed' });
    const starts = await startsReaching(reacting, 1);

    expect(starts.map(({ playbook, workflow }) => [playbook, workflow])).toEqual([['alpha', 'close']]);
  });

  it('follows a playbook its org creates from its first record, read from the registry the sweep names', async () => {
    const reacting = await reactingHost({ appended: streamSignalOf(), sweepEveryMs: 20 });
    const { store } = reacting.database;

    await playbookCreated(store, 'beta');
    await definitionRecorded(store, { name: 'close', version: 1, triggers: [closed] }, beta);
    await published(store, { id: 'first', type: 'com.acme.closed' }, byAdmin, beta);
    const starts = await startsReaching(reacting, 1);

    expect(starts.map(({ playbook, workflow }) => [playbook, workflow])).toEqual([['beta', 'close']]);
  });
});
