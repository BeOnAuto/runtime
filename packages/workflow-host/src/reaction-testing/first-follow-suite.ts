import { expect, it } from 'vitest';

import type { SettingsOf } from '../testing/host-files.ts';
import { until } from '../testing/until.ts';
import { followedThroughTheLatest } from '../waiting-testing/followed-host.ts';
import { heldFollower } from '../waiting-testing/held-follower.ts';
import { definitionRecorded, eventRecordOf, eventTrigger, published } from './playbook-writes.ts';
import { recordedReactions } from './recorded-reactions.ts';

export function firstFollowSuite(settings: SettingsOf): void {
  it('starts no run for an event recorded before the trigger that matches it was activated, both after the host opened and before its follower first passed the playbook, and starts one for the event after it', async () => {
    const reactions = recordedReactions();
    const { database, release } = await heldFollower({ reactions: reactions.options }, await settings());
    await published(database.store, { id: 'e-before', type: 'com.acme.closed' });
    await definitionRecorded(database.store, {
      name: 'close',
      version: 1,
      triggers: [eventTrigger({ type: 'com.acme.closed' })],
    });
    await published(database.store, { id: 'e-after', type: 'com.acme.closed' });

    release();
    await until(
      () => Promise.resolve(reactions.starts()),
      (starts) => starts.length > 0,
    );
    await followedThroughTheLatest(database);

    expect(reactions.starts().map(({ workflow, cause }) => [workflow, cause])).toEqual([
      ['close', eventRecordOf('e-after')],
    ]);
  });
}
