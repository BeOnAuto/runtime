import { Effect, Option, Redacted, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Destination } from '../events/destination-fields.ts';
import { eventDestinationOf } from '../reading/provider-list.ts';
import { trackerOverASocket } from '../testing/event-destinations.ts';
import { providersOf } from '../testing/fixture-providers.ts';
import {
  after,
  listenedOver,
  settled,
  type Heard,
  type Hearer,
  type Script,
  type Setting,
} from '../testing/socket-servers.ts';
import { socketBackoff } from './socket-listening.ts';

function socketOf(declared: object): Destination {
  const entry = { ...trackerOverASocket, events: { destinations: [declared] } };
  return Option.getOrThrow(Option.fromNullishOr(eventDestinationOf(providersOf(entry), 'tracker', 'websocket')));
}

const inEnvelopes = socketOf({
  type: 'websocket',
  open: { method: 'POST', url: 'https://api.chat.example.com/connections.open', address: '/url' },
  credential: 'app_level_token',
  acknowledge: '$message.payload#/envelope/id',
  heartbeat_seconds: 30,
  filter: {
    when: { '$message.payload#/kind': ['event'] },
    conversation: '$message.payload#/event/room',
    automatic: '$message.payload#/event/bot',
  },
  connection: { account: '$message.payload#/event/workspace' },
});

const asTopics = socketOf({
  type: 'websocket',
  open: { method: 'GET', url: 'https://api.stream.example.com/socket', address: '/address' },
  credential: 'app_level_token',
  filter: {
    when: { '$message.payload#/topic': ['comments'], '$message.payload#/action': ['created'] },
    conversation: '$message.payload#/data/thread',
  },
  connection: { account: '$message.payload#/organization' },
});

const theAppsValue = 'app-value-7c1e9f2a';

const thePersonsWords = 'Approve the spend of 4,200 for the offsite';

const recorded: Hearer = (record) => (arrival) => Effect.sync(() => record(arrival));

const failingOnce: Hearer = (record) => (arrival) =>
  record(arrival) === 1 ? Effect.die(new Error('no ledger')) : Effect.void;

const failingWithTheWords: Hearer = () => () => Effect.die(new Error(thePersonsWords));

function listened(destination: Destination, script: Script, setting: Setting = {}): Promise<Heard> {
  return listenedOver({ destination, credential: theAppsValue, hearer: recorded, ...setting }, script);
}

function anEvent(fields: object): string {
  return JSON.stringify({ kind: 'event', envelope: { id: 'e-1' }, ...fields });
}

const inTheRoom = { room: 'R1', workspace: 'W1', text: thePersonsWords };

const lineIn = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ level: Schema.String, annotations: Schema.Record(Schema.String, Schema.Unknown) }),
  ),
);

const levelsOf = ({ logged }: Heard) => logged.map((line) => lineIn(line).level);

const acknowledgedIn = ({ server }: Heard) => server.received.map((text): unknown => JSON.parse(text));

function gapsOf(times: readonly number[]): readonly number[] {
  return times.slice(1).map((time, index) => time - (times[index] ?? time));
}

function backoffAt(endsInARow: number): readonly [number, number] {
  const { firstWaitMs, multiplier, longestWaitMs, spread } = socketBackoff;
  const backoffMs = Math.min(firstWaitMs * multiplier ** endsInARow, longestWaitMs);
  return [backoffMs * (1 - spread), backoffMs * (1 + spread)];
}

const longestFirstWait = backoffAt(0)[1];

const isWithin = (milliseconds: number, [least, most]: readonly [number, number]) =>
  milliseconds >= least && milliseconds <= most;

