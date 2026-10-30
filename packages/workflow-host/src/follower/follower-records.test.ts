import { messageIdOf } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { alpha, eventTrigger, published, recorded, definitionRecorded } from '../reaction-testing/playbook-writes.ts';
import { reactingHost } from '../reaction-testing/reacting-host.ts';
import { until } from '../testing/until.ts';
import type { Consumer } from './consumers.ts';

function recordingIds(name: string, types: readonly string[], received: (id: string) => void): Consumer {
  return {
    name,
    types,
    skippedAfterSweeps: Number.POSITIVE_INFINITY,
    batchOf: (followed, after) =>
      Effect.succeed({
        deliveries:
          after === undefined
            ? [
                {
                  key: followed.event.event.id,
                  workflow: 'archive',
                  deliver: Effect.sync(() => {
                    received(followed.event.event.id);
                  }),
                  skipped: () => Effect.void,
                },
              ]
            : [],
        through: followed.event.event.id,
        more: false,
      }),
  };
}

describe('a record of a playbook the follower cannot read', () => {
  it('is said and passed over, as an event, a fact of a run or a definition, while a workflow of the playbook reacts to its type', async () => {
    const reacting = await reactingHost();
    const { store } = reacting.database;
    const trigger = eventTrigger(
      { type: 'com.acme.sentinel' },
      { type: 'run_started' },
      { type: 'definition_created' },
    );
    await definitionRecorded(store, { name: 'watch', version: 1, triggers: [trigger] });
    await recorded(store, `${alpha}events/bad`, { type: 'event_published', data: { event: 'not an event' } });
    await recorded(store, `${alpha}runs/r-bad`, {
      type: 'run_started',
      data: { input: {}, calls_tools: 7 },
    });
    await recorded(store, `${alpha}definitions/workflow`, {
      type: 'definition_created',
      data: { content: 7 },
    });

    await published(store, { id: 's1', type: 'com.acme.sentinel' });
    await until(
      () => Promise.resolve(reacting.reactions.starts()),
      (starts) => starts.some(({ cause }) => cause === messageIdOf(`${alpha}events/s1`, 1)),
    );

    expect(reacting.notes()).toMatchObject([
      { kind: 'record_unreadable', org: 'acme', playbook: 'alpha', type: 'event_published' },
      { kind: 'record_unreadable', org: 'acme', playbook: 'alpha', type: 'run_started' },
      { kind: 'record_unreadable', org: 'acme', playbook: 'alpha', type: 'definition_created' },
    ]);
  });
});

describe('a record the consumers of waiting calls cannot read', () => {
  it('is said once and passed over, a cancel request whose context names no run as an ending whose context names none', async () => {
    const reacting = await reactingHost();
    const { store } = reacting.database;
    await definitionRecorded(store, {
      name: 'watch',
      version: 1,
      triggers: [eventTrigger({ type: 'com.acme.sentinel' })],
    });
    const stream = `${alpha}runs/r-bad`;
    await recorded(store, stream, { type: 'run_cancel_requested', data: { kind: 'requested', reason: 'Gone' } });
    await recorded(store, stream, { type: 'run_succeeded', data: { output: null, record: {} } });

    await published(store, { id: 's1', type: 'com.acme.sentinel' });
    await until(
      () => Promise.resolve(reacting.reactions.starts()),
      (starts) => starts.some(({ cause }) => cause === messageIdOf(`${alpha}events/s1`, 1)),
    );

    expect(reacting.notes()).toEqual([
      {
        kind: 'record_unreadable',
        org: 'acme',
        playbook: 'alpha',
        recordId: messageIdOf(stream, 1),
        type: 'run_cancel_requested',
      },
      {
        kind: 'record_unreadable',
        org: 'acme',
        playbook: 'alpha',
        recordId: messageIdOf(stream, 2),
        type: 'run_succeeded',
      },
    ]);
  });
});

describe('a consumer the host is given', () => {
  it('is offered the events of the types it names, though nothing in the playbook reacts, and one naming none is offered nothing', async () => {
    const received: string[] = [];
    const record = (id: string) => {
      received.push(id);
    };
    const noting = recordingIds('noting', ['com.acme.noted'], record);
    const wantingNothing = recordingIds('nothing', [], record);
    const reacting = await reactingHost({ consumers: [noting, wantingNothing] });

    await published(reacting.database.store, { id: 'e1', type: 'com.acme.noted' });
    await published(reacting.database.store, { id: 'e2', type: 'com.acme.other' });
    await published(reacting.database.store, { id: 'e3', type: 'com.acme.noted' });
    const delivered = await until(
      () => Promise.resolve<readonly string[]>([...received]),
      (ids) => ids.length >= 2,
    );

    expect(delivered).toEqual(['e1', 'e3']);
  });
});
