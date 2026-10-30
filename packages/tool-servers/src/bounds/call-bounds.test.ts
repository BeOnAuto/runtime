import { describe, expect, it } from 'vitest';

import {
  admission,
  callsEnded,
  defaultTiming,
  failedOnce,
  failuresEnded,
  noCalls,
  runBoundMs,
  shownResult,
  shownWithin,
  type CallTally,
} from './call-bounds.ts';
import { bytesOf } from './text-bytes.ts';

type Input = Readonly<Record<string, unknown>>;

const asked = (callId: string, input: Input) => ({ tool: 'graph__search', callId, input });

const searched = (callId: string) => asked(callId, { query: callId });

function admittedTally(tally: CallTally, callId: string, input: Input): CallTally {
  return admission(tally, asked(callId, input)).tally;
}

describe('admitting a call', () => {
  it('admits a call and counts it', () => {
    expect(admission(noCalls, searched('call-1'))).toMatchObject({
      admitted: true,
      tally: { calls: 1, failures: 0 },
    });
  });

  it('refuses the call after the twenty-fifth, still counting it', () => {
    const tally = Array.from({ length: 25 }, (_, index) => `call-${index}`).reduce(
      (each, callId) => admittedTally(each, callId, { query: callId }),
      noCalls,
    );

    expect(callsEnded(tally)).toBe(true);
    expect(admission(tally, searched('call-26'))).toEqual({
      admitted: false,
      tally: { ...tally, calls: 26 },
      refusal: 'This run has made all the 25 tool calls it may; answer from what you have.',
    });
  });
});

describe('admitting the arguments of a call', () => {
  it('refuses arguments over 16 KiB', () => {
    expect(admission(noCalls, asked('call-1', { query: 'x'.repeat(16_384) }))).toMatchObject({
      admitted: false,
      refusal: 'The arguments of this call take 16396 bytes, more than the 16384 a call may send; send less.',
    });
  });

  it('refuses the third call with the same arguments in any order, naming the earlier answer', () => {
    const once = admittedTally(noCalls, 'call-1', { a: 1, b: [2, { d: 4, c: 3 }] });
    const twice = admittedTally(once, 'call-2', { b: [2, { c: 3, d: 4 }], a: 1 });

    expect(admission(twice, asked('call-3', { a: 1, b: [2, { c: 3, d: 4 }] }))).toMatchObject({
      admitted: false,
      refusal:
        'This call repeats, with the same arguments, a call this run already made 2 times; use the answer to the call call-2 instead.',
    });
    expect(admission(twice, asked('call-3', { a: 2 }))).toMatchObject({ admitted: true });
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