describe('a socket the runtime opens to a service', () => {
  it('is opened once at the start, with the destination and the value of the app', async () => {
    const { server } = await listened(inEnvelopes, () => Effect.void);

    expect([server.attemptsAt.length, server.openedAt.length, server.closedBy()]).toEqual([1, 1, ['the runtime']]);
    expect(server.credentials.map((credential) => Redacted.value(credential))).toEqual([theAppsValue]);
  });

  it("hands each message to the evaluator, and the evaluator's reading to the arrived port", async () => {
    const heard = await listened(inEnvelopes, ({ sends }) =>
      sends(anEvent({ event: inTheRoom })).pipe(Effect.andThen(settled)),
    );

    expect(heard.arrivals).toEqual([{ reading: { wake: { conversation: 'R1' }, connection: { account: 'W1' } } }]);
  });
});

describe('a message over the socket', () => {
  it('is acknowledged once handed on, by its id, at the place the entry says it names it', async () => {
    const heard = await listened(inEnvelopes, ({ sends }) =>
      Effect.forEach([anEvent({ event: inTheRoom }), anEvent({ envelope: { id: 'e-2' } })], sends).pipe(
        Effect.andThen(settled),
      ),
    );

    expect(acknowledgedIn(heard)).toEqual([{ envelope: { id: 'e-1' } }, { envelope: { id: 'e-2' } }]);
  });

  it('wakes nothing where the when does not hold or an app posted it, and hands on nothing empty', async () => {
    const messages = [
      anEvent({ kind: 'hello', event: inTheRoom }),
      anEvent({ event: { ...inTheRoom, bot: 'B1' } }),
      JSON.stringify({ kind: 'notice' }),
      'not JSON',
    ];
    const heard = await listened(inEnvelopes, ({ sends }) =>
      Effect.forEach(messages, sends).pipe(Effect.andThen(settled)),
    );

    expect(heard.arrivals).toEqual([
      { reading: { connection: { account: 'W1' } } },
      { reading: { connection: { account: 'W1' } } },
    ]);
    expect([heard.server.received.length, heard.server.closedBy()]).toEqual([2, ['the runtime']]);
  });

  it('reads a second shape the same way, and acknowledges and pings nothing it does not declare', async () => {
    const message = { topic: 'comments', action: 'created', data: { thread: 'T9' }, organization: 'O1' };
    const heard = await listened(asTopics, ({ sends }) =>
      sends(JSON.stringify(message)).pipe(Effect.andThen(after(600_000))),
    );

    expect(heard.arrivals).toEqual([{ reading: { wake: { conversation: 'T9' }, connection: { account: 'O1' } } }]);
    expect([heard.server.received, heard.server.pinged(), heard.server.openedAt.length]).toEqual([[], 0, 1]);
  });
});

describe('the heartbeat of a socket', () => {
  it('is a ping every heartbeat_seconds while the service answers, by a pong or a message', async () => {
    const pings: number[] = [];
    const { server } = await listened(inEnvelopes, ({ pongs, sends, pinged }) =>
      Effect.gen(function* () {
        yield* after(29_999);
        pings.push(pinged());
        yield* after(1);
        yield* pongs;
        yield* after(30_000);
        yield* sends(anEvent({ kind: 'notice' }));
        yield* after(30_000);
      }),
    );

    expect([pings, server.pinged(), server.closedBy()]).toEqual([[0], 3, ['the runtime']]);
  });

  it('closes a socket that answers none, and opens another after the backoff', async () => {
    const heard = await listened(inEnvelopes, () => after(60_000 + longestFirstWait));

    expect(heard.server.closedBy()).toEqual(['the runtime', 'the runtime']);
    expect(gapsOf(heard.server.openedAt)[0]).toBeGreaterThanOrEqual(60_000 + backoffAt(0)[0]);
    expect(levelsOf(heard)).toEqual(['WARN']);
  });
});

