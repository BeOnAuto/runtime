import { Duration, Effect, Random, Ref } from 'effect';

import { arrivalReadingOf, type ArrivalReading } from '../events/arrival-readings.ts';
import { acknowledgementOf, messageArrivalOf } from './socket-messages.ts';
import {
  SocketEnded,
  type Arrived,
  type OpenSocket,
  type OpensASocket,
  type SocketEnd,
  type SocketFrame,
  type SocketOpening,
} from './socket-ports.ts';

export interface SocketListening extends SocketOpening {
  readonly opens: OpensASocket;
  readonly arrived: Arrived;
  readonly opened: Effect.Effect<void>;
  readonly ended: (end: SocketEnd) => Effect.Effect<void>;
}

export const socketBackoff = {
  firstWaitMs: 1000,
  multiplier: 1.6,
  longestWaitMs: 120_000,
  spread: 0.2,
  openingMs: 20_000,
} as const;

const socketWords = {
  opened: "The socket to a connection's service is open",
  notOpened: "The socket to a connection's service could not be opened; it is opened again after a wait",
  refused:
    "The service refused the value of the app that opens the socket to a connection's service, so the socket is not opened again with it",
  closed: "The socket to a connection's service closed; it is opened again after a wait",
  silent:
    "The socket to a connection's service answered no heartbeat, so it was closed; it is opened again after a wait",
  notHandedOn:
    "What arrived over the socket to a connection's service could not be handed on, so it was not acknowledged",
} as const;

function handedOn(arrived: Arrived, reading: ArrivalReading): Effect.Effect<boolean> {
  if (Object.keys(reading).length === 0) {
    return Effect.succeed(true);
  }
  return arrived({ reading }).pipe(
    Effect.as(true),
    Effect.catchDefect(() => Effect.as(Effect.logError(socketWords.notHandedOn), false)),
  );
}

function messageHandled(
  { destination, arrived }: SocketListening,
  socket: OpenSocket,
  text: string,
): Effect.Effect<void, SocketEnded> {
  const arrival = messageArrivalOf(text);
  if (arrival === undefined) {
    return Effect.void;
  }
  const acknowledgement = acknowledgementOf(destination, arrival);
  return Effect.flatMap(handedOn(arrived, arrivalReadingOf(destination, arrival)), (handed) =>
    handed && acknowledgement !== undefined ? socket.send(acknowledgement) : Effect.void,
  );
}

function frameHandled(
  listening: SocketListening,
  socket: OpenSocket,
  frame: SocketFrame,
): Effect.Effect<void, SocketEnded> {
  return frame.kind === 'message' ? messageHandled(listening, socket, frame.text) : Effect.void;
}

function heartbeat(
  socket: OpenSocket,
  seconds: number,
  heardSinceTheLast: Effect.Effect<boolean>,
): Effect.Effect<never, SocketEnded> {
  const beat = Effect.sleep(Duration.seconds(seconds)).pipe(
    Effect.andThen(heardSinceTheLast),
    Effect.flatMap((heard): Effect.Effect<void, SocketEnded> =>
      heard ? socket.ping : Effect.fail(new SocketEnded({ end: 'silent' })),
    ),
  );
  return Effect.forever(beat);
}

function lifeOf(listening: SocketListening, socket: OpenSocket): Effect.Effect<never, SocketEnded> {
  return Effect.gen(function* () {
    const heard = yield* Ref.make(true);
    const frames = Effect.forever(
      Effect.flatMap(socket.next, (frame) =>
        Ref.set(heard, true).pipe(Effect.andThen(frameHandled(listening, socket, frame))),
      ),
    );
    const seconds = listening.destination.heartbeat_seconds;
    return yield* seconds === undefined
      ? frames
      : Effect.raceFirst(frames, heartbeat(socket, seconds, Ref.getAndSet(heard, false)));
  });
}

function openingOf({ destination, credential, failureCodes }: SocketListening): SocketOpening {
  return failureCodes === undefined ? { destination, credential } : { destination, credential, failureCodes };
}

function openedWithin(opens: OpensASocket, opening: SocketOpening) {
  return opens(opening).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(socketBackoff.openingMs),
      orElse: () => Effect.fail(new SocketEnded({ end: 'not opened' })),
    }),
  );
}

export function openedAndClosed(opens: OpensASocket, opening: SocketOpening): Effect.Effect<void, SocketEnded> {
  return Effect.scoped(Effect.asVoid(openedWithin(opens, opening)));
}

function oneSocket(listening: SocketListening, opened: Effect.Effect<void>): Effect.Effect<never, SocketEnded> {
  return Effect.scoped(
    openedWithin(listening.opens, openingOf(listening)).pipe(
      Effect.tap(() => opened),
      Effect.flatMap((socket) => lifeOf(listening, socket)),
    ),
  );
}

export function waitAfter(endsInARow: number): Effect.Effect<number> {
  const { firstWaitMs, multiplier, longestWaitMs, spread } = socketBackoff;
  const backoffMs = Math.min(firstWaitMs * multiplier ** endsInARow, longestWaitMs);
  return Effect.map(Random.nextBetween(1 - spread, 1 + spread), (jitter) => Math.round(backoffMs * jitter));
}

type RetriedEnd = Exclude<SocketEnd, 'refused'>;

const loggedEnds: Readonly<Record<RetriedEnd, Effect.Effect<void>>> = {
  'not opened': Effect.logWarning(socketWords.notOpened),
  closed: Effect.logInfo(socketWords.closed),
  silent: Effect.logWarning(socketWords.silent),
};

function annotationsOf({ code, host }: Pick<SocketEnded, 'code' | 'host'>, waitMs: number) {
  return {
    wait_ms: waitMs,
    ...(code === undefined ? {} : { close_code: code }),
    ...(host === undefined ? {} : { host }),
  };
}

function waitedAfter(ended: Pick<SocketEnded, 'code' | 'host'>, end: RetriedEnd, endsInARow: number) {
  return Effect.flatMap(waitAfter(endsInARow), (waitMs) =>
    loggedEnds[end].pipe(
      Effect.annotateLogs(annotationsOf(ended, waitMs)),
      Effect.andThen(Effect.sleep(Duration.millis(waitMs))),
    ),
  );
}

interface EndsInARow {
  readonly reset: Effect.Effect<void>;
  readonly counted: Effect.Effect<number>;
}

function openedNow(listening: SocketListening, endsInARow: EndsInARow): Effect.Effect<void> {
  return endsInARow.reset.pipe(Effect.andThen(Effect.logInfo(socketWords.opened)), Effect.andThen(listening.opened));
}

function aSocketAndTheWaitAfterIt(listening: SocketListening, endsInARow: EndsInARow): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const ended = yield* Effect.flip(oneSocket(listening, openedNow(listening, endsInARow)));
    yield* listening.ended(ended.end);
    if (ended.end === 'refused') {
      yield* Effect.logWarning(socketWords.refused);
      return true;
    }
    yield* waitedAfter(ended, ended.end, yield* endsInARow.counted);
    return false;
  });
}

export function receivingOverASocket(listening: SocketListening): Effect.Effect<void> {
  return Effect.gen(function* () {
    const ends = yield* Ref.make(0);
    const endsInARow = { reset: Ref.set(ends, 0), counted: Ref.getAndUpdate(ends, (counted) => counted + 1) };
    yield* Effect.repeat(aSocketAndTheWaitAfterIt(listening, endsInARow), { until: (refused) => refused });
  });
}
