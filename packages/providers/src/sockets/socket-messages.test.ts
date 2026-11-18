import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Arrival } from '../events/arrival-readings.ts';
import type { Destination } from '../events/destination-fields.ts';
import { acknowledgementOf, messageArrivalOf } from './socket-messages.ts';

function acknowledgedAt(acknowledge: string | undefined): Destination {
  return {
    type: 'websocket',
    filter: { when: { '$message.payload#/kind': ['event'] } },
    ...(acknowledge === undefined ? {} : { acknowledge }),
  };
}

function parsed(text: string | undefined): unknown {
  return text === undefined ? text : JSON.parse(text);
}

function aMessage(payload: object): Arrival {
  return Option.getOrThrow(Option.fromNullishOr(messageArrivalOf(JSON.stringify(payload))));
}

describe('a message over a socket', () => {
  it('arrives as its text parsed as JSON, and not at all where the text is no JSON', () => {
    expect([messageArrivalOf('{"kind":"event","id":7}'), messageArrivalOf('[1,'), messageArrivalOf('')]).toEqual([
      { transport: 'message', payload: { kind: 'event', id: 7 } },
      undefined,
      undefined,
    ]);
  });
});

describe('the acknowledgement of a message', () => {
  it('holds its id at the place the expression names, its tokens read as RFC 6901 escapes them', () => {
    const answers = [
      acknowledgementOf(acknowledgedAt('$message.payload#/envelope_id'), aMessage({ envelope_id: 'e-1' })),
      acknowledgementOf(acknowledgedAt('$message.payload#/meta~1data/i~0d'), aMessage({ 'meta/data': { 'i~d': 'x' } })),
    ];

    expect(answers.map((text) => parsed(text))).toEqual([{ envelope_id: 'e-1' }, { 'meta/data': { 'i~d': 'x' } }]);
  });

  it('gives a number back as the number it came as', () => {
    expect(acknowledgementOf(acknowledgedAt('$message.payload#/seq'), aMessage({ seq: 42 }))).toBe('{"seq":42}');
  });

  it('is none where the message names no id there, or an id that is empty, null or a value of parts', () => {
    const declared = acknowledgedAt('$message.payload#/id');
    const ids: readonly object[] = [{}, { id: '' }, { id: null }, { id: { part: 'a' } }, { id: true }];
    const acknowledgements = ids.map((payload) => acknowledgementOf(declared, aMessage(payload)));

    expect(acknowledgements.filter((acknowledgement) => acknowledgement !== undefined)).toEqual([]);
  });

  it('is none where the destination declares none, or names a place a socket message has not', () => {
    const message = aMessage({ id: 'e-1' });

    expect(
      [undefined, '$message.header#/id', '$request.body#/id'].map((acknowledge) =>
        acknowledgementOf(acknowledgedAt(acknowledge), message),
      ),
    ).toEqual([undefined, undefined, undefined]);
  });
});
