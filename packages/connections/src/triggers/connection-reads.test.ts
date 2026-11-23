import { generationOf, readOfATrigger } from '@on.auto/providers';
import type { ToolServer } from '@on.auto/tool-servers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { mostSubscriptionsThroughAConnection } from '../subscriptions/loop-ports.ts';
import { subscriptionRecordsOf } from '../subscriptions/subscription-records.ts';
import { alpha, at, boardsReportingTo, type BoardsReporting, type Naming } from '../testing/boards-connections.ts';
import { theServerWithAnAddress } from '../testing/boards-reported.ts';

const listingCards = {
  tool: 'list_cards',
  with: { after: '{{ since }}' },
  list: '/cards',
  order: 'oldest_first',
  id: ['/id'],
} as const;

const { topic: cardsListed, destination: listingByHand } = readOfATrigger('card.added', listingCards);

const byHandConnected = '2026-11-22T08:00:00.000Z';

const serverFields = { type: 'mcp', record_content: false, playbooks: ['alpha'], provider: null } as const;

const theCardsTool = {
  name: 'list_cards',
  description: 'Lists cards',
  input_schema: { type: 'object', properties: { after: { type: 'string' } } },
  mark: 'reads',
  marked_by: 'server',
} as const;

const anyWords: unknown = expect.any(String);

function reportedBy(reporting: Pick<BoardsReporting, 'events'>, connection: string) {
  return reporting.events.reportingOf(alpha, connection).pipe(Effect.flatMap(Effect.fromNullishOr), Effect.orDie);
}

async function toolsOf(naming: Naming) {
  const reporting = await boardsReportingTo(theServerWithAnAddress, naming);
  return at(Effect.flatMap(reportedBy(reporting, 'by-hand'), (each) => each.tools));
}

function listing(servers: readonly ToolServer[]): Naming {
  return { listServers: () => Effect.succeed(servers) };
}

const unreachableServer: ToolServer = {
  ...serverFields,
  name: 'by-hand',
  unavailable: 'it did not answer',
  because: 'unreachable',
};

describe('a trigger that names a tool of its connection to check, as the connection reports it', () => {
  it('is heard through a subscription of its own, whose topic is its read, within the most places a connection holds', async () => {
    const reporting = await boardsReportingTo(theServerWithAnAddress);

    expect(
      await at(Effect.flatMap(reportedBy(reporting, 'by-hand'), (each) => each.reading('card.added', listingCards))),
    ).toEqual({
      kind: 'heard',
      subscribes: { topic: cardsListed, mostTopics: mostSubscriptionsThroughAConnection },
    });
  });

  it('reads the tools the connection offers this playbook, each with its mark and the arguments it declares', async () => {
    const servers = [
      { ...serverFields, name: 'other', tools: [] },
      { ...serverFields, name: 'by-hand', tools: [theCardsTool] },
    ];

    expect(await toolsOf(listing(servers))).toEqual({
      kind: 'listed',
      tools: [{ name: 'list_cards', mark: 'reads', input_schema: theCardsTool.input_schema }],
    });
  });

  it.each([
    ['where nothing can list tools here', {}],
    ['where the connection is not among the servers listed', listing([])],
    ['where its server cannot be asked', listing([unreachableServer])],
  ] as const)('says the tools cannot be listed %s', async (_case, naming) => {
    expect(await toolsOf(naming)).toEqual({ kind: 'unavailable', detail: anyWords });
  });
});

function readStandingIn(reporting: Pick<BoardsReporting, 'events'>, connection = 'by-hand') {
  return at(reporting.events.standingOf(alpha, { connection, type: 'card.added', read: listingCards, paused: false }));
}

const checkedAtItsPace = { speed: 'polling', pollingIntervalSeconds: 60 } as const;

describe('how a trigger that names a tool of its connection to check stands', () => {
  it('is checked at the pace of a check, setting up until its first check is made as its read is written, then listening', async () => {
    const reporting = await boardsReportingTo(theServerWithAnAddress);
    const before = await readStandingIn(reporting);
    const made = {
      type: 'polling',
      declared: generationOf(byHandConnected, listingByHand).declared,
      since: '',
    } as const;
    const key = { connection: 'by-hand', topic: cardsListed };
    await at(subscriptionRecordsOf(reporting.subscriptions).made(alpha, key, made));

    expect([before, await readStandingIn(reporting)]).toEqual([
      {
        ...checkedAtItsPace,
        listening: false,
        notListeningBecause: { kind: 'setting_up', detail: anyWords },
        needsReconnecting: false,
      },
      { ...checkedAtItsPace, listening: true, notListeningBecause: null, needsReconnecting: false },
    ]);
  });

  it('is not received through a connection whose entry declares its own events', async () => {
    const reporting = await boardsReportingTo(theServerWithAnAddress);

    expect((await readStandingIn(reporting, 'boards')).notListeningBecause?.kind).toBe('not_received_here');
  });
});
