import { memoryLedger } from '@on.auto/operations/testing';
import {
  cardMoved,
  overTheBoardsSocket,
  providerListOf,
  providerOf,
  providersOf,
  tracker,
} from '@on.auto/providers/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  archived,
  autoCloud,
  boardsEntryOf,
  byTheApp,
  bySubscription,
  heldRefused,
  heldUnrefused,
  noneHeld,
  placedCard,
  theServerWithAnAddress,
  theServerWithNoAddress,
} from '../testing/boards-reported.ts';
import { ada, harness, operationNamed } from '../testing/harness.ts';
import { addedFact, recordedIn } from '../testing/loop-registries.ts';
import { nothingReceived } from '../triggers/connection-hearing.ts';
import { connectionEventsOver } from '../triggers/connection-reporting.ts';
import { reportedEventsOf } from './reported-events.ts';

const boards = providersOf(boardsEntryOf([bySubscription, overTheBoardsSocket]));

const ofTheBoards = {
  name: 'boards',
  provider: 'boards',
  status: 'connected',
  app_credentials: heldUnrefused,
} as const;

const theCardMoved = {
  type: cardMoved.type,
  title: cardMoved.title,
  subject: placedCard.subject,
  speed: 'instant',
  data: cardMoved.data,
};

type Status = Parameters<typeof reportedEventsOf>[0]['status'];

const states: readonly (readonly [string, Status, readonly object[]])[] = [
  ['connected', 'connected', [theCardMoved]],
  ['broken, which reports nothing until it is reconnected', 'broken', []],
  ['pending, which reports nothing yet', 'pending', []],
  ['removed', 'removed', []],
];

describe('the events a listed connection reports', () => {
  it.each(states)(
    'are, for a connection %s, the types its entry declares that this runtime hears',
    (_case, status, types) => {
      expect(reportedEventsOf({ ...ofTheBoards, status }, boards, theServerWithAnAddress)).toEqual({
        source: '/connections/boards',
        event_types: types,
      });
    },
  );

  it('are none for a connection given by hand, and none a runtime cannot hear, with the source of each all the same', () => {
    const listed = [
      reportedEventsOf({ ...ofTheBoards, name: 'hooks', provider: null }, boards, theServerWithAnAddress),
      reportedEventsOf(ofTheBoards, boards, nothingReceived),
      reportedEventsOf(ofTheBoards, boards),
    ];

    expect(listed).toEqual([
      { source: '/connections/hooks', event_types: [] },
      { source: '/connections/boards', event_types: [] },
      { source: '/connections/boards', event_types: [] },
    ]);
  });

  it('are each type the app’s one address reports, a type with no place among them, and none of an entry that reports nothing', () => {
    const routed = providersOf(boardsEntryOf([byTheApp]));
    const ofTheTracker = { ...ofTheBoards, name: 'tracked', provider: 'tracker' };

    expect(
      reportedEventsOf(ofTheBoards, routed, autoCloud).event_types.map(({ type, subject }) => [type, subject]),
    ).toEqual([
      [cardMoved.type, placedCard.subject],
      [archived.type, undefined],
    ]);
    expect(
      reportedEventsOf(ofTheTracker, providerListOf(...boards.providers, providerOf(tracker)), autoCloud).event_types,
    ).toEqual([]);
  });

  it('leave out a type its entry declares that no destination this runtime hears maps', () => {
    const { event_types: types } = reportedEventsOf(ofTheBoards, boards, theServerWithNoAddress);

    expect(types.map(({ type }) => type)).toEqual([cardMoved.type]);
    expect(types.map(({ type }) => type)).not.toContain(archived.type);
  });
});