describe('a socket that closes', () => {
  it('is opened again after the backoff, never at once, whether or not the close names a code', async () => {
    const openings: number[] = [];
    const heard = await listened(inEnvelopes, ({ closes, openedAt }) =>
      Effect.gen(function* () {
        yield* closes(1001);
        yield* after(backoffAt(0)[0] - 1);
        openings.push(openedAt.length);
        yield* after(longestFirstWait);
        yield* closes();
        yield* after(longestFirstWait);
      }),
    );

    expect([openings, heard.server.closedBy()]).toEqual([[1], ['the service', 'the service', 'the runtime']]);
    expect(heard.logged.map((line) => Object.keys(lineIn(line).annotations).toSorted())).toEqual([
      ['close_code', 'wait_ms'],
      ['wait_ms'],
    ]);
  });
});

const afterTheClose = (attemptsAt: readonly number[], closedAt: number) =>
  (attemptsAt.at(-1) ?? 0) - (attemptsAt[0] ?? 0) - closedAt;

describe('a socket that cannot be opened', () => {
  it('is tried again, each wait longer, none past the bound, and the first wait again once opened', async () => {
    const refusals = 12;
    const heard = await listened(
      asTopics,
      ({ closes }) => after(3_600_000).pipe(Effect.andThen(closes()), Effect.andThen(after(longestFirstWait))),
      { refusals },
    );
    const { attemptsAt } = heard.server;
    const waits = gapsOf(attemptsAt.slice(0, -1));

    expect([attemptsAt.length, levelsOf(heard).filter((level) => level === 'WARN').length]).toEqual([14, refusals]);
    expect(waits.map((wait, ends) => isWithin(wait, backoffAt(ends)))).toEqual(waits.map(() => true));
    expect(Math.max(...waits)).toBeLessThanOrEqual(socketBackoff.longestWaitMs * (1 + socketBackoff.spread));
    expect(isWithin(afterTheClose(attemptsAt, 3_600_000), backoffAt(0))).toBe(true);
  });

  it('is given up when it does not open within the bound of an opening, and tried again', async () => {
    const heard = await listened(
      inEnvelopes,
      ({ hang }) =>
        after(socketBackoff.openingMs).pipe(
          Effect.andThen(
            Effect.sync(() => {
              hang(false);
            }),
          ),
          Effect.andThen(after(longestFirstWait)),
        ),
      { hanging: true },
    );

    expect([heard.server.attemptsAt.length, heard.server.openedAt.length]).toEqual([2, 1]);
    expect(gapsOf(heard.server.attemptsAt)[0]).toBeGreaterThanOrEqual(socketBackoff.openingMs + backoffAt(0)[0]);
  });
});

describe('what the socket hands on', () => {
  it('leaves a message it could not hand on unacknowledged, and goes on with the next', async () => {
    const messages = [anEvent({ event: inTheRoom }), anEvent({ envelope: { id: 'e-2' }, event: inTheRoom })];
    const heard = await listened(
      inEnvelopes,
      ({ sends }) => Effect.forEach(messages, sends).pipe(Effect.andThen(settled)),
      { hearer: failingOnce },
    );

    expect(acknowledgedIn(heard)).toEqual([{ envelope: { id: 'e-2' } }]);
    expect([levelsOf(heard), heard.server.openedAt.length]).toEqual([['ERROR'], 1]);
  });

  it("never writes the value of the app or a message's words in a log or a failure", async () => {
    const heard = await listened(
      inEnvelopes,
      ({ sends, closes }) =>
        Effect.gen(function* () {
          yield* after(longestFirstWait);
          yield* sends(anEvent({ event: inTheRoom }));
          yield* settled;
          yield* closes(1006);
          yield* after(60_000 + 2 * longestFirstWait);
        }),
      { refusals: 1, hearer: failingWithTheWords },
    );
    const written = [...heard.logged, JSON.stringify(heard.server.credentials)].join('\n');

    expect(levelsOf(heard)).toEqual(['WARN', 'ERROR', 'INFO', 'WARN']);
    expect([written.includes(theAppsValue), written.includes(thePersonsWords)]).toEqual([false, false]);
  });
});
