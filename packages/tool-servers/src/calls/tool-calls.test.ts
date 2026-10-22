import { Buffer } from 'node:buffer';

import { afterEach, describe, expect, it } from 'vitest';

import { defaultTiming, shownWithin, type Timing } from '../bounds/call-bounds.ts';
import { answerOf, resultText } from '../bounds/tool-results.ts';
import {
  brokenPromise,
  deniedText,
  fakeApiKey,
  fakeChannels,
  inTurn,
  openFakeToolRun,
  toolRunId,
} from '../testing/index.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function runWith(tools: readonly string[], timing?: Timing) {
  const run = await openFakeToolRun(tools, timing);
  closing.push(run.close);
  return run;
}

const aSize: unknown = expect.any(Number);

const cutLarge: unknown = expect.stringMatching(
  /^(?:😀)+\n\[The answer was cut to 65,\d{3} of its 81,920 bytes, to fit what the model may still read; ask for fewer rows, fields or depth to see the rest\.\]$/u,
);

const brokenWithKey: unknown = expect.stringMatching(
  /^The tool server graph failed: .*The broken tool broke on \{"key":"\[redacted\]","attempt":1\}$/u,
);

const reportedWithKey: unknown = expect.stringMatching(
  /The broken tool broke on \{"key":"\[redacted\]","attempt":1\}$/u,
);

describe('the result of a call', () => {
  it('gives the model text as text, structured content without text as JSON, and other content as placeholders', async () => {
    const { call, tools } = await runWith(['search', 'profile', 'photo', 'list_channels']);

    expect(await call('search', { query: 'acme' })).toMatchObject({ text: 'Found 2 rows for acme.', isError: false });
    expect(await call('profile', {})).toMatchObject({ text: '{"name":"Ada","rows":2}', isError: false });
    expect(await call('photo', {})).toMatchObject({
      text: '[image content (image/png), not shown]\n[audio content (audio/wav), not shown]',
      isError: false,
    });
    expect(await call('list_channels', {})).toMatchObject({ text: JSON.stringify(fakeChannels), isError: false });
    expect(tools.calledAny()).toBe(true);
    expect(tools.usedInWords()).toBe('the search, profile, photo, and list channels tools of graph');
  });

  it('gives the model a denial as a tool error it may recover from, never counted as a failure', async () => {
    const { call, tools } = await runWith(['denied']);

    const replies = await inTurn([1, 2, 3, 4, 5, 6], (attempt) => call('denied', { attempt }));

    expect(replies).toMatchObject(Array.from({ length: 6 }, () => ({ text: deniedText, isError: true })));
    expect(tools.ending()).toBeUndefined();
    expect(tools.ended.aborted).toBe(false);
  });

  it('gives the model what a tool answered against its own output schema, and never says the arguments were refused', async () => {
    const run = await openFakeToolRun(['promised'], defaultTiming, { data: true });
    closing.push(run.close);

    expect(await run.call('promised', {})).toMatchObject({
      text: JSON.stringify(brokenPromise),
      isError: false,
      outcome: 'result',
    });
    expect(run.fake.received()).toHaveLength(1);
  });
});

describe('a large result of a call', () => {
  it('gives the model a large answer whole when it fits the room the model has, or when that room is unknown', async () => {
    const { call, journal } = await runWith(['large']);

    const unbounded = await call('large', { kib: 362 });
    const roomy = await call('large', { kib: 80 }, undefined, 100_000);

    expect([unbounded.text, roomy.text]).toEqual(['😀'.repeat(362 * 256), '😀'.repeat(80 * 256)]);
    expect(journal.facts().map(({ type, data }) => [type, 'shown_bytes' in data])).toEqual([
      ['tool_call_started', false],
      ['tool_call_answered', false],
      ['tool_call_started', false],
      ['tool_call_answered', false],
    ]);
  });

  it('cuts an answer past the room the model has at a code point, with the note, and records how much it read', async () => {
    const { call, journal } = await runWith(['large']);

    const reply = await call('large', { kib: 80 }, undefined, 65_536);
    const read = reply.text.slice(0, reply.text.indexOf('\n[The answer was cut'));

    expect(reply).toMatchObject({ text: cutLarge, isError: false, shownBytes: Buffer.byteLength(read) });
    expect(journal.facts().at(-1)).toMatchObject({
      type: 'tool_call_answered',
      data: { result_bytes: aSize, shown_bytes: Buffer.byteLength(read) },
    });
  });
});

