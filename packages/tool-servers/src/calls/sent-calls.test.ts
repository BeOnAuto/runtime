import { textOfContent } from '@on.auto/operations';
import { Effect, Option } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { defaultTiming } from '../bounds/call-bounds.ts';
import { fakeApiKey, openFakeToolRun, type FakeToolRun } from '../testing/fake-tool-run.ts';
import { until } from '../testing/until.ts';
import type { CallAnswered, CallEnded, CallFailed } from './call-facts.ts';
import type { OfferedTool } from './offered-tools.ts';
import { failureReply, keptReply } from './recorded-replies.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function runWith(
  tools: readonly string[],
  entry: Readonly<Record<string, unknown>> = {},
  timing = defaultTiming,
): Promise<FakeToolRun> {
  const run = await openFakeToolRun(tools, timing, {}, entry);
  closing.push(run.close);
  return run;
}

function offeredIn({ tools }: FakeToolRun, tool: string): OfferedTool {
  return Option.getOrThrow(Option.fromNullishOr(tools.offered.find(({ name }) => name === `graph__${tool}`)));
}

const unstopped = new AbortController().signal;

function answeredIn(ended: CallEnded): readonly CallAnswered[] {
  return ended.type === 'tool_call_answered' ? [ended.data] : [];
}

function failedIn(ended: CallEnded): readonly CallFailed[] {
  return ended.type === 'tool_call_failed' ? [ended.data] : [];
}

function keptOf({ content }: FakeToolRun, sha256: string | undefined): Promise<string | undefined> {
  return Effect.runPromise(
    sha256 === undefined
      ? Effect.undefined
      : Effect.flatMap(content.get({ org: 'acme', playbook: 'alpha' }, sha256), (kept) =>
          kept === undefined ? Effect.undefined : textOfContent(kept),
        ),
  );
}

describe('a call a run sends itself', () => {
  it('is started with the fields its start records, its arguments kept under the digest the run gives them', async () => {
    const run = await runWith(['search']);
    const started = await offeredIn(run, 'search').start({ callId: 'toolu_1', input: { query: fakeApiKey } });

    expect(started).toEqual({
      call_id: 'toolu_1',
      server: 'graph',
      tool: 'search',
      arguments_bytes: 22,
      arguments_sha256: run.tools.argumentsDigest({ query: fakeApiKey }),
      read_only: true,
    });
    expect(await keptOf(run, started.arguments_sha256)).toBe('{"query":"[redacted]"}');
    expect(run.journal.facts()).toEqual([]);
  });

  it('answers how it ended and what the model reads, recording nothing on the run itself', async () => {
    const run = await runWith(['search', 'large']);
    const found = await offeredIn(run, 'search').send({ callId: 'toolu_1', input: { query: 'acme' } }, unstopped);
    const cut = await offeredIn(run, 'large').send({ callId: 'toolu_2', input: { kib: 4 }, room: 600 }, unstopped);

    expect(found).toMatchObject({
      ended: { type: 'tool_call_answered', data: { is_error: false, result_bytes: 61, jsonrpc_id: 2 } },
      reply: { text: 'Found 2 rows for acme.', isError: false },
    });
    expect(cut.ended).toMatchObject({ type: 'tool_call_answered', data: { shown_bytes: 460 } });
    expect(cut.reply.text).toContain('[The answer was cut to 460 of its');
    expect(run.journal.facts()).toEqual([]);
  });
});

