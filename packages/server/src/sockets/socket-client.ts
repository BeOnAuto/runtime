import { globalAgent, type Agent } from 'node:https';

import { SocketEnded, type ConstructsASocket, type OpenSocket, type SocketFrame } from '@on.auto/providers';
import { Deferred, Effect, Exit, Option, Queue, Redacted, Result } from 'effect';
import { WebSocket } from 'ws';

export const mostMessageBytes = 262_144;

const framesWaitingAtMost = 16;

interface Hearing {
  readonly message: (text: string) => void;
  readonly pong: () => void;
  readonly closed: (code: number) => void;
  readonly next: OpenSocket['next'];
}

type Sent = (error?: unknown) => void;

interface Talking {
  readonly send: (text: string, sent: Sent) => void;
  readonly ping: (sent: Sent) => void;
}

interface Opened {
  readonly socket: OpenSocket;
  readonly close: Effect.Effect<void>;
}

const utf8 = new TextDecoder();

function textOf(data: unknown, isBinary: boolean): string | undefined {
  return !isBinary && data instanceof Uint8Array ? utf8.decode(data) : undefined;
}

function closedNow(): SocketEnded {
  return new SocketEnded({ end: 'closed' });
}

function sentBy(talk: (sent: Sent) => void): Effect.Effect<void, SocketEnded> {
  return Effect.callback<void, SocketEnded>((resume) => {
    talk((error) => {
      resume(error === undefined || error === null ? Effect.void : Effect.fail(closedNow()));
    });
  });
}

function openSocketOver({ send, ping }: Talking, { next }: Hearing): OpenSocket {
  return {
    next,
    send: (text) =>
      sentBy((sent) => {
        send(text, sent);
      }),
    ping: sentBy(ping),
  };
}

function madeAt(address: string, agentOf: () => Agent | undefined): Result.Result<WebSocket, unknown> {
  return Result.try(
    () =>
      new WebSocket(address, {
        agent: agentOf(),
        followRedirects: false,
        maxPayload: mostMessageBytes,
        perMessageDeflate: false,
      }),
  );
}

function openedAt(address: string, agentOf: () => Agent | undefined, hearing: Hearing) {
  return Effect.callback<Opened, SocketEnded>((resume) => {
    const notOpened = () => {
      resume(Effect.fail(new SocketEnded({ end: 'not opened' })));
    };
    const made = madeAt(address, agentOf);
    if (Result.isFailure(made)) {
      notOpened();
      return Effect.void;
    }
    const socket = made.success;
    socket.on('message', (data: unknown, isBinary: boolean) => {
      const text = textOf(data, isBinary);
      if (text !== undefined) {
        hearing.message(text);
      }
    });
    socket.on('pong', hearing.pong);
    socket.on('close', (code: number) => {
      hearing.closed(code);
      notOpened();
    });
    socket.on('error', notOpened);
    socket.on('unexpected-response', () => {
      socket.terminate();
    });
    const talking: Talking = {
      send: (text, sent) => {
        socket.send(text, sent);
      },
      ping: (sent) => {
        socket.ping(undefined, undefined, sent);
      },
    };
    const close = Effect.sync(() => {
      socket.terminate();
    });
    socket.once('open', () => {
      resume(Effect.succeed({ socket: openSocketOver(talking, hearing), close }));
    });
    return close;
  });
}

export function socketsOverTheNetwork(agentOf: () => Agent | undefined): ConstructsASocket {
  return (address) =>
    Effect.gen(function* () {
      const frames = yield* Queue.dropping<SocketFrame>(framesWaitingAtMost);
      const ended = yield* Deferred.make<never, SocketEnded>();
      const hearing: Hearing = {
        message: (text) => {
          Queue.offerUnsafe(frames, { kind: 'message', text });
        },
        pong: () => {
          Queue.offerUnsafe(frames, { kind: 'pong' });
        },
        closed: (code) => {
          Deferred.doneUnsafe(ended, Exit.fail(new SocketEnded({ end: 'closed', code })));
        },
        next: Effect.flatMap(
          Queue.poll(frames),
          Option.match({
            onSome: (frame) => Effect.succeed(frame),
            onNone: () => Effect.raceFirst(Queue.take(frames), Deferred.await(ended)),
          }),
        ),
      };
      const { socket } = yield* Effect.acquireRelease(
        openedAt(Redacted.value(address), agentOf, hearing),
        ({ close }) => close,
      );
      return socket;
    });
}

export const socketOverTheNetwork: ConstructsASocket = socketsOverTheNetwork(() => globalAgent);
