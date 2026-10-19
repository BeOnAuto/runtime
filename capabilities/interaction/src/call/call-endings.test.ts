import { recordingJournal } from '@on.auto/definitions/testing';
import { deniedText, patientTiming } from '@on.auto/tool-servers/testing';
import { Cause, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { callRuns } from '../testing/call-runs.ts';
import { callDocument } from '../testing/index.ts';

const anyOutput = ['output:', '  schema: {}'];

function asking(tool: string, written: readonly string[] = []): string {
  return callDocument({ tool, read: null, with: written, output: anyOutput });
}

function defectOf(ended: unknown): unknown {
  return Exit.isExit(ended) && Exit.isFailure(ended) ? Cause.squash(ended.cause) : undefined;
}

function rejectedWith(fields: Readonly<Record<string, unknown>>) {
  return Exit.fail(expect.objectContaining(fields));
}

describe('a run that asks a system and sends nothing', () => {
  it('is unavailable when its server does not serve the playbook, or its operator does not allow the tool, whether its server lists it or not', async () => {
    const elsewhere = await callRuns({ entry: { org: 'globex' } });
    const narrow = await callRuns({ entry: { allowed: ['search'] } });

    expect([
      await elsewhere.run(callDocument()),
      await narrow.run(callDocument()),
      await narrow.run(callDocument({ tool: 'gone', read: null })),
    ]).toEqual([
      rejectedWith({ kind: 'tool_not_offered', because: 'tool_server_not_configured' }),
      rejectedWith({ kind: 'tool_not_offered', because: 'tool_not_allowed' }),
      rejectedWith({ kind: 'tool_not_offered', because: 'tool_not_allowed' }),
    ]);
    expect([elsewhere.fake.seen(), narrow.fake.received(), elsewhere.journal.recorded()]).toEqual([[], [], []]);
  });

  it('is unavailable when its server does not list the tool or cannot be reached, and records no call', async () => {
    const { fake, journal, run } = await callRuns();
    const unlisted = await run(callDocument({ tool: 'gone', read: null }));
    await fake.close();

    expect([unlisted, await run(callDocument())]).toEqual([
      rejectedWith({
        kind: 'tool_not_offered',
        because: 'tool_not_listed',
        detail: 'The tool server chat does not list the tool gone',
      }),
      rejectedWith({ kind: 'tool_server_failed', because: 'unreachable' }),
    ]);
    expect(journal.recorded()).toEqual([]);
  });

  it('dies, sending nothing, when its run records no start', async () => {
    const { fake, run } = await callRuns({ journal: recordingJournal(() => true) });

    const ended = await run(callDocument());

    expect(defectOf(ended)).toEqual(
      new Error('The start of the call could not be recorded on its run, so the call was not sent'),
    );
    expect(fake.received()).toEqual([]);
  });
});

describe('a run that asks a system with arguments it cannot render', () => {
  it('rejects an input that does not match, or lacks what an argument reads, or that a filter refuses', async () => {
    const { fake, run } = await callRuns();
    const reading = callDocument({ input: ['input:', '  schema: { type: object }'] });
    const filtered = callDocument({ with: ["    channel: '{{ input.channel | divided_by: 0 }}'"] });

    expect([
      await run(callDocument(), { channel: 7 }),
      await run(reading, { channel: 'C0123' }),
      await run(filtered),
    ]).toEqual([
      rejectedWith({ _tag: 'invalid_input' }),
      rejectedWith({
        _tag: 'invalid_input',
        detail: 'The definition reads input.thread on line 1, which the input does not have',
      }),
      rejectedWith({
        _tag: 'invalid_input',
        detail: 'The argument channel of the call cannot be rendered with this input',
      }),
    ]);
    expect(fake.received()).toEqual([]);
  });

  it('is unworkable when an argument renders a structure among text, or the arguments take more than 16 KiB', async () => {
    const { run } = await callRuns();
    const open = ['input:', '  schema: { type: object }'];
    const among = callDocument({ with: ["    channel: 'In {{ input.channel }}'"], input: open });
    const whole = callDocument({ with: ["    a: '{{ input.a }}'", "    b: '{{ input.b }}'"], input: open });
    const text = callDocument({ with: ["    channel: 'In {{ input.channel }}'"], input: open });

    expect([
      await run(among, { channel: ['C0123'] }),
      await run(whole, { a: 'x'.repeat(8200), b: 'x'.repeat(8200) }),
      await run(text, { channel: 'x'.repeat(16_400) }),
    ]).toEqual([
      rejectedWith({
        kind: 'unworkable',
        detail: expect.stringContaining('renders a value that is not text among text'),
      }),
      rejectedWith({ kind: 'unworkable', detail: expect.stringContaining('take 16415 bytes, more than the 16384') }),
      rejectedWith({ kind: 'unworkable', detail: expect.stringContaining('renders more than the 16384 bytes') }),
    ]);
  });
});

describe('a run whose call was sent and could not finish', () => {
  it('is unavailable, safe to try again, when its server marks the tool read-only, and a conflict whose effect is unknown when not', async () => {
    const readOnly = await callRuns();
    const writing = await callRuns({ server: { hints: { denied: { readOnlyHint: false }, broken: {} } } });

    expect([
      await readOnly.run(asking('denied')),
      await writing.run(asking('denied')),
      await readOnly.run(asking('broken')),
      await writing.run(asking('broken')),
    ]).toEqual([
      rejectedWith({
        kind: 'tools_unfinished',
        because: 'tool_error',
        detail: `The denied tool of chat answered an error: ${deniedText}`,
      }),
      rejectedWith({ _tag: 'conflict', kind: 'effect_unknown', because: 'tool_error' }),
      rejectedWith({
        kind: 'tools_unfinished',
        because: 'server_failed',
        detail: expect.stringMatching(
          /^The tool server chat failed: .*, after the run called the broken tool of chat$/u,
        ),
      }),
      rejectedWith({ _tag: 'conflict', kind: 'effect_unknown', because: 'server_failed' }),
    ]);
  });

  it('keeps the wait a 429 asked for past the longest a run waits, and ends a call that took too long', async () => {
    const throttled = await callRuns({ timing: patientTiming });
    const hurried = await callRuns({ timing: { ...patientTiming, callMs: 300 } });
    throttled.fake.answerNextOf('tools/call', 429, 1, { 'retry-after': '20' });

    expect([
      await throttled.run(asking('search', ['    query: acme'])),
      await hurried.run(asking('sleep', ['    ms: 5000'])),
    ]).toEqual([
      rejectedWith({ kind: 'tools_unfinished', because: 'server_failed', record: { retry_after_ms: 20_000 } }),
      rejectedWith({
        kind: 'tools_unfinished',
        because: 'server_failed',
        detail: expect.stringContaining('did not answer within 300 ms'),
      }),
    ]);
  });
});

describe('a run whose tool refused its arguments', () => {
  it('is unworkable, which trying again would meet again', async () => {
    const { run } = await callRuns();

    expect(await run(asking('strict', ["    limit: '15'"]))).toEqual(
      rejectedWith({
        kind: 'unworkable',
        detail: expect.stringMatching(
          /^The strict tool of chat refused the arguments: .*limit must be a whole number/u,
        ),
      }),
    );
  });
});