describe('the size a reader meets of an answer', () => {
  it('is the size of the kept text, scrubbed, on the fact, in the reply and in what the run answered', async () => {
    const { call, journal, tools } = await runWith(['echo']);
    const kept = JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ said: 'the key [redacted]' }) }] });

    const reply = await call('echo', { said: `the key ${fakeApiKey}` });

    expect([reply.resultBytes, tools.answeredBytes()]).toEqual([Buffer.byteLength(kept), Buffer.byteLength(kept)]);
    expect(journal.facts().at(-1)).toMatchObject({ data: { result_bytes: Buffer.byteLength(kept) } });
  });

  it('gives what the model read again from the kept answer and the size the fact says it read', async () => {
    const { call, journal } = await runWith(['large']);
    const kept = JSON.stringify({ content: [{ type: 'text', text: '😀'.repeat(80 * 256) }] });

    const reply = await call('large', { kib: 80 }, undefined, 65_536);
    const shownBytes = Number(Reflect.get(new Object(journal.facts().at(-1)?.data), 'shown_bytes'));

    expect(reply.text.startsWith(shownWithin(resultText(answerOf(kept)), shownBytes))).toBe(true);
    expect(Buffer.byteLength(shownWithin(resultText(answerOf(kept)), shownBytes))).toBe(shownBytes);
  });
});

