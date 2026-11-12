import type { FetchLike } from '@modelcontextprotocol/client';
import { Duration, Effect, Fiber, Logger, Redacted } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import {
  finishAskedThrough,
  gatewayServed,
  handedOverAt,
  refusalOf,
  startAskedThrough,
  switchedOn,
  wayThrough,
} from '../consent-testing/gateway-asking.ts';
import { consentClientWith, studioBase } from '../testing/index.ts';
import { gatewayClientId, testAccount } from '../testing/served-fakes.ts';
import { until } from '../testing/until.ts';
import { unendedWords } from './gateway-consents.ts';

function loggingInto(log: (line: string) => void) {
  return Logger.layer([Logger.map(Logger.formatJson, log)]);
}

function isAnEnd(address: unknown): boolean {
  return String(address).endsWith('/connections/remove');
}

function endsTimedInto(asked: (at: number) => void): FetchLike {
  return (...[address, init]: readonly [unknown, unknown?]) => {
    if (isAnEnd(address)) {
      asked(Date.now());
    }
    return globalThis.fetch(String(address), Object.assign({}, init));
  };
}

function hangingAtTheEnd(asked: () => void): FetchLike {
  return (...[address, init]: readonly [unknown, unknown?]) => {
    if (!isAnEnd(address)) {
      return globalThis.fetch(String(address), Object.assign({}, init));
    }
    asked();
    return new Promise<Response>(() => {});
  };
}

const aChallenge: unknown = expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u);

describe('the source of the client of a way through a gateway', () => {
  it('is the gateway only where whoever composes the runtime switches gateways on', async () => {
    const gateway = await gatewayServed();
    const way = wayThrough(gateway);
    const sourcesOf = async (client: ReturnType<typeof switchedOn>) => {
      const had = await Effect.runPromise(client.hadSources(studioBase));
      return [had.sourcesOf(way), had.sourceOf(way)];
    };

    expect(await sourcesOf(switchedOn())).toEqual([['gateway'], 'gateway']);
    expect(await sourcesOf(consentClientWith())).toEqual([[], undefined]);
    expect(await sourcesOf(consentClientWith({ gateways: false }))).toEqual([[], undefined]);
  });
});

describe('a start through a gateway', () => {
  it('sends a challenge and the runtime’s own state, which it answers back with the gateway’s client', async () => {
    const gateway = await gatewayServed();
    const asked = startAskedThrough(gateway);

    const started = await Effect.runPromise(switchedOn().start(asked));

    expect(new URL(started.url).searchParams.get('state')).toBe(asked.state);
    expect(started).toMatchObject({
      state: asked.state,
      client: { client_id: gatewayClientId, client_source: 'gateway' },
    });
    const [request] = gateway.seen();
    expect(request).toMatchObject({ method: 'POST', path: '/connections' });
    expect(JSON.parse(String(request?.body))).toEqual({
      challenge: aChallenge,
      challenge_method: 'S256',
      state: asked.state,
    });
    expect(request?.headers).not.toHaveProperty('authorization');
  });
});

describe('a hand-off through a gateway', () => {
  it('hands over the connection’s key, the account it is for and the scope granted, for the verifier of the start', async () => {
    const gateway = await gatewayServed({ scope: 'channels:read chat:write' });

    const { started, finished } = await handedOverAt(gateway);

    expect(gateway.keys()).toEqual([Redacted.value(finished.tokens)]);
    expect(finished).toMatchObject({ client: started.client, scope: 'channels:read chat:write', account: testAccount });
  });

  it('hands over no scope where the gateway answers none, and an account without a name where it names none', async () => {
    const gateway = await gatewayServed({ account: { id: 'A0002' } });

    const { finished } = await handedOverAt(gateway);

    expect([finished.scope, finished.account]).toEqual([undefined, { id: 'A0002' }]);
  });
});

