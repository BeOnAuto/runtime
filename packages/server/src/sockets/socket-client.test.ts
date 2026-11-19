import type { OpenSocket, SocketEnded, SocketFrame } from '@on.auto/providers';
import { Effect, Function, Redacted } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { aSocketService, type Script, type SocketService } from '../testing/sockets/a-socket-service.ts';
import { mostMessageBytes, socketOverTheNetwork, socketsOverTheNetwork } from './socket-client.ts';

const overPlainSockets = socketsOverTheNetwork(Function.constUndefined);

const scripts: Readonly<Record<string, Script>> = {
  '/talks': ({ send, sendBytes }) => {
    send('first');
    sendBytes([1, 2, 3]);
    send('second');
  },
  '/closes': ({ close }) => {
    close(4001);
  },
  '/floods': ({ send }) => {
    send('x'.repeat(mostMessageBytes + 1));
  },
};

const service: { current?: SocketService } = {};

beforeAll(async () => {
  service.current = await aSocketService(scripts);
});

afterAll(() => service.current?.closed());

function closesHeard(): () => readonly number[] {
  return () => service.current?.closes() ?? [];
}

const at = (path: string) => Redacted.make(service.current?.addressOf(path) ?? '');

type Said = (socket: OpenSocket) => Effect.Effect<void, SocketEnded>;

type Read = SocketFrame | { readonly end: SocketEnded['end']; readonly code: number | null };

function endOf({ end, code }: Pick<SocketEnded, 'end' | 'code'>): Read {
  return { end, code: code ?? null };
}

function framesOf(path: string, count: number, said: Said = Function.constant(Effect.void)): Promise<readonly Read[]> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const socket = yield* overPlainSockets(at(path));
        yield* said(socket);
        const read = Effect.match(socket.next, { onSuccess: Function.identity<Read>, onFailure: endOf });
        return yield* Effect.forEach(Array.from({ length: count }), () => read);
      }),
    ),
  );
}

const notOpenedAt = (path: string) =>
  Effect.runPromise(Effect.map(Effect.scoped(Effect.flip(overPlainSockets(at(path)))), endOf));

describe('the socket the runtime opens over the network', () => {
  it('hands on each text message in order, and a pong for its ping, passes over a binary one, and sends', async () => {
    const frames = await framesOf('/talks', 3, (socket) =>
      Effect.andThen(socket.send('hello from the runtime'), socket.ping),
    );

    expect(frames).toEqual([{ kind: 'message', text: 'first' }, { kind: 'message', text: 'second' }, { kind: 'pong' }]);
    expect(service.current?.received()).toContain('hello from the runtime');
  });

  it('ends closed when the service closes it, or when a message is larger than it takes, which it refuses', async () => {
    const [closed] = await framesOf('/closes', 1);
    const [flooded] = await framesOf('/floods', 1);

    expect([closed, flooded]).toEqual([
      { end: 'closed', code: 4001 },
      { end: 'closed', code: 1006 },
    ]);
    expect(service.current?.closes()).toContain(1009);
  });
});

describe('a socket the service closed', () => {
  it('fails a message sent and a ping as closed', async () => {
    const ends = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const socket = yield* overPlainSockets(at('/closes'));
          yield* Effect.flip(socket.next);
          return [yield* Effect.flip(socket.send('too late')), yield* Effect.flip(socket.ping)];
        }),
      ),
    );

    expect(ends.map((ended: Pick<SocketEnded, 'end'>) => ended.end)).toEqual(['closed', 'closed']);
  });
});

describe('a socket the runtime cannot open', () => {
  it('is not opened where the service refuses the opening or answers a redirect, which it never follows', async () => {
    const ends = await Promise.all(['/refused', '/moved'].map((path) => notOpenedAt(path)));

    expect(ends).toEqual([
      { end: 'not opened', code: null },
      { end: 'not opened', code: null },
    ]);
  });

  it('is opened through the agent of https, which the settings of a proxy reach, and so at a wss address alone', async () => {
    const refused = await Effect.runPromise(Effect.scoped(Effect.flip(socketOverTheNetwork(at('/talks')))));

    expect(refused.end).toBe('not opened');
  });
});

describe('a socket the runtime closes', () => {
  it('is closed with its scope', async () => {
    const closes = closesHeard();
    const before = closes().length;

    await Effect.runPromise(Effect.scoped(Effect.asVoid(overPlainSockets(at('/quiet')))));
    await Effect.runPromise(Effect.repeat(Effect.yieldNow, { until: () => closes().length > before }));

    expect(closes()).toHaveLength(before + 1);
  });
});