describe('the place of a listed type', () => {
  it('give the place of each type as a trigger writes it, and not how Auto reads the name the service gives it', () => {
    const readingItsName = { tool: 'board_info', with: { board: '{{ subject }}' }, named: '/board/title', prefix: '#' };
    const named = { ...cardMoved, subject: { ...cardMoved.subject, name: readingItsName } };
    const naming = providersOf(boardsEntryOf([byTheApp], undefined, [named, archived]));

    const { event_types: types } = reportedEventsOf(ofTheBoards, naming, autoCloud);

    expect(types.map(({ subject }) => subject)).toEqual([cardMoved.subject, undefined]);
  });
});

const answers = [
  { answer: 'heard', status: 'connected', credentials: heldUnrefused, received: theServerWithNoAddress, listed: true },
  {
    answer: 'lacking, its app credential not held',
    status: 'connected',
    credentials: noneHeld,
    received: theServerWithNoAddress,
    listed: true,
  },
  {
    answer: 'lacking, its app credential refused',
    status: 'connected',
    credentials: heldRefused,
    received: theServerWithNoAddress,
    listed: true,
  },
  {
    answer: 'lacking, on a connection not connected yet',
    status: 'pending',
    credentials: noneHeld,
    received: theServerWithNoAddress,
    listed: false,
  },
  { answer: 'not heard', status: 'connected', credentials: heldUnrefused, received: nothingReceived, listed: false },
] as const;

describe('the events a listed connection reports, by what the one rule answers', () => {
  it.each(answers)(
    'list a type the rule answers $answer for, as the save and the standing read it: $listed',
    ({ status, credentials, received, listed }) => {
      const { event_types: types } = reportedEventsOf(
        { ...ofTheBoards, status, app_credentials: credentials },
        boards,
        received,
      );

      expect(types.map(({ type }) => type).includes(cardMoved.type)).toBe(listed);
    },
  );
});

async function boardsConnected() {
  const ledger = memoryLedger();
  await recordedIn(ledger.service, [
    '2026-11-22T07:00:00.000Z',
    [
      addedFact('connection-1', 'boards', 'boards'),
      {
        type: 'connection_connected',
        data: { connection: 'connection-1', secret_id: 'key-1', connected_by: ada },
      },
    ],
  ]);
  return ledger;
}

describe('list_connections and get_connection', () => {
  it('answer each connection with its source and the events it reports here, each place with how a trigger writes it', async () => {
    const ledger = await boardsConnected();
    const h = harness({ ledger, providers: boards, received: theServerWithAnAddress });

    const listed = await h.call(operationNamed(h.operations, 'list_connections'), ada);
    const read = await h.call(operationNamed(h.operations, 'get_connection'), ada, { id: 'connection-1' });

    const reported = { source: '/connections/boards', event_types: [theCardMoved] };
    expect(listed).toMatchObject({ status: 'succeeded', output: { connections: [reported] } });
    expect(read).toMatchObject({ status: 'succeeded', output: reported });
  });
});

describe('list_connections on a server that opens sockets', () => {
  it('answers a connection without its app credential with the type it lacks it for, which a save naming it is refused as lacking', async () => {
    const ledger = await boardsConnected();
    const h = harness({ ledger, providers: boards, received: theServerWithNoAddress });
    const saved = connectionEventsOver(
      {
        registry: ledger.service,
        providers: Effect.succeed(boards),
        subscriptions: ledger.service,
        received: theServerWithNoAddress,
      },
      () => Effect.succeed([]),
    );

    const listed = await h.call(operationNamed(h.operations, 'list_connections'), ada);
    const hearing = await Effect.runPromise(
      saved.reportingOf({ org: 'acme', playbook: 'alpha' }, 'boards').pipe(
        Effect.flatMap(Effect.fromNullishOr),
        Effect.flatMap((reporting) => reporting.hearing(cardMoved.type, 'board-7')),
        Effect.orDie,
      ),
    );

    expect(listed).toMatchObject({
      status: 'succeeded',
      output: { connections: [{ source: '/connections/boards', event_types: [{ type: cardMoved.type }] }] },
    });
    expect(hearing.kind).toBe('lacking');
  });
});
