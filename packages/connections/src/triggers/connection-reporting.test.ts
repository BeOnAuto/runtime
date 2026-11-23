import { generationOf, isArranging, type EventDestination } from '@on.auto/providers';
import { cardMoved } from '@on.auto/providers/testing';
import { Effect, Struct } from 'effect';
import { describe, expect, it } from 'vitest';

import { mostSubscriptionsThroughAConnection } from '../subscriptions/loop-ports.ts';
import { subscriptionRecordsOf } from '../subscriptions/subscription-records.ts';
import {
  alpha,
  at,
  boardNamed,
  boardsProviders,
  boardsReportingTo,
  connectedAgain,
  type BoardsReporting,
  type Naming,
} from '../testing/boards-connections.ts';
import { theServerWithAnAddress, theServerWithNoAddress } from '../testing/boards-reported.ts';
import type { EventsReceived } from './connection-hearing.ts';

const named = ['boards', 'mended', 'by-hand', 'waiting', 'old', 'gone', 'sales-boards', 'unknown'];

type Reported = Effect.Success<ReturnType<BoardsReporting['events']['reportingOf']>>;

function shownAs(reported: Reported) {
  return reported === undefined
    ? undefined
    : { status: reported.status, types: reported.types.length, listened: reported.listenedBy.length };
}

async function heardThrough(received: EventsReceived, connection: string, subject: string | undefined) {
  const { events } = await boardsReportingTo(received);
  const reported = events.reportingOf(alpha, connection).pipe(Effect.flatMap(Effect.fromNullishOr), Effect.orDie);
  return at(Effect.flatMap(reported, (each) => each.hearing(cardMoved.type, subject)));
}

