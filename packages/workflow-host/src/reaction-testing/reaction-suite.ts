import { Effect } from 'effect';
import { expect, it } from 'vitest';

import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import type { SettingsOf } from '../testing/host-files.ts';
import { until } from '../testing/until.ts';
import { firstFollowSuite } from './first-follow-suite.ts';
import { movedClock } from './moved-clock.ts';
import { at, cronTrigger, eventTrigger, everyTrigger, published, definitionRecorded } from './playbook-writes.ts';
import { reactingHost } from './reacting-host.ts';

const waiting = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7d';

const listening = workflow('do:\n  - await: { listen: { to: { one: { with: { type: com.acme.decided } } } } }');

export function reactionSuite(settings: SettingsOf): void {
  it('starts a workflow whose trigger an event matches', async () => {
    const reacting = await reactingHost({ settings: await settings() });
    const trigger = eventTrigger({ type: 'com.acme.closed' });
    await definitionRecorded(reacting.database.store, { name: 'close', version: 1, triggers: [trigger] });

    await published(reacting.database.store, { id: 'e1', type: 'com.acme.closed' });
    const starts = await until(
      () => Promise.resolve(reacting.reactions.starts()),
      (found) => found.length > 0,
    );

    expect(starts.map(({ workflow: name, depth }) => [name, depth])).toEqual([['close', 1]]);
  });

  it('offers an event published to the playbook to a run that listens for it', async () => {
    const reacting = await reactingHost({ settings: await settings() });
    await Effect.runPromise(reacting.host.start(runAt(waiting), startOf(listening)));

    await published(reacting.database.store, { id: 'e1', type: 'com.acme.decided', data: 'decided' });
    const state = await until(
      () => Effect.runPromise(reacting.host.stateOf(runAt(waiting))),
      (found) => found.status === 'ended',
    );

    expect(state.outcome).toEqual({ kind: 'completed', output: ['decided'] });
  });

  scheduleSuite(settings);
  firstFollowSuite(settings);
}

function scheduleSuite(settings: SettingsOf): void {
  it('starts a workflow whose trigger is a schedule at its due time', async () => {
    const activatedAt = Date.parse(at);
    const clock = movedClock(activatedAt + 1000);
    const reacting = await reactingHost({ settings: await settings(), clock });
    await definitionRecorded(reacting.database.store, { name: 'tick', version: 1, triggers: [everyTrigger(60_000)] });

    clock.moveTo(activatedAt + 60_000);
    const starts = await until(
      () => Promise.resolve(reacting.reactions.starts()),
      (found) => found.length > 0,
    );

    expect(starts.map(({ input }) => input)).toEqual([{ schedule: { due: '2026-10-01T09:01:00.000Z' } }]);
  });

  it('starts a workflow for an event, and twice when its cron and every are due at one time', async () => {
    const activatedAt = Date.parse(at);
    const clock = movedClock(activatedAt + 1000);
    const reacting = await reactingHost({ settings: await settings(), clock });
    const triggers = [eventTrigger({ type: 'com.acme.closed' }), cronTrigger('0 10 * * *'), everyTrigger(3_600_000)];
    await definitionRecorded(reacting.database.store, { name: 'close', version: 1, triggers });

    await published(reacting.database.store, { id: 'e1', type: 'com.acme.closed' });
    await until(
      () => Promise.resolve(reacting.reactions.starts()),
      (found) => found.length > 0,
    );
    clock.moveTo(activatedAt + 3_600_000);
    const starts = await until(
      () => Promise.resolve(reacting.reactions.starts()),
      (found) => found.length > 2,
    );

    expect(starts.map(({ trigger, cause }) => [trigger.reference, cause === starts[1]?.cause])).toEqual([
      ['/schedule/on', false],
      ['/schedule/cron', true],
      ['/schedule/every', true],
    ]);
    expect(new Set(starts.map(({ runId }) => runId)).size).toBe(3);
  });
}
