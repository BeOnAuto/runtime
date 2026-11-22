import type { PlaybookAddress } from '@on.auto/operations';
import { ofEachSubscription, providersOf, tracker } from '@on.auto/providers/testing';
import type { ToolServer } from '@on.auto/tool-servers';
import { Effect, Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { addedFact, recordedIn, registryOf } from '../testing/loop-registries.ts';
import { shipped } from '../testing/shipped-additions.ts';
import { connectionEventsOver, servedConnectionOf } from './connection-events.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const reporter = shipped.providers.find(({ entry }) => entry.events?.types !== undefined);

const declared = reporter?.entry.events?.types ?? [];

const provider = reporter?.entry.name ?? null;

const listed = { type: 'mcp', record_content: false, playbooks: ['alpha'], tools: [] } as const;

const servers: readonly ToolServer[] = [
  { ...listed, name: 'reports', connection: 'c-1', provider },
  {
    ...listed,
    name: 'mended',
    connection: 'c-2',
    provider,
    unavailable: 'The connection is broken',
    because: 'connection_broken',
  },
  { ...listed, name: 'by-hand', connection: 'c-3', provider: null },
  { ...listed, name: 'in-the-file', provider },
];

function listing() {
  const asked: string[] = [];
  const listServers = (playbook: PlaybookAddress, named: string) =>
    Effect.sync(() => {
      asked.push(`${playbook.playbook}/${named}`);
      return servers.filter(({ name }) => name === named);
    });
  return { listServers, asked: () => [...asked] };
}

describe('what a connection reports, for the triggers of a playbook it serves', () => {
  it('is what its provider’s entry declares, whether it is broken, what the playbook’s workflows listen to through it, and that this runtime hears none of it yet', async () => {
    const { listServers, asked } = listing();
    const listened = [
      { workflow: 'on-items', connection: 'reports', type: 'opened' },
      { workflow: 'on-boards', connection: 'mended', type: 'closed', subject: 'board-1' },
    ];
    const events = connectionEventsOver(listServers, Effect.succeed(shipped), () => Effect.succeed(listened));

    const reportings = await Effect.runPromise(
      Effect.forEach(['reports', 'mended', 'by-hand', 'in-the-file', 'unknown'], (name) =>
        events.reportingOf(alpha, name),
      ),
    );

    expect(declared).not.toEqual([]);
    expect(reportings).toEqual([
      { broken: false, types: declared, heard: Function.constUndefined, listenedBy: [listened[0]] },
      { broken: true, types: declared, heard: Function.constUndefined, listenedBy: [listened[1]] },
      { broken: false, types: [], heard: Function.constUndefined, listenedBy: [] },
      undefined,
      undefined,
    ]);
    expect(asked()).toEqual(['alpha/reports', 'alpha/mended', 'alpha/by-hand', 'alpha/in-the-file', 'alpha/unknown']);
  });
});

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

async function servedOver() {
  const registry = await registryOf([
    '2026-11-20T08:00:00.000Z',
    [
      addedFact('connection-1', 'tracker', 'tracker'),
      addedFact('connection-2', 'notes', null),
      addedFact('connection-3', 'sales-tracker', 'tracker', { playbooks: ['sales'] }),
      addedFact('connection-4', 'gone', 'tracker'),
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
