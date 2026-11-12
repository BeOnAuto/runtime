import { Effect, Exit, Logger, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  finishAskedThrough,
  gatewayServed,
  handedOverAt,
  refusalOf,
  startAskedThrough,
  switchedOn,
  wayThrough,
  wayWithNoGateway,
} from '../consent-testing/gateway-asking.ts';
import { consentClientWith, everyHost } from '../testing/index.ts';

function endingOf(way = wayThrough({ url: 'http://127.0.0.1:1/connections' }), key = Redacted.make('a-key')) {
  return { way, reaches: everyHost, key };
}

describe('the end of a connection’s key at its gateway', () => {
  it('is done once the gateway ends it, and again when it no longer knows the key, which ending it twice is', async () => {
    const gateway = await gatewayServed();
    const client = switchedOn();
    const { finished } = await handedOverAt(gateway, client);
    const asked = endingOf(wayThrough(gateway), finished.tokens);

    const first = await Effect.runPromise(Effect.exit(client.end(asked)));
    const second = await Effect.runPromise(Effect.exit(client.end(asked)));

    expect([Exit.isSuccess(first), Exit.isSuccess(second)]).toEqual([true, true]);
    expect(gateway.ended()).toEqual([Redacted.value(finished.tokens)]);
    const removals = gateway.seen().filter(({ path }) => path === '/connections/remove');
    expect(removals.map(({ body }) => body)).toEqual(
      removals.map(() => JSON.stringify({ connection_key: Redacted.value(finished.tokens) })),
    );
  });

  it('is not done for a refusal without unknown_key, a failure, or a host the rule refuses, so it is asked again', async () => {
    const gateway = await gatewayServed();
    const asked = endingOf(wayThrough(gateway));
    gateway.answering('end', 403, { detail: 'Not from Auto' });
    const unsaid = await refusalOf(switchedOn().end(asked));
    gateway.answering('end', 403, { refused: 'other_org' });
    const otherOrg = await refusalOf(switchedOn().end(asked));
    gateway.answering('end', 500, { detail: 'Not written' });
    const unwritten = await refusalOf(switchedOn().end(asked));
    gateway.answeringAsItself('end');
    const unreached = await refusalOf(switchedOn().end({ ...asked, reaches: () => 'Not this host' }));

    expect([unsaid, otherOrg, unwritten, unreached]).toEqual([
      { refused: 'unanswered' },
      { refused: 'unanswered' },
      { refused: 'unanswered' },
      { refused: 'host', rule: 'Not this host' },
    ]);
  });
});

describe('the end of a key at its gateway, tried', () => {
  it('ends the key once the gateway confirms it, and logs the words given where it never does', async () => {
    const gateway = await gatewayServed();
    const client = switchedOn({ gatewayEndPauseMs: 0 });
    const { finished } = await handedOverAt(gateway, client);
    const logged: string[] = [];
    const logging = Logger.layer([
      Logger.map(Logger.formatJson, (line: string) => {
        logged.push(line);
      }),
    ]);
    gateway.answering('end', 503);
    await Effect.runPromise(
      client
        .endTried(endingOf(wayThrough(gateway), finished.tokens), 'The key was not ended')
        .pipe(Effect.provide(logging)),
    );
    gateway.answeringAsItself('end');

    await Effect.runPromise(client.endTried(endingOf(wayThrough(gateway), finished.tokens), 'The key was not ended'));

    expect(gateway.ended()).toEqual([Redacted.value(finished.tokens)]);
    expect(logged).toEqual([expect.stringContaining('The key was not ended')]);
  });
});

describe('a gateway where gateways are not switched on', () => {
  it('is never asked: a start, a finish and an end are refused as having no client here', async () => {
    const gateway = await gatewayServed();
    const started = await Effect.runPromise(switchedOn().start(startAskedThrough(gateway)));
    const asked = finishAskedThrough(gateway, started, gateway.allow(started.url).handle);
    const seenBefore = gateway.seen().length;
    const client = consentClientWith();

    const refusals = [
      await refusalOf(client.start(startAskedThrough(gateway))),
      await refusalOf(client.finish(asked)),
      await refusalOf(client.end(endingOf(wayThrough(gateway)))),
    ];

    expect(refusals).toEqual([{ refused: 'no_client' }, { refused: 'no_client' }, { refused: 'no_client' }]);
    expect(gateway.seen()).toHaveLength(seenBefore);
  });

  it('refuses a finish begun through a gateway whose way names none any more, or that brings a code', async () => {
    const gateway = await gatewayServed();
    const client = switchedOn();
    const started = await Effect.runPromise(client.start(startAskedThrough(gateway)));
    const asked = finishAskedThrough(gateway, started, 'a-handle');
    const { handle: _handle, ...ofTheStart } = asked;

    const refusals = [
      await refusalOf(client.finish({ ...asked, way: wayWithNoGateway })),
      await refusalOf(client.finish({ ...ofTheStart, code: 'a-code', iss: undefined })),
      await refusalOf(client.end(endingOf(wayWithNoGateway))),
    ];

    expect(refusals).toEqual([{ refused: 'no_client' }, { refused: 'no_client' }, { refused: 'no_client' }]);
  });
});