describe('the key a gateway just handed over, given back', () => {
  it('is ended at the gateway, once', async () => {
    const gateway = await gatewayServed();
    const { finished } = await handedOverAt(gateway);

    await Effect.runPromise(finished.revoked);

    expect([gateway.keys(), gateway.ended()]).toEqual([[], [Redacted.value(finished.tokens)]]);
  });
});

describe('the key a gateway just handed over, which the gateway will not end', () => {
  it('is tried three times with a pause that doubles, then logged at the error level, naming the gateway and no key', async () => {
    const gateway = await gatewayServed();
    const asked: number[] = [];
    const client = switchedOn({
      fetch: endsTimedInto((at) => {
        asked.push(at);
      }),
      gatewayEndPauseMs: 40,
    });
    const { finished } = await handedOverAt(gateway, client);
    gateway.answering('end', 503);
    const logged: string[] = [];

    await Effect.runPromise(
      finished.revoked.pipe(
        Effect.provide(
          loggingInto((line) => {
            logged.push(line);
          }),
        ),
      ),
    );

    const [first = 0, second = 0, third = 0] = asked;
    expect([asked.length, second - first >= 40, third - second >= 80]).toEqual([3, true, true]);
    expect(logged).toEqual([expect.stringContaining(unendedWords(gateway.url))]);
    expect(logged.join('')).toContain('"level":"ERROR"');
    expect(logged.join('')).not.toContain(Redacted.value(finished.tokens));
  });
});

describe('the key a gateway just handed over, at a gateway that does not answer', () => {
  it('is given up after five seconds, and logged', async () => {
    const gateway = await gatewayServed();
    const hanging = { asked: false };
    const client = switchedOn({
      fetch: hangingAtTheEnd(() => {
        hanging.asked = true;
      }),
    });
    const { finished } = await handedOverAt(gateway, client);
    const logged: string[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        const ending = yield* Effect.forkChild(finished.revoked);
        yield* Effect.promise(() => until(() => hanging.asked));
        yield* TestClock.adjust(Duration.seconds(5));
        yield* Fiber.join(ending);
      }).pipe(
        Effect.provide([
          TestClock.layer(),
          loggingInto((line) => {
            logged.push(line);
          }),
        ]),
      ),
    );

    expect(logged).toEqual([expect.stringContaining(unendedWords(gateway.url))]);
  });
});

describe('a start a gateway refuses or does not answer', () => {
  it('is refused as the gateway refused it, unanswered for any other answer, and by the rule where the host is not reached', async () => {
    const gateway = await gatewayServed();
    const asked = startAskedThrough(gateway);
    gateway.answering('start', 400);
    const refusedByTheGateway = await refusalOf(switchedOn().start(asked));
    gateway.answering('start', 503);
    const failing = await refusalOf(switchedOn().start(asked));
    gateway.answering('start', 201, { url: 'https://gateway.example.com/install' });
    const unreadable = await refusalOf(switchedOn().start(asked));
    gateway.answeringAsItself('start');
    const unreached = await refusalOf(switchedOn().start({ ...asked, reaches: () => 'Not this host' }));

    expect([refusedByTheGateway, failing, unreadable, unreached]).toEqual([
      { refused: 'start_refused' },
      { refused: 'unanswered' },
      { refused: 'unanswered' },
      { refused: 'host', rule: 'Not this host' },
    ]);
  });
});

describe('a hand-off a gateway refuses', () => {
  it('is a refused handle for an unknown handle, a wrong verifier, and a refusal with a word', async () => {
    const gateway = await gatewayServed();
    const client = switchedOn();
    const started = await Effect.runPromise(client.start(startAskedThrough(gateway)));
    const asked = finishAskedThrough(gateway, started, gateway.allow(started.url).handle);
    const wrongVerifier = await refusalOf(client.finish({ ...asked, verifier: Redacted.make('another-verifier') }));
    const unknown = await refusalOf(client.finish({ ...asked, handle: 'unknown-handle' }));
    gateway.answering('handoff', 403, { refused: 'other_person' });
    const otherPerson = await refusalOf(client.finish(asked));
    gateway.answering('handoff', 409, { refused: 'other_auto_person' });
    const otherAutoPerson = await refusalOf(client.finish(asked));

    expect([wrongVerifier, unknown, otherPerson, otherAutoPerson]).toEqual([
      { refused: 'code' },
      { refused: 'code' },
      { refused: 'code' },
      { refused: 'code' },
    ]);
    expect(gateway.keys()).toEqual([]);
  });
});

