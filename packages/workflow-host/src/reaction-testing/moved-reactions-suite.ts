import type { LedgerStreams } from '@on.auto/ledger';
import { expect, it } from 'vitest';

import { reactionRunIdOf } from '../reactions/reaction-ids.ts';
import type { SettingsOf } from '../testing/host-files.ts';
import { until } from '../testing/until.ts';
import { movedClock } from './moved-clock.ts';
import {
  at,
  byAdmin,
  definitionKeyNamed,
  definitionMoved,
  definitionRecorded,
  definitionStreamNamed,
  eventRecordOf,
  eventTrigger,
  everyTrigger,
  published,
  recorded,
} from './playbook-writes.ts';
import { reactingHost, type ReactingHost } from './reacting-host.ts';

const beta = 'playbook/acme/beta/';

function definitionRenamed(store: LedgerStreams, from: string, to: string, version: number) {
  const renamed = {
    type: 'definition_renamed',
    data: { from, to, renamed_by: { id: 'acme-admin', name: 'acme-admin' } },
  };
  const context = { ...byAdmin, definitionType: 'workflow', definitionName: to, definitionVersion: version };
  return recorded(store, definitionStreamNamed(from), renamed, context);
}

function startsBeyond({ reactions }: ReactingHost, count: number) {
  return until(
    () => Promise.resolve(reactions.starts()),
    (found) => found.length > count,
  );
}

export function movedReactionsSuite(settings: SettingsOf): void {
  it('starts a workflow moved between two due times once at each under the ids it would have had, and for an event of the playbook it moved to alone', async () => {
    const activatedAt = Date.parse(at);
    const clock = movedClock(activatedAt + 1000);
    const reacting = await reactingHost({ settings: await settings(), clock });
    const { store } = reacting.database;
    const triggers = [everyTrigger(60_000), eventTrigger({ type: 'com.acme.closed' })];
    await definitionRecorded(store, { name: 'tick', version: 1, triggers });
    clock.moveTo(activatedAt + 60_000);
    await startsBeyond(reacting, 0);

    await definitionMoved(store, 'tick', 1, 'beta');
    await published(store, { id: 'e1', type: 'com.acme.closed' });
    await published(store, { id: 'e2', type: 'com.acme.closed' }, byAdmin, beta);
    await startsBeyond(reacting, 1);
    clock.moveTo(activatedAt + 120_000);
    const starts = await startsBeyond(reacting, 2);

    const tick = definitionKeyNamed('tick');
    expect(starts.map(({ playbook, runId }) => [playbook, runId])).toEqual([
      ['alpha', reactionRunIdOf(tick, 1, '/schedule/every', '2026-10-01T09:01:00.000Z')],
      ['beta', reactionRunIdOf(tick, 1, '/schedule/on', eventRecordOf('e2', beta))],
      ['beta', reactionRunIdOf(tick, 1, '/schedule/every', '2026-10-01T09:02:00.000Z')],
    ]);
  });

  it('starts a workflow renamed between two due times once at each under the ids it would have had, by the name it holds then', async () => {
    const activatedAt = Date.parse(at);
    const clock = movedClock(activatedAt + 1000);
    const reacting = await reactingHost({ settings: await settings(), clock });
    const { store } = reacting.database;
    await definitionRecorded(store, { name: 'tick', version: 1, triggers: [everyTrigger(60_000)] });
    clock.moveTo(activatedAt + 60_000);
    await startsBeyond(reacting, 0);

    await definitionRenamed(store, 'tick', 'tock', 1);
    clock.moveTo(activatedAt + 120_000);
    const starts = await startsBeyond(reacting, 1);

    const tick = definitionKeyNamed('tick');
    expect(starts.map(({ workflow, runId }) => [workflow, runId])).toEqual([
      ['tick', reactionRunIdOf(tick, 1, '/schedule/every', '2026-10-01T09:01:00.000Z')],
      ['tock', reactionRunIdOf(tick, 1, '/schedule/every', '2026-10-01T09:02:00.000Z')],
    ]);
  });
}
