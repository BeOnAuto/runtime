import { recordingTracer, type RecordedSpan } from '@on.auto/operations/testing';
import { Context, Effect, Tracer } from 'effect';
import { describe, expect, it } from 'vitest';

import { alpha, definitionRecorded, eventTrigger, published, recorded } from '../reaction-testing/playbook-writes.ts';
import { reactingHost } from '../reaction-testing/reacting-host.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { until } from '../testing/until.ts';
import { followedThroughTheLatest } from '../waiting-testing/followed-host.ts';
import { parentId, waitingParent } from '../waiting-testing/waiting-parent.ts';
import { followedPlaybooksOn } from './followed-playbooks.ts';

const waiting = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const child = '0199a3c4-7d2e-7c1a-9b3f-0000000000c1';

const childStream = `${alpha}runs/${child}`;

function handedTheChildsEnding({ name, attributes, ending }: RecordedSpan): boolean {
  return name === 'follow run_succeeded' && attributes['auto.on.stream'] === childStream && ending === 'succeeded';
}

const ofTheChild = {
  by: 'playbook:alpha',
  at: '2026-10-01T09:00:00.000Z',
  runId: child,
  definitionType: 'workflow',
  definitionName: 'check',
  definitionVersion: 1,
  calledBy: { runId: parentId, reference: '/do/0/ask', run: 1 },
};

async function deliveredAgain(
  database: Parameters<typeof followedPlaybooksOn>[0],
  again: () => boolean,
): Promise<void> {
  let nudges = 0;
  await until(async () => {
    await followedThroughTheLatest(database);
    if (again()) {
      return true;
    }
    await Effect.runPromise(
      followedPlaybooksOn(database).save(alpha, { cursor: null, delivered: null, attempts: 0, waiting: false }),
    );
    nudges += 1;
    await published(database.store, { id: `nudge-${nudges}`, type: 'com.acme.c' });
    await followedThroughTheLatest(database);
    return again();
  }, Boolean);
}

describe('a record the follower delivers twice, as a pass that goes on from the first consumer does', () => {
  it('is offered once to a run that listens for it, and its trigger asks again for the run it started under the same id', async () => {
    const reacting = await reactingHost();
    const { store } = reacting.database;
    await definitionRecorded(store, { name: 'close', version: 1, triggers: [eventTrigger({ type: 'com.acme.a' })] });
    const both =
      'do:\n  - both: { listen: { to: { all: [{ with: { type: com.acme.a } }, { with: { type: com.acme.b } }] } } }';
    await Effect.runPromise(reacting.host.start(runAt(waiting), startOf(workflow(both))));
    await published(store, { id: 'e1', type: 'com.acme.a', data: 'first' });
    await until(
      () => Effect.runPromise(reacting.host.stateOf(runAt(waiting))),
      (state) => state.inbox.received === 1,
    );

    await deliveredAgain(reacting.database, () => reacting.reactions.starts().length > 1);
    const between = await Effect.runPromise(reacting.host.stateOf(runAt(waiting)));
    await published(store, { id: 'e3', type: 'com.acme.b', data: 'second' });
    const state = await until(
      () => Effect.runPromise(reacting.host.stateOf(runAt(waiting))),
      (found) => found.status === 'ended',
    );
    const runIds = reacting.reactions.starts().map(({ runId }) => runId);

    expect([between.inbox.offeredIds.length, between.inbox.received]).toEqual([1, 1]);
    expect(state.outcome).toEqual({ kind: 'completed', output: ['first', 'second'] });
    expect(state.inbox).toMatchObject({ received: 2 });
    expect(state.inbox.offeredIds).toHaveLength(2);
    expect([runIds.length > 1, new Set(runIds).size]).toEqual([true, 1]);
  });
});

describe('a run ending the follower delivers twice', () => {
  it('answers the call that waits for it once', async () => {
    const recording = recordingTracer();
    const { database, settled, answeredCalls, hosted } = await waitingParent(child, {
      context: Context.make(Tracer.Tracer, recording.tracer),
    });
    const handings = () => recording.spans().filter((span) => handedTheChildsEnding(span)).length;
    await recorded(
      database.store,
      childStream,
      { type: 'run_succeeded', data: { output: 'checked', record: {} } },
      ofTheChild,
    );
    await settled(parentId);

    await deliveredAgain(database, () => handings() > 1);

    expect(await answeredCalls()).toEqual([{ state: 'answered', delivered: 1 }]);
    expect(hosted.settlements().get(parentId)).toEqual({ status: 'succeeded', output: 'checked' });
    expect(hosted.troubles()).toEqual([]);
  });
});