describe('a hand-off a gateway answers with no key', () => {
  it('is unanswered, for a refusal without a word, a failure and an answer without a key, and ends nothing', async () => {
    const gateway = await gatewayServed();
    const client = switchedOn();
    const started = await Effect.runPromise(client.start(startAskedThrough(gateway)));
    const asked = finishAskedThrough(gateway, started, gateway.allow(started.url).handle);
    gateway.answering('handoff', 403, { detail: 'No note' });
    const unsaid = await refusalOf(client.finish(asked));
    gateway.answering('handoff', 503, { detail: 'Down' });
    const down = await refusalOf(client.finish(asked));
    gateway.answering('handoff', 200, { account: { id: 'A1' } });
    const keyless = await refusalOf(client.finish(asked));

    expect([unsaid, down, keyless]).toEqual([
      { refused: 'unanswered' },
      { refused: 'unanswered' },
      { refused: 'unanswered' },
    ]);
    expect(gateway.seen().filter(({ path }) => path === '/connections/remove')).toEqual([]);
  });
});

describe('a hand-off whose key comes with an account or a scope the runtime does not take', () => {
  it('ends the key it was handed and refuses the hand-off as unread, for an account with no id, an id past its bound and a scope of another shape', async () => {
    const gateway = await gatewayServed();
    const client = switchedOn();
    const started = await Effect.runPromise(client.start(startAskedThrough(gateway)));
    const asked = finishAskedThrough(gateway, started, gateway.allow(started.url).handle);
    gateway.answering('handoff', 200, { connection_key: 'key-1', account: { id: '' } });
    const unnamed = await refusalOf(client.finish(asked));
    gateway.answering('handoff', 200, { connection_key: 'key-2', account: { id: 'i'.repeat(257) } });
    const tooLong = await refusalOf(client.finish(asked));
    gateway.answering('handoff', 200, { connection_key: 'key-3', account: { id: 'A1' }, scope: 'two  spaces' });
    const unscoped = await refusalOf(client.finish(asked));

    expect([unnamed, tooLong, unscoped]).toEqual([
      { refused: 'handoff_unread' },
      { refused: 'handoff_unread' },
      { refused: 'handoff_unread' },
    ]);
    expect(
      gateway
        .seen()
        .filter(({ path }) => path === '/connections/remove')
        .map(({ body }) => body),
    ).toEqual(['key-1', 'key-2', 'key-3'].map((key) => JSON.stringify({ connection_key: key })));
  });
});

describe('a hand-off whose account names itself in a way a person cannot read', () => {
  it('keeps the account by its id alone, so an empty or over-long name never fails the connection', async () => {
    const gateway = await gatewayServed();
    const client = switchedOn();
    const started = await Effect.runPromise(client.start(startAskedThrough(gateway)));
    const asked = finishAskedThrough(gateway, started, gateway.allow(started.url).handle);
    gateway.answering('handoff', 200, { connection_key: 'key-1', account: { id: 'A1', name: '' } });
    const empty = await Effect.runPromise(client.finish(asked));
    gateway.answering('handoff', 200, { connection_key: 'key-2', account: { id: 'A1', name: 'n'.repeat(257) } });
    const overLong = await Effect.runPromise(client.finish(asked));
    gateway.answering('handoff', 200, { connection_key: 'key-3', account: { id: 'A1', name: 7 } });
    const notText = await Effect.runPromise(client.finish(asked));

    expect([empty.account, overLong.account, notText.account]).toEqual([{ id: 'A1' }, { id: 'A1' }, { id: 'A1' }]);
  });
});