describe('what a connection reports, for the triggers of a playbook it serves', () => {
  it('is whether it is pending, connected or broken, the types its entry declares and what the playbook listens to through it, for each connection that serves the playbook', async () => {
    const { events } = await boardsReportingTo(theServerWithAnAddress);

    const reported = await Effect.runPromise(Effect.forEach(named, (name) => events.reportingOf(alpha, name)));

    expect(reported.map((each) => shownAs(each))).toEqual([
      { status: 'connected', types: 2, listened: 1 },
      { status: 'broken', types: 2, listened: 1 },
      { status: 'connected', types: 0, listened: 0 },
      { status: 'pending', types: 2, listened: 0 },
      { status: 'broken', types: 0, listened: 0 },
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('holds at most as many places through one connection as the subscription loop does', () => {
    expect(mostSubscriptionsThroughAConnection).toBe(8);
  });
});

const hearings = [
  {
    heard: 'through a subscription to the place named, where an address is set',
    received: theServerWithAnAddress,
    connection: 'boards',
    subject: 'board-7',
    hearing: { kind: 'heard', subscribes: { topic: 'board-7', mostTopics: mostSubscriptionsThroughAConnection } },
  },
  {
    heard: 'through a subscription with no place, where none is named',
    received: theServerWithAnAddress,
    connection: 'boards',
    subject: undefined,
    hearing: { kind: 'heard' },
  },
  {
    heard: 'over a socket, where no address is set',
    received: theServerWithNoAddress,
    connection: 'boards',
    subject: 'board-7',
    hearing: { kind: 'heard' },
  },
  {
    heard: 'lacking the app credential the socket takes',
    received: theServerWithNoAddress,
    connection: 'tokenless',
    subject: 'board-7',
    hearing: { kind: 'lacking', label: 'Chat app-level token' },
  },
  {
    heard: 'not at all, through a connection given by hand',
    received: theServerWithAnAddress,
    connection: 'by-hand',
    subject: 'board-7',
    hearing: { kind: 'not_heard' },
  },
] as const;

describe('an event a connection reports, as this runtime hears it', () => {
  it.each(hearings)('is heard $heard', async ({ received, connection, subject, hearing }) => {
    expect(await heardThrough(received, connection, subject)).toEqual(hearing);
  });
});

interface Asked {
  readonly connection: string;
  readonly subject?: string;
  readonly paused?: boolean;
}

async function standingIn(
  { events }: Pick<BoardsReporting, 'events'>,
  { connection, subject, paused = false }: Asked,
): Promise<Readonly<Record<string, unknown>>> {
  const asked = { connection, type: cardMoved.type, paused, ...(subject === undefined ? {} : { subject }) };
  const standing = Struct.omit(await at(events.standingOf(alpha, asked)), ['speed']);
  return { ...standing, notListeningBecause: standing.notListeningBecause?.kind ?? null };
}

function declaredOfTheBoards(): string {
  const destinations: readonly EventDestination[] = boardsProviders.providers.flatMap(
    ({ entry }) => entry.events?.destinations ?? [],
  );
  const arranging = destinations.find((destination) => isArranging(destination));
  return arranging !== undefined && isArranging(arranging) ? generationOf(undefined, arranging).declared : '';
}

const theBoard = { connection: 'boards', subject: 'board-7' } as const;

interface NotListening {
  readonly stands: string;
  readonly asked: Asked;
  readonly kind: string;
}

const notListening: readonly NotListening[] = [
  { stands: 'a workflow paused', asked: { ...theBoard, paused: true }, kind: 'workflow_paused' },
  { stands: 'a connection gone', asked: { connection: 'gone', subject: 'board-7' }, kind: 'connection_gone' },
  {
    stands: 'a pending connection',
    asked: { connection: 'waiting', subject: 'board-7' },
    kind: 'connection_pending',
  },
  { stands: 'a broken connection', asked: { connection: 'mended', subject: 'board-7' }, kind: 'connection_broken' },
  {
    stands: 'a connection whose identity is not recorded',
    asked: { connection: 'tokenless', subject: 'board-7' },
    kind: 'account_not_recorded',
  },
  { stands: 'a trigger that names no place', asked: { connection: 'boards' }, kind: 'setting_up' },
  {
    stands: 'a connection given by hand',
    asked: { connection: 'by-hand', subject: 'board-7' },
    kind: 'not_received_here',
  },
];

describe('how a trigger that starts from a connection stands, as the records say', () => {
  it('is setting up until the subscription is made as the entry declares it, then listening, and named by the event the entry declares', async () => {
    const reporting = await boardsReportingTo(theServerWithAnAddress);
    const before = await standingIn(reporting, theBoard);
    const made = { type: 'webhook', id: 'hook-1', declared: declaredOfTheBoards() } as const;
    await at(
      subscriptionRecordsOf(reporting.subscriptions).made(alpha, { connection: 'boards', topic: 'board-7' }, made),
    );

    expect([before, await standingIn(reporting, theBoard)]).toEqual([
      { event: cardMoved.title, listening: false, notListeningBecause: 'setting_up', needsReconnecting: false },
      { event: cardMoved.title, listening: true, notListeningBecause: null, needsReconnecting: false },
    ]);
  });

  it.each(notListening)('is not listening for $stands', async ({ asked, kind }) => {
    const reporting = await boardsReportingTo(theServerWithAnAddress);

    expect((await standingIn(reporting, asked))['notListeningBecause']).toBe(kind);
  });
});

describe('how a trigger stands where nothing is subscribed, or its event is not named', () => {
  it('is listening over a socket, with nothing subscribed, and lacking where the app credential is not held', async () => {
    const reporting = await boardsReportingTo(theServerWithNoAddress);

    expect([
      await standingIn(reporting, theBoard),
      await standingIn(reporting, { connection: 'tokenless', subject: 'board-7' }),
    ]).toEqual([
      { event: cardMoved.title, listening: true, notListeningBecause: null, needsReconnecting: false },
      {
        event: cardMoved.title,
        listening: false,
        notListeningBecause: 'app_credential_needed',
        needsReconnecting: true,
      },
    ]);
  });

  it('names no event where the connection is gone, or its entry does not declare the type', async () => {
    const reporting = await boardsReportingTo(theServerWithAnAddress);

    const unnamed = [
      await standingIn(reporting, { connection: 'unknown' }),
      await standingIn(reporting, { connection: 'by-hand', subject: 'board-7' }),
    ];

    expect(unnamed.map((standing) => 'event' in standing)).toEqual([false, false]);
  });
});

const readingTheBoardsName = { tool: 'board_info', with: { board: '{{ subject }}' }, named: '/board/title' };

const boardsNamed: NonNullable<Naming['after']> = [
  [
    '2026-11-22T08:30:00.000Z',
    [boardNamed('connection-1', 'board-7', 'Roadmap'), boardNamed('connection-7', 'board-8', 'Launches')],
  ],
];

interface NamedPlace {
  readonly answers: string;
  readonly placeName: object;
  readonly asked: Asked;
  readonly subjectName: string | undefined;
}

const namedPlaces: readonly NamedPlace[] = [
  {
    answers: 'the name held for its place, with the prefix the entry declares before it',
    placeName: { ...readingTheBoardsName, prefix: '#' },
    asked: theBoard,
    subjectName: '#Roadmap',
  },
  {
    answers: 'the name held for its place as it is held, where the entry declares no prefix',
    placeName: readingTheBoardsName,
    asked: theBoard,
    subjectName: 'Roadmap',
  },
  {
    answers: 'no name for a place no name is held for',
    placeName: readingTheBoardsName,
    asked: { connection: 'boards', subject: 'board-9' },
    subjectName: undefined,
  },
  {
    answers: 'no name for a place whose name is held through another connection',
    placeName: readingTheBoardsName,
    asked: { connection: 'boards', subject: 'board-8' },
    subjectName: undefined,
  },
  {
    answers: 'no name through a connection that holds a name for another place',
    placeName: readingTheBoardsName,
    asked: { connection: 'tokenless', subject: 'board-7' },
    subjectName: undefined,
  },
  {
    answers: 'no name where the trigger names no place',
    placeName: readingTheBoardsName,
    asked: { connection: 'boards' },
    subjectName: undefined,
  },
  {
    answers: 'no name where the connection is gone',
    placeName: readingTheBoardsName,
    asked: { connection: 'gone', subject: 'board-7' },
    subjectName: undefined,
  },
];

describe('the name of the place a trigger listens in, as the org’s connections hold it', () => {
  it.each(namedPlaces)(
    'is $answers, and the trigger stands as it does with no name held',
    async ({ placeName, asked, subjectName }) => {
      const holdingNames = await boardsReportingTo(theServerWithAnAddress, { placeName, after: boardsNamed });
      const { subjectName: answered, ...stands } = await standingIn(holdingNames, asked);

      expect([answered, stands]).toEqual([
        subjectName,
        await standingIn(await boardsReportingTo(theServerWithAnAddress), asked),
      ]);
    },
  );

  it('is left out once the connection is connected again, which clears the names it held', async () => {
    const connectedOnceMore: NonNullable<Naming['after']> = [
      ...boardsNamed,
      ['2026-11-22T09:00:00.000Z', [connectedAgain('connection-1')]],
    ];
    const reporting = await boardsReportingTo(theServerWithAnAddress, {
      placeName: readingTheBoardsName,
      after: connectedOnceMore,
    });

    expect(await standingIn(reporting, theBoard)).not.toHaveProperty('subjectName');
  });
});