describe('the calls a run may make', () => {
  it('makes the calls of one step at once, recording each', async () => {
    const { call, journal } = await runWith(['sleep']);

    const replies = await Promise.all(Array.from({ length: 10 }, (_, index) => call('sleep', { ms: 50, index })));

    expect(replies).toMatchObject(Array.from({ length: 10 }, () => ({ text: 'Slept.', isError: false })));
    expect(journal.facts()).toHaveLength(20);
    expect(new Set(journal.facts().map(({ number }) => number))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  });

  it('refuses the call after the twenty-fifth without sending or recording it', async () => {
    const { call, fake, journal, tools } = await runWith(['echo']);

    await inTurn(
      Array.from({ length: 25 }, (_, index) => index),
      (number) => call('echo', { number }),
    );
    const refused = await call('echo', { number: 26 });

    expect(tools.callsEnded()).toBe(true);
    expect(refused).toMatchObject({
      text: 'This run has made all the 25 tool calls it may; answer from what you have.',
      isError: true,
    });
    expect(fake.received()).toHaveLength(25);
    expect(journal.facts()).toHaveLength(50);
  });

  it('reads answers that add up past 256 KiB whole, since the tokens of the run bound what it reads', async () => {
    const { call, tools } = await runWith(['large']);

    const replies = await inTurn([1, 2, 3, 4, 5], (page) => call('large', { kib: 64, page }));

    expect(tools.callsEnded()).toBe(false);
    expect(replies.map(({ text }) => Buffer.byteLength(text))).toEqual([65_536, 65_536, 65_536, 65_536, 65_536]);
  });
});

describe('the arguments of a call', () => {
  it('refuses arguments over 16 KiB, and the third call with the same arguments', async () => {
    const { call, fake } = await runWith(['echo']);
    const inputs: readonly Readonly<Record<string, string>>[] = [
      { text: 'x'.repeat(16_384) },
      { text: 'once' },
      { text: 'once' },
      { text: 'once' },
    ];

    const replies = await inTurn(inputs, (input) => call('echo', input));

    expect(replies[0]).toMatchObject({
      text: 'The arguments of this call take 16395 bytes, more than the 16384 a call may send; send less.',
      isError: true,
    });
    expect(replies[3]).toMatchObject({
      text: 'This call repeats, with the same arguments, a call this run already made 2 times; use the answer to the call call-3 instead.',
      isError: true,
    });
    expect(fake.received()).toHaveLength(2);
  });
});

describe('a server that fails a call', () => {
  it('fails a call it cannot answer, scrubbed of secrets, and reports it to the operator', async () => {
    const { call, messages } = await runWith(['broken']);

    expect(await call('broken', { key: fakeApiKey, attempt: 1 })).toMatchObject({ text: brokenWithKey, isError: true });
    expect(messages()).toEqual([{ server: 'graph', message: reportedWithKey, run_id: toolRunId, call_id: null }]);
  });

  it('ends the calls after five failures', async () => {
    const { call, tools } = await runWith(['broken']);

    await inTurn([1, 2, 3, 4], (attempt) => call('broken', { attempt }));
    const endingBefore = tools.ending();
    await call('broken', { attempt: 5 });

    expect(endingBefore).toBeUndefined();
    expect(tools.ending()).toEqual({ because: 'failing' });
    expect(tools.ended.aborted).toBe(true);
  });

  it('fails a call its server answers HTTP 403 as a failure of that call, counted as one, and never as a refused key', async () => {
    const { call, fake, journal, tools } = await runWith(['search']);

    fake.answerNextOf('tools/call', 403, 5);
    const replies = await inTurn([1, 2, 3, 4, 5], (attempt) => call('search', { query: `denied ${attempt}` }));

    expect(replies[0]).toMatchObject({
      text: 'The tool server graph failed: The tool server answered HTTP 403',
      isError: true,
    });
    expect(journal.facts().at(-1)).toMatchObject({ type: 'tool_call_failed', data: { because: 'server_failure' } });
    expect(tools.ending()).toEqual({ because: 'failing' });
  });

  it('fails a call that takes longer than a call may', async () => {
    const { call, journal } = await runWith(['sleep'], { ...defaultTiming, callMs: 200 });

    expect(await call('sleep', { ms: 5000 })).toMatchObject({
      text: 'The tool server graph failed: The tool server did not answer within 200 ms',
      isError: true,
    });
    expect(journal.facts().at(-1)).toMatchObject({ type: 'tool_call_failed', data: { because: 'timed_out' } });
  });
});

describe('a server that asks to slow down or forgets a session', () => {
  it('waits out a 429 within the longest wait, and fails one asking longer, ending the calls as rate limited after five', async () => {
    const { call, fake, tools } = await runWith(['search'], { ...defaultTiming, longestRetryWaitMs: 1000 });

    fake.answerNextOf('tools/call', 429, 1, { 'retry-after': '0' });
    const waited = await call('search', { query: 'waited' });
    fake.answerNextOf('tools/call', 429, 5, { 'retry-after': '5' });
    const [limited] = await inTurn(['limited', 'b', 'c', 'd', 'e'], (query) => call('search', { query }));

    expect(waited).toMatchObject({ text: 'Found 2 rows for waited.', isError: false });
    expect(limited).toMatchObject({
      text: 'The tool server graph failed: The tool server answered HTTP 429',
      isError: true,
    });
    expect(tools.ending()).toEqual({ because: 'rate_limited' });
  });

  it('opens a forgotten session again once, and then fails', async () => {
    const { call, fake } = await runWith(['search']);

    fake.forgetSessions();
    const reopened = await call('search', { query: 'reopened' });
    fake.forgetSessions();
    const forgotten = await call('search', { query: 'forgotten' });

    expect(reopened).toMatchObject({ text: 'Found 2 rows for reopened.', isError: false });
    expect(forgotten).toMatchObject({
      text: 'The tool server graph failed: The tool server answered HTTP 404',
      isError: true,
    });
  });
});