describe('a call a run sends itself that fails', () => {
  it('reports a server that failed, and marks a failure the server asked to slow down for', async () => {
    const run = await runWith(['search', 'broken'], {}, { ...defaultTiming, longestRetryWaitMs: 1000 });
    const broken = await offeredIn(run, 'broken').send({ callId: 'toolu_1', input: {} }, unstopped);
    run.fake.answerNextOf('tools/call', 429, 1, { 'retry-after': '5' });
    const limited = await offeredIn(run, 'search').send({ callId: 'toolu_2', input: { query: 'a' } }, unstopped);

    expect(broken).toMatchObject({
      ended: { type: 'tool_call_failed', data: { because: 'server_failure' } },
      reply: { isError: true },
    });
    expect(broken.ended.data).not.toHaveProperty('rate_limited');
    expect(limited.ended).toMatchObject({ type: 'tool_call_failed', data: { rate_limited: true } });
    expect(run.messages().map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        'The MCP server answered with an error: The broken tool broke on {}',
        'The tool server answered HTTP 429',
      ]),
    );
  });

  it('is given up when its signal stops it, as cancelled', async () => {
    const run = await runWith(['sleep']);
    const stop = new AbortController();
    const sending = offeredIn(run, 'sleep').send({ callId: 'toolu_1', input: { ms: 5000 } }, stop.signal);
    await until(() => run.fake.received().length === 1);
    stop.abort();

    expect((await sending).ended).toMatchObject({ type: 'tool_call_failed', data: { because: 'cancelled' } });
  });
});

describe('the JSON a run keeps of what it did', () => {
  it('is scrubbed of the secrets of its servers in its keys, strings and numbers, and stays JSON', async () => {
    const run = await runWith(['search']);
    const said = JSON.stringify({ text: `the key is ${fakeApiKey}`, [fakeApiKey]: 'a key', count: 2 });

    expect(JSON.parse(run.tools.scrubJson(said))).toEqual({
      text: 'the key is [redacted]',
      '[redacted]': 'a key',
      count: 2,
    });
  });
});

describe('the content a run keeps of its tools', () => {
  it('is kept while every server of its tools keeps content, and by none once one of them does not', async () => {
    const keeping = await runWith(['search']);
    const unkept = await runWith(['search'], { record_content: false });

    expect([keeping.tools.keepsContent, unkept.tools.keepsContent]).toEqual([true, false]);
    expect(keeping.tools.offered.map(({ name, reference, readOnly }) => [name, reference, readOnly])).toEqual([
      ['graph__search', { server: 'graph', tool: 'search' }, true],
    ]);
  });
});

describe('the reply rebuilt from what a call recorded', () => {
  it('is the reply the model was given, read whole or cut to the room it had', async () => {
    const run = await runWith(['search', 'large']);
    const sent = [
      await offeredIn(run, 'search').send({ callId: 'toolu_1', input: { query: 'acme' } }, unstopped),
      await offeredIn(run, 'large').send({ callId: 'toolu_2', input: { kib: 4 }, room: 600 }, unstopped),
    ];
    const answers = sent.flatMap(({ ended }) => answeredIn(ended));
    const rebuilt = await Promise.all(
      answers.map(async (answered) => keptReply(answered, String(await keptOf(run, answered.result_sha256)))),
    );

    expect(rebuilt).toEqual(sent.map(({ reply }) => reply));
  });

  it('is the failure in the words the model was given', async () => {
    const run = await runWith(['broken']);
    const { ended, reply } = await offeredIn(run, 'broken').send({ callId: 'toolu_1', input: {} }, unstopped);
    expect(failedIn(ended).map((failed) => failureReply(failed, 'graph'))).toEqual([reply]);
  });

  it('is its own words for arguments the server refused, and the server named for any other failure', () => {
    const refused: CallEnded = {
      type: 'tool_call_failed',
      data: { because: 'arguments_refused', detail: 'The query is missing', duration_ms: 3, jsonrpc_id: 2 },
    };
    const unsaid: CallEnded = {
      type: 'tool_call_failed',
      data: { because: 'timed_out', duration_ms: 3, jsonrpc_id: 3 },
    };

    expect([refused, unsaid].map(({ data }) => failureReply(data, 'graph'))).toEqual([
      { text: 'The query is missing', isError: true },
      { text: 'The tool server graph failed: ', isError: true },
    ]);
  });
});
