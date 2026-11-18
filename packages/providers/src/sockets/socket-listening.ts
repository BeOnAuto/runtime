import { Duration, Effect, Random, Ref, type Redacted } from 'effect';

import { arrivalReadingOf, type ArrivalReading } from '../events/arrival-readings.ts';
import type { Destination } from '../events/destination-fields.ts';
import { acknowledgementOf, messageArrivalOf } from './socket-messages.ts';
import { SocketEnded, type Arrived, type OpenSocket, type OpensASocket, type SocketFrame } from './socket-ports.ts';

export interface SocketListening {
  readonly destination: Destination;
  readonly credential: Redacted.Redacted;
  readonly opens: OpensASocket;
  readonly arrived: Arrived;
}

export const socketBackoff = {
  firstWaitMs: 1000,
  multiplier: 1.6,
  longestWaitMs: 120_000,
  spread: 0.2,
  openingMs: 20_000,
} as const;

const socketWords = {
  notOpened: "The socket to a connection's service could not be opened; it is opened again after a wait",
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

function oneSocket(listening: SocketListening, opened: Effect.Effect<void>): Effect.Effect<never, SocketEnded> {
  const { opens, destination, credential } = listening;
  return Effect.scoped(
    opens({ destination, credential }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(socketBackoff.openingMs),
        orElse: () => Effect.fail(new SocketEnded({ end: 'not opened' })),
      }),
      Effect.tap(() => opened),
      Effect.flatMap((socket) => lifeOf(listening, socket)),
    ),
  );
}

function waitAfter(endsInARow: number): Effect.Effect<number> {
  const { firstWaitMs, multiplier, longestWaitMs, spread } = socketBackoff;
  const backoffMs = Math.min(firstWaitMs * multiplier ** endsInARow, longestWaitMs);
  return Effect.map(Random.nextBetween(1 - spread, 1 + spread), (jitter) => Math.round(backoffMs * jitter));
}

const loggedEnds = {
  'not opened': Effect.logWarning(socketWords.notOpened),
  closed: Effect.logInfo(socketWords.closed),
  silent: Effect.logWarning(socketWords.silent),
} as const;

function waitedAfter({ end, code }: Pick<SocketEnded, 'end' | 'code'>, endsInARow: number): Effect.Effect<void> {
  return Effect.flatMap(waitAfter(endsInARow), (waitMs) =>
    loggedEnds[end].pipe(
      Effect.annotateLogs(code === undefined ? { wait_ms: waitMs } : { wait_ms: waitMs, close_code: code }),
      Effect.andThen(Effect.sleep(Duration.millis(waitMs))),
    ),
  );
}

export function receivingOverASocket(listening: SocketListening): Effect.Effect<never> {
  return Effect.gen(function* () {
    const endsInARow = yield* Ref.make(0);
    const aSocketAndTheWaitAfterIt = Effect.gen(function* () {
      const ended = yield* Effect.flip(oneSocket(listening, Ref.set(endsInARow, 0)));
      yield* waitedAfter(ended, yield* Ref.getAndUpdate(endsInARow, (ends) => ends + 1));
    });
    return yield* Effect.forever(aSocketAndTheWaitAfterIt);
  });
}
