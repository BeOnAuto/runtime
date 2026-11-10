import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { RunLogEventSchema, eventBytesOf, stateFormat, stateFormatKeepingPayloads } from '../index.ts';
import { at, openCall } from '../testing/runs.ts';

const decodeEvent = Schema.decodeUnknownResult(Schema.toCodecJson(RunLogEventSchema));

const encodeEvent = Schema.encodeSync(Schema.toCodecJson(RunLogEventSchema));

const digest = 'd'.repeat(64);

const inline = { kind: 'start_call', key: openCall, function: 'notify', arguments: { to: 'ada' }, longestMs: 1000 };

const keptStart = {
  kind: 'start_call',
  key: openCall,
  function: 'notify',
  arguments_sha256: digest,
  arguments_bytes: 20_000,
  longestMs: 1000,
};

function eventOf(format: number, outputs: readonly object[], extra: object = {}) {
  return {
    type: 'input_applied',
    format,
    receipt: { kind: 'timer_fired', key: '1', at },
    steps: [],
    resumed: null,
    patch: [{ op: 'replace', path: '/inputs', value: 2 }],
    outputs,
    ...extra,
  };
}

function isRead(event: object): boolean {
  return Result.isSuccess(decodeEvent(event));
}

function writtenBack(event: object): string {
  return JSON.stringify(encodeEvent(Result.getOrThrow(decodeEvent(event))));
}

describe('an event of formats 8 to 11', () => {
  it.each([8, 9, 10, stateFormat])(
    'of format %i is written back text for text, a start holding its arguments before the longest it may run',
    (format) => {
      const written = eventOf(format, [inline]);

      expect(writtenBack(written)).toBe(JSON.stringify(written));
    },
  );

  it.each([8, 9, 10, stateFormat])('of format %i refuses a start that names its arguments by digest', (format) => {
    expect(isRead(eventOf(format, [keptStart]))).toBe(false);
  });

  it('is read as the release before read it, letting go of a member no format of it describes', () => {
    expect(writtenBack(eventOf(stateFormat, [{ ...inline, extra: true }], { kept: [] }))).toBe(
      JSON.stringify(eventOf(stateFormat, [inline])),
    );
  });
});

describe('an event of format 12', () => {
  it('always names the payloads it holds, an empty list when it holds none, and is written back text for text', () => {
    const named = eventOf(stateFormatKeepingPayloads, [keptStart], { kept: [{ sha256: digest, bytes: 20_000 }] });
    const none = eventOf(stateFormatKeepingPayloads, [inline], { kept: [] });

    expect([isRead(named), isRead(none), isRead(eventOf(stateFormatKeepingPayloads, [inline]))]).toEqual([
      true,
      true,
      false,
    ]);
    expect([writtenBack(named), writtenBack(none)]).toEqual([JSON.stringify(named), JSON.stringify(none)]);
  });

  it('names each payload once, and a start holds its arguments in exactly one arm', () => {
    const twice = [
      { sha256: digest, bytes: 20_000 },
      { sha256: digest, bytes: 20_000 },
    ];

    expect([
      isRead(eventOf(stateFormatKeepingPayloads, [], { kept: twice })),
      isRead(eventOf(stateFormatKeepingPayloads, [{ ...keptStart, arguments: 1 }], { kept: [] })),
      isRead(eventOf(stateFormatKeepingPayloads, [{ ...keptStart, arguments_bytes: undefined }], { kept: [] })),
      isRead(eventOf(stateFormatKeepingPayloads, [{ ...keptStart, arguments_sha256: 'D' }], { kept: [] })),
    ]).toEqual([false, false, false, false]);
  });

  it('is measured as its JSON and the bytes of every payload each of its places names, the values it keeps and every start named by digest, as the ledger measures a fact', () => {
    const measured = [[], [{ sha256: digest, bytes: 20_000 }]].map((kept: readonly object[]) => {
      const event = Result.getOrThrow(decodeEvent(eventOf(stateFormatKeepingPayloads, [keptStart], { kept })));
      return eventBytesOf(event) - new TextEncoder().encode(JSON.stringify(event)).byteLength;
    });

    expect(measured).toEqual([20_000, 40_000]);
  });
});
