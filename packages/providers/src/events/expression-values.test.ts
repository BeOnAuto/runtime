import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { valueIn, type Arrival } from './arrival-values.ts';

interface RequestParts {
  readonly headers?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: Schema.Json;
}

function aRequest(parts: RequestParts): Arrival {
  return { transport: 'request', headers: {}, query: {}, ...parts };
}

const rfc6901 = {
  foo: ['bar', 'baz'],
  '': 0,
  'a/b': 1,
  'c%d': 2,
  'e^f': 3,
  'g|h': 4,
  'i\\j': 5,
  'k"l': 6,
  ' ': 7,
  'm~n': 8,
};

function inTheBody(pointers: readonly string[]): readonly unknown[] {
  return pointers.map((pointer) => valueIn(aRequest({ body: rfc6901 }), `$request.body#${pointer}`));
}

describe('the value of a runtime expression in a request', () => {
  it('is a header found by its name whatever its case, the values of one name joined as HTTP combines them', () => {
    const headers = { 'X-Tracker-Event': 'comment', 'x-kind': 'a', 'X-Kind': 'b' };

    expect(
      ['x-tracker-event', 'X-KIND', 'X-Tracker-Hook'].map((name) =>
        valueIn(aRequest({ headers }), `$request.header.${name}`),
      ),
    ).toEqual(['comment', 'a, b', undefined]);
  });

  it('is a parameter of the query found by its name as written, and only one the query has', () => {
    expect(
      ['hub.mode', 'HUB.MODE', 'constructor'].map((name) =>
        valueIn(aRequest({ query: { 'hub.mode': 'subscribe' } }), `$request.query.${name}`),
      ),
    ).toEqual(['subscribe', undefined, undefined]);
  });

  it('is found in the body by a JSON Pointer as RFC 6901 resolves its own examples', () => {
    expect(inTheBody(['/foo', '/foo/0', '/', '/a~1b', '/c%d', '/e^f', '/g|h', '/i\\j', '/k"l', '/ ', '/m~0n'])).toEqual(
      [['bar', 'baz'], 'bar', 0, 1, 2, 3, 4, 5, 6, 7, 8],
    );
  });

  it('is nothing past an array’s end, at an index written with a leading zero or as -, or in what an object only inherits', () => {
    expect(inTheBody(['/foo/2', '/foo/01', '/foo/-', '/constructor', '/m~1n', '/foo/0/length'])).toEqual(
      Array.from({ length: 6 }),
    );
  });

  it('is nothing in a request that carries no body', () => {
    expect(valueIn(aRequest({}), '$request.body#/type')).toBeUndefined();
  });
});

describe('the value of a runtime expression in a message, or of none', () => {
  it('is found in a message’s header and payload by AsyncAPI’s expressions into the message', () => {
    const message: Arrival = { transport: 'message', headers: { kind: 'event' }, payload: { type: 'events_api' } };

    expect([
      valueIn(message, '$message.header#/kind'),
      valueIn(message, '$message.payload#/type'),
      valueIn({ transport: 'message', payload: { type: 'events_api' } }, '$message.header#/kind'),
    ]).toEqual(['event', 'events_api', undefined]);
  });

  it('is nothing for an expression into the other transport or for one that is no expression', () => {
    const request = aRequest({ headers: { 'X Event': 'comment' }, body: { type: 'events_api' } });
    const message: Arrival = { transport: 'message', payload: { type: 'events_api' } };

    expect([
      valueIn(request, '$message.payload#/type'),
      valueIn(message, '$request.body#/type'),
      valueIn(message, '$message.body#/type'),
      valueIn(request, '$request.header.X Event'),
      valueIn(request, '$request.body'),
      valueIn(request, 'type'),
    ]).toEqual(Array.from({ length: 6 }));
  });
});
