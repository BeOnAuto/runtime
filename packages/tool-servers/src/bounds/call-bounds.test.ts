import { describe, expect, it } from 'vitest';

import {
  actingCallsCount,
  admission,
  admittedAsSent,
  askedPastTheCount,
  callCountOf,
  countedAsSent,
  defaultTiming,
  failedOnce,
  failuresEnded,
  mostRequestBytesOf,
  mostRequestBytesTo,
  noCalls,
  runBoundMs,
  shownResult,
  shownWithin,
  type CallAsked,
  type CallCount,
  type CallTally,
  toolBounds,
} from './call-bounds.ts';
import { bytesOf } from './text-bytes.ts';

const anyText: unknown = expect.any(String);

function containing(part: string): unknown {
  return expect.stringContaining(part);
}

type Input = Readonly<Record<string, unknown>>;

const mebibyte = 1_048_576;

const asked = (callId: string, input: Input, reads = true, mostBytes = mebibyte): CallAsked => ({
  tool: 'graph__search',
  callId,
  input,
  reads,
  mostBytes,
});

const searched = (callId: string) => asked(callId, { query: callId });

const sent = (callId: string) => asked(callId, { text: callId }, false);

function admittedTally(tally: CallTally, callId: string, input: Input, count = actingCallsCount): CallTally {
  return admission(tally, asked(callId, input), count).tally;
}

function tallyAfter(calls: readonly CallAsked[], count: CallCount): CallTally {
  return calls.reduce((tally, call) => admission(tally, call, count).tally, noCalls);
}

const ids = (count: number) => Array.from({ length: count }, (_, index) => `call-${index + 1}`);

describe('admitting a call, by default', () => {
  it('counts a call of a tool not marked reads, and never one of a tool marked reads', () => {
    expect(admission(noCalls, sent('call-1'), actingCallsCount)).toMatchObject({
      admitted: true,
      tally: { counted: 1, failures: 0 },
    });
    expect(admission(noCalls, searched('call-1'), actingCallsCount)).toMatchObject({
      admitted: true,
      tally: { counted: 0, failures: 0 },
    });
    expect(
      tallyAfter(
        ids(300).map((id) => searched(id)),
        actingCallsCount,
      ),
    ).toMatchObject({ counted: 0 });
  });

  it('refuses the twenty-sixth call of a tool not marked reads, counting it as asked past the count, and admits a read after it', () => {
    const tally = tallyAfter(
      ids(25).map((id) => sent(id)),
      actingCallsCount,
    );

    expect(askedPastTheCount(tally, actingCallsCount)).toBe(false);
    expect(admission(tally, sent('call-26'), actingCallsCount)).toEqual({
      admitted: false,
      tally: { ...tally, counted: 26 },
      refusal: anyText,
    });
    expect(askedPastTheCount(admission(tally, sent('call-26'), actingCallsCount).tally, actingCallsCount)).toBe(true);
    expect(admission(tally, searched('call-26'), actingCallsCount)).toMatchObject({
      admitted: true,
      tally: { counted: 25 },
    });
  });

  it('counts no call it refuses for its arguments or as a repeat, since none of them is sent', () => {
    const twice = tallyAfter([asked('call-1', { a: 1 }, false), asked('call-2', { a: 1 }, false)], actingCallsCount);
    const tooLarge = asked('call-4', { text: 'x'.repeat(mebibyte) }, false);

    expect(admission(twice, asked('call-3', { a: 1 }, false), actingCallsCount)).toMatchObject({
      admitted: false,
      tally: { counted: 2 },
    });
    expect(admission(twice, tooLarge, actingCallsCount)).toMatchObject({ admitted: false, tally: { counted: 2 } });
  });
});

