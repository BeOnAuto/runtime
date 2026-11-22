import { ofEachSubscription, providersOf, tracker } from '@on.auto/providers/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { addedFact, recordedIn, registryOf } from '../testing/loop-registries.ts';
import { servedConnectionOf } from './connection-events.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const opened = 'com.example.ticket.opened';

const reporting = providersOf({
  ...tracker,
  events: {
    types: [{ type: opened, title: 'A ticket is opened', subject: { title: 'Board', required: true }, data: {} }],
    destinations: [
      {
        ...ofEachSubscription,
        events: [
          {
            type: opened,
            when: { '$request.body#/kind': ['opened'] },
            id: ['$request.body#/ticket/id'],
            subject: '$request.body#/ticket/board',
            data: { title: '$request.body#/ticket/title' },
            topic: '{{ subject }}',
          },
        ],
      },
    ],
  },
});

const reported = [{ type: opened, subject: 'board-7' }, { type: opened }, { type: 'com.example.ticket.closed' }];

const ada = { id: 'person:ada', name: 'Ada' };

function connectedFact(connection: string) {
  return { type: 'connection_connected', data: { connection, connected_by: ada } } as const;
}

const brokenFact = {
  type: 'connection_broken',
  data: { connection: 'connection-1', kind: 'credential_refused', reason: 'Refused' },
} as const;

const recordedWhile = {
  pending: [],
  broken: [connectedFact('connection-1'), brokenFact],
  connected: [connectedFact('connection-1')],
  'connected again after it broke': [connectedFact('connection-1'), brokenFact, connectedFact('connection-1')],
} as const;

async function servedOver() {
  const registry = await registryOf([
    '2026-11-20T08:00:00.000Z',
    [
      addedFact('connection-1', 'tracker', 'tracker'),
      addedFact('connection-2', 'notes', null),
      addedFact('connection-3', 'sales-tracker', 'tracker', { playbooks: ['sales'] }),
      addedFact('connection-4', 'gone', 'tracker'),
      connectedFact('connection-1'),
      connectedFact('connection-2'),
      connectedFact('connection-3'),
      connectedFact('connection-4'),
      { type: 'connection_removed', data: { connection: 'connection-4' } },
    ],
  ]);
  const servedOf = servedConnectionOf({ registry, providers: reporting });
  return (org: string, connection: string) =>
    Effect.runPromise(
      Effect.flatMap(
        servedOf({ org, playbook: 'alpha', connection }),
        (served): Effect.Effect<string | readonly (readonly string[])[]> =>
          served === undefined ? Effect.succeed('not served') : Effect.forEach(reported, served.topicsOf),
      ),
    );
}

describe('the connection an event a delivery carries is taken in through', () => {
  it('serves the playbook, and gives the topic its entry renders for an event of a type and subject, and none otherwise', async () => {
    const topicsThrough = await servedOver();

    expect([await topicsThrough('acme', 'tracker'), await topicsThrough('acme', 'notes')]).toEqual([
      [['board-7'], [], []],
      [[], [], []],
    ]);
  });

  it('is none for a connection removed, of another playbook or org, or unknown', async () => {
    const topicsThrough = await servedOver();

    expect(
      await Promise.all([
        topicsThrough('acme', 'gone'),
        topicsThrough('acme', 'sales-tracker'),
        topicsThrough('globex', 'tracker'),
        topicsThrough('acme', 'billing'),
      ]),
    ).toEqual(['not served', 'not served', 'not served', 'not served']);
  });

  it.each([
    ['pending', false],
    ['broken', false],
    ['connected', true],
    ['connected again after it broke', true],
  ] as const)('is served only while connected: for a connection %s, %s', async (state, served) => {
    const registry = await registryOf([
      '2026-11-20T08:00:00.000Z',
      [addedFact('connection-1', 'tracker', 'tracker'), ...recordedWhile[state]],
    ]);
    const servedOf = servedConnectionOf({ registry, providers: reporting });

    const answer = await Effect.runPromise(servedOf({ ...alpha, connection: 'tracker' }));

    expect(answer !== undefined).toBe(served);
  });
});

describe('the account the connection an event is taken in through acts as', () => {
  it('is the id the runtime recorded for its connecting, none before it is recorded, and none once it is connected again', async () => {
    const connectedAt = '2026-11-20T08:30:00.000Z';
    const connected = {
      type: 'connection_connected',
      data: { connection: 'connection-1', connected_by: { id: 'person:ada', name: 'Ada' } },
    } as const;
    const identified = {
      type: 'connection_identified',
      data: { connection: 'connection-1', connected_at: connectedAt, user: { id: 'h-7', name: 'sam' } },
    } as const;
    const registry = await registryOf(
      ['2026-11-20T08:00:00.000Z', [addedFact('connection-1', 'tracker', 'tracker')]],
      [connectedAt, [connected]],
    );
    const servedOf = servedConnectionOf({ registry, providers: reporting });
    const actingAs = () => Effect.runPromise(servedOf({ ...alpha, connection: 'tracker' }));

    const before = await actingAs();
    await recordedIn(registry, ['2026-11-20T08:31:00.000Z', [identified]]);
    const recorded = await actingAs();
    await recordedIn(registry, ['2026-11-21T08:00:00.000Z', [connected]]);

    const topicsOf: unknown = expect.anything();
    const served = { topicsOf };
    expect([before, recorded, await actingAs()]).toStrictEqual([served, { ...served, user: 'h-7' }, served]);
  });
});