describe('admitting a call, under a count of the function’s own', () => {
  it('counts every call it is asked for, reads and refused repeats included, and refuses the one after it', () => {
    const sixty = callCountOf(60);
    const repeats = [1, 2, 3].map((each) => asked(`repeat-${each}`, { a: 1 }));
    const tally = tallyAfter([...ids(57).map((id) => searched(id)), ...repeats], sixty);

    expect([sixty, tally.counted, askedPastTheCount(tally, sixty)]).toEqual([
      { most: 60, countsReads: true },
      60,
      false,
    ]);
    expect(admission(tally, searched('call-61'), sixty)).toEqual({
      admitted: false,
      tally: { ...tally, counted: 61 },
      refusal: anyText,
    });
  });

  it('is the default rule when the function sets none', () => {
    expect(callCountOf()).toBe(actingCallsCount);
    expect(actingCallsCount).toEqual({ most: 25, countsReads: false });
  });
});

const answerOfTheCall26: unknown = containing('use the answer to the call call-26 instead');

describe('a call its run already sent, as its fact records it', () => {
  it('is counted by the mark its fact records, never refused, and kept for the repeats after it', () => {
    const full = tallyAfter(
      ids(25).map((id) => sent(id)),
      actingCallsCount,
    );
    const again = admittedAsSent(full, sent('call-26'), actingCallsCount);

    expect([again.counted, askedPastTheCount(again, actingCallsCount)]).toEqual([26, true]);
    expect(admittedAsSent(full, searched('call-26'), actingCallsCount).counted).toBe(25);
    expect(
      admission(admittedAsSent(again, sent('call-26'), actingCallsCount), sent('call-26'), callCountOf(1000)),
    ).toMatchObject({
      admitted: false,
      refusal: answerOfTheCall26,
    });
  });

  it('is counted, of a tool its run no longer offers, by its mark alone', () => {
    expect([
      countedAsSent(noCalls, { reads: false }, actingCallsCount).counted,
      countedAsSent(noCalls, { reads: true }, actingCallsCount).counted,
      countedAsSent(noCalls, { reads: true }, callCountOf(60)).counted,
    ]).toEqual([1, 0, 1]);
  });
});

describe('admitting the arguments of a call', () => {
  it('admits arguments of as many bytes as JSON as its server may be sent, and refuses one byte more in their words', () => {
    const twoMebibytes = 2 * mebibyte;
    const fits = asked('call-1', { query: 'x'.repeat(twoMebibytes - 12) }, true, twoMebibytes);
    const past = asked('call-1', { query: 'x'.repeat(twoMebibytes - 11) }, true, twoMebibytes);

    expect(admission(noCalls, fits, actingCallsCount)).toMatchObject({ admitted: true });
    expect(admission(noCalls, past, actingCallsCount)).toMatchObject({
      admitted: false,
      refusal: anyText,
    });
  });

  it('refuses the third call with the same arguments in any order, naming the earlier answer', () => {
    const once = admittedTally(noCalls, 'call-1', { a: 1, b: [2, { d: 4, c: 3 }] });
    const twice = admittedTally(once, 'call-2', { b: [2, { c: 3, d: 4 }], a: 1 });

    expect(admission(twice, asked('call-3', { a: 1, b: [2, { c: 3, d: 4 }] }), actingCallsCount)).toMatchObject({
      admitted: false,
      refusal: anyText,
    });
    expect(admission(twice, asked('call-3', { a: 2 }), actingCallsCount)).toMatchObject({ admitted: true });
    expect(
      admission(
        twice,
        { ...asked('call-3', { a: 1, b: [2, { c: 3, d: 4 }] }), tool: 'graph__other' },
        actingCallsCount,
      ),
    ).toMatchObject({ admitted: true });
  });

  it('keeps a digest of each call it admits, never its arguments, so a run holds little whatever they take', () => {
    const tally = admittedTally(noCalls, 'call-1', { page: 'x'.repeat(10_000) });

    expect([...tally.sameCalls.keys()]).toEqual([expect.stringMatching(/^[\da-f]{64}$/u)]);
  });
});

const anArray: unknown = expect.any(Array);

const rowsOfJson: unknown = expect.objectContaining({ rows: anArray });

describe('showing a result', () => {
  it('shows a result whole when it fits the room the model has, or when that room is unknown', () => {
    expect(shownResult('Found 2 rows.', 13)).toEqual({ text: 'Found 2 rows.' });
    expect(shownResult('x'.repeat(5_000_000))).toEqual({ text: 'x'.repeat(5_000_000) });
  });

  it('cuts a result past the room at a code point, with the note, and says how much the model read', () => {
    const text = '😀'.repeat(20_000);
    const shown = shownResult(text, 4000);

    expect(bytesOf(shown.text)).toBeLessThanOrEqual(4000);
    expect(shown.text).toMatch(
      /^(?:😀)+\n\[The answer was cut to 3,8\d\d of its 80,000 bytes, to fit what the model may still read; ask for fewer rows, fields or depth to see the rest\.\]$/u,
    );
    expect(shown.text.startsWith(shownWithin(text, Number(shown.shownBytes)))).toBe(true);
    expect(shown.shownBytes).toBe(bytesOf(shownWithin(text, Number(shown.shownBytes))));
  });

  it('cuts a JSON result after its last complete value, so the model reads JSON', () => {
    const rows = JSON.stringify({
      rows: Array.from({ length: 50 }, (_, index) => ({ id: index, name: `row ${index}` })),
    });
    const shown = shownResult(rows, 400);
    const read = shown.text.slice(0, Number(shown.shownBytes));

    expect(read.startsWith('{"rows":[{"id":0,"name":"row 0"},')).toBe(true);
    expect(read.endsWith('}]}')).toBe(true);
    expect(JSON.parse(read)).toStrictEqual(rowsOfJson);
    expect(read).toBe(shownWithin(rows, Number(shown.shownBytes)));
  });

  it('cuts a JSON object after its last complete member, and a long string inside it, so the read can be given again', () => {
    const members = JSON.stringify(
      Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`field_${index}`, index])),
    );
    const story = JSON.stringify({ title: 'Minutes', body: 'é and words '.repeat(400) });
    const [object, string] = [shownResult(members, 300), shownResult(story, 300)];
    const [objectRead, stringRead] = [object, string].map((shown) => shown.text.slice(0, shown.text.indexOf('\n[')));

    expect([JSON.parse(String(objectRead)), JSON.parse(String(stringRead))]).toMatchObject([
      { field_0: 0 },
      { title: 'Minutes' },
    ]);
    expect([objectRead, stringRead]).toEqual([
      shownWithin(members, Number(object.shownBytes)),
      shownWithin(story, Number(string.shownBytes)),
    ]);
  });
});

describe('the failures and the time of a run', () => {
  it('ends the calls after five server failures', () => {
    const four = [1, 2, 3, 4].reduce((tally) => failedOnce(tally), noCalls);

    expect(failuresEnded(four)).toBe(false);
    expect(failuresEnded(failedOnce(four))).toBe(true);
  });

  it('bounds a run by ten minutes, or one step when that is longer', () => {
    expect(runBoundMs(60_000)).toBe(600_000);
    expect(runBoundMs(1_660_000)).toBe(1_660_000);
    expect(defaultTiming).toEqual({ callMs: 30_000, openMs: 10_000, longestRetryWaitMs: 10_000 });
  });
});

describe('the most a call may send', () => {
  it('may send a server what the runtime is given, 16 MiB unless given another, and a local process 4 MiB at most', () => {
    expect([
      mostRequestBytesOf(),
      mostRequestBytesOf(8 * mebibyte),
      mostRequestBytesTo({ type: 'mcp' }, 16 * mebibyte),
      mostRequestBytesTo({ type: 'openapi' }, 128 * mebibyte),
      mostRequestBytesTo({ type: 'stdio' }, 16 * mebibyte),
      mostRequestBytesTo({ type: 'stdio' }, 2 * mebibyte),
    ]).toEqual([16 * mebibyte, 8 * mebibyte, 16 * mebibyte, 128 * mebibyte, 4 * mebibyte, 2 * mebibyte]);
    expect(toolBounds.handArgumentBytes).toBe(mebibyte);
  });
});
