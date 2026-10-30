import type { RecordedCall } from '@on.auto/definitions';
import { memoryRecordedContent } from '@on.auto/operations/testing';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { RateLimited } from '../failure/rate-limited.ts';
import type { ToolCallAnswer } from '../jobs/jobs.ts';
import { textResult, toolCallsResult } from '../testing/model-results.ts';
import { answers, type ScriptedReply } from '../testing/scripted-language-model.ts';
import { answeredWith, foundRows, stepsOf, toolOf, type StepsOptions } from '../testing/step-runs.ts';
import { noLongerOffered } from './asked-calls.ts';

const search = toolOf('graph', 'search');

const echo = toolOf('graph', 'echo', false);

const asking = answers(toolCallsResult([['graph__search', { query: 'acme' }]]));

const answering = answers(textResult('Acme has 2 rows.'));

interface Attempts {
  readonly first: ReturnType<typeof stepsOf>;
  readonly calls: readonly RecordedCall[];
  readonly startedAt: string;
}

async function firstAttempt(options: StepsOptions): Promise<Attempts> {
  const startedAt = new Date().toISOString();
  const first = stepsOf({ ...options, before: { startedAt, modelCallsBefore: 0, calls: [] } });
  await Effect.runPromise(Effect.exit(first.stepping));
  return { first, calls: first.journal.calls(), startedAt };
}

function upTo(calls: readonly RecordedCall[], last: RecordedCall['type'], nth = 1): readonly RecordedCall[] {
  const ends = calls.flatMap((call, index) => (call.type === last ? [index] : []));
  return calls.slice(0, Number(ends[nth - 1]) + 1);
}

function resumed({ first, startedAt }: Attempts, calls: readonly RecordedCall[], options: StepsOptions = {}) {
  return stepsOf({
    tools: [search],
    content: first.content,
    ...options,
    before: { startedAt, modelCallsBefore: 0, calls },
  });
}

function typesOf(calls: readonly { readonly type: string }[]): readonly string[] {
  return calls.map(({ type }) => type);
}

describe('a run that goes on from its facts', () => {
  it('makes no call once its last model call was answered without asking for more, so it is never paid again', async () => {
    const attempts = await firstAttempt({ tools: [search], replies: [asking, answering] });
    const again = resumed(attempts, attempts.calls);

    expect(await Effect.runPromise(again.stepping)).toMatchObject({ ending: { type: 'answered' } });
    expect([again.requests(), again.sends(), again.journal.recorded()]).toEqual([[], [], []]);
  });

  it('sends the request the attempt before would have sent, from the facts and the kept content', async () => {
    const attempts = await firstAttempt({ tools: [search], replies: [asking, answering] });
    const again = resumed(attempts, upTo(attempts.calls, 'tool_call_answered'), { replies: [answering] });

    expect(await Effect.runPromise(again.stepping)).toMatchObject({ ending: { type: 'answered' } });
    expect(again.requests()).toEqual([attempts.first.requests()[1]]);
    expect(again.sends()).toEqual([]);
  });

  it('remakes a model call started and never answered as a call of its own, ending the first as interrupted', async () => {
    const attempts = await firstAttempt({ tools: [search], replies: [asking, answering] });
    const again = resumed(attempts, upTo(attempts.calls, 'model_call_started', 2), { replies: [answering] });
    await Effect.runPromise(again.stepping);

    expect(again.requests()).toEqual([attempts.first.requests()[1]]);
    expect(again.journal.recorded()).toMatchObject([
      { type: 'model_call_failed', number: 2, data: { because: 'interrupted' } },
      { type: 'model_call_started', number: 3 },
      { type: 'model_call_answered', number: 3 },
    ]);
  });
});

describe('a run that goes on from a tool call never answered', () => {
  it('remakes a call of a read-only tool started and never answered, ending the first as interrupted', async () => {
    const attempts = await firstAttempt({ tools: [search], replies: [asking, answering] });
    const again = resumed(attempts, upTo(attempts.calls, 'tool_call_started'), { replies: [answering] });
    await Effect.runPromise(again.stepping);

    expect(again.sends().map(({ callId }) => callId)).toEqual(['call-1']);
    expect(typesOf(again.journal.recorded())).toEqual([
      'tool_call_failed',
      'tool_call_started',
      'tool_call_answered',
      'model_call_started',
      'model_call_answered',
    ]);
    expect(again.journal.recorded()[0]).toMatchObject({ number: 1, data: { because: 'interrupted' } });
  });

  it('ends with the outcome of a call unknown when the tool of a call never answered may change something', async () => {
    const attempts = await firstAttempt({
      tools: [echo],
      replies: [answers(toolCallsResult([['graph__echo', { said: 'acme' }]])), answering],
    });
    const again = resumed(attempts, upTo(attempts.calls, 'tool_call_started'), { tools: [echo] });

    expect(await Effect.runPromise(again.stepping)).toMatchObject({ ending: { type: 'outcome_unknown' } });
    expect(again.sends()).toEqual([]);
    expect(again.journal.recorded()).toMatchObject([
      { type: 'tool_call_failed', number: 1, data: { because: 'interrupted' } },
    ]);
  });
});

const limited: ScriptedReply = () =>
  Effect.fail(
    new RateLimited({ detail: 'anthropic is limiting the rate', provider: 'anthropic', retry_after_ms: 2000 }),
  );

const timedOut: ToolCallAnswer = {
  ended: {
    type: 'tool_call_failed',
    data: { because: 'timed_out', detail: 'No answer in 30000 ms', duration_ms: 30_000, jsonrpc_id: 1 },
  },
  reply: { text: 'The tool server graph failed: No answer in 30000 ms', isError: true },
};

const failing = () => Effect.succeed(timedOut);

describe('a run that goes on after a call of a tool failed', () => {
  it('tells the model the failure in the words of the server, from the fact alone', async () => {
    const attempts = await firstAttempt({ tools: [search], replies: [asking, answering], send: failing });
    const again = resumed(attempts, upTo(attempts.calls, 'tool_call_failed'), { replies: [answering] });
    await Effect.runPromise(again.stepping);

    expect(again.requests()).toEqual([attempts.first.requests()[1]]);
  });
});

const profile = toolOf('graph', 'profile');

describe('a run that goes on after its servers stopped offering a tool it asked for', () => {
  it('tells the model the tool is no longer offered, sending nothing, for a call not started or never answered', async () => {
    const attempts = await firstAttempt({ tools: [search], replies: [asking, answering] });
    const notStarted = resumed(attempts, upTo(attempts.calls, 'model_call_answered'), {
      tools: [profile],
      replies: [answering],
    });
    const neverAnswered = resumed(attempts, upTo(attempts.calls, 'tool_call_started'), {
      tools: [profile],
      replies: [answering],
    });
    const endings = [await Effect.runPromise(notStarted.stepping), await Effect.runPromise(neverAnswered.stepping)];

    expect(endings).toMatchObject([{ ending: { type: 'answered' } }, { ending: { type: 'answered' } }]);
    expect([notStarted.sends(), neverAnswered.sends()]).toEqual([[], []]);
    expect(JSON.stringify(notStarted.requests())).toContain(noLongerOffered('graph__search'));
    expect(typesOf(neverAnswered.journal.recorded())).toEqual([
      'tool_call_failed',
      'model_call_started',
      'model_call_answered',
    ]);
  });
});

describe('a run that goes on from facts that ended it', () => {
  it('ends as its recorded failure, without a call', async () => {
    const attempts = await firstAttempt({ tools: [search], replies: [asking, limited] });
    const again = resumed(attempts, attempts.calls);

    expect(await Effect.runPromise(again.stepping)).toMatchObject({
      ending: { type: 'failed', data: { because: 'rate_limited', retry_after_ms: 2000 } },
    });
    expect(again.requests()).toEqual([]);
  });

  it('ends at its bound when its model call was given up there', async () => {
    const attempts = await firstAttempt({
      tools: [search],
      replies: [() => Effect.never],
      bounds: { runBoundMs: 10, limits: { contextWindow: undefined, mostInputTokens: 2_000_000 } },
    });
    const again = resumed(attempts, attempts.calls, {
      bounds: { runBoundMs: 600_000, limits: { contextWindow: undefined, mostInputTokens: 2_000_000 } },
    });

    expect(await Effect.runPromise(again.stepping)).toMatchObject({
      ending: {
        type: 'stopped',
        because: 'run_bound',
        detail: 'The run went on for 10 ms, the longest a run that calls tools may take',
      },
    });
  });
});

describe('a run that goes on without the content of its calls', () => {
  it('cannot go on when its servers kept none, or the content it kept is gone', async () => {
    const unkept = await firstAttempt({ tools: [search], replies: [asking, answering], keepsContent: false });
    const kept = await firstAttempt({ tools: [search], replies: [asking, answering] });
    const prefix = upTo(kept.calls, 'tool_call_answered');

    expect(await Effect.runPromise(resumed(unkept, upTo(unkept.calls, 'tool_call_answered')).stepping)).toMatchObject({
      ending: { type: 'unreadable' },
    });
    expect(await Effect.runPromise(resumed(kept, prefix, { content: memoryRecordedContent() }).stepping)).toMatchObject(
      {
        ending: { type: 'unreadable' },
      },
    );
  });

  it('cannot go on when the answer of a tool its next model call needs was not kept', async () => {
    const unkeptAnswer = await firstAttempt({
      tools: [search],
      replies: [asking, answering],
      send: () => Effect.succeed(answeredWith(foundRows)),
    });
    const again = resumed(unkeptAnswer, upTo(unkeptAnswer.calls, 'tool_call_answered'));

    expect(await Effect.runPromise(again.stepping)).toMatchObject({ ending: { type: 'unreadable' } });
  });
});

describe('two attempts that go on at once from a model call whose tool calls never started', () => {
  it('send the call of a tool that may change something once, the later start refused as taken', async () => {
    const attempts = await firstAttempt({
      tools: [echo],
      replies: [answers(toolCallsResult([['graph__echo', { said: 'acme' }]])), answering],
    });
    const calls = upTo(attempts.calls, 'model_call_answered');
    const one = resumed(attempts, calls, { tools: [echo], replies: [answering] });
    const other = resumed(attempts, calls, { tools: [echo], journal: one.journal, replies: [answering] });
    const { journal } = one;

    const exits = await Effect.runPromise(
      Effect.all([Effect.exit(one.stepping), Effect.exit(other.stepping)], { concurrency: 'unbounded' }),
    );

    expect([...one.sends(), ...other.sends()]).toHaveLength(1);
    expect(exits).toContainEqual(Exit.fail(expect.objectContaining({ _tag: 'conflict', kind: 'taken' })));
    expect(exits).toContainEqual(expect.objectContaining({ _tag: 'Success' }));
    expect(typesOf(journal.recorded())).toEqual([
      'tool_call_started',
      'tool_call_answered',
      'model_call_started',
      'model_call_answered',
    ]);
  });
});

describe('a run that goes on from its facts once its bound passed while one of its tool calls was open', () => {
  it('ends that call as interrupted before it ends at its bound, so no start is left without an end', async () => {
    const attempts = await firstAttempt({ tools: [search], replies: [asking, answering] });
    const anHourAgo = new Date(Date.parse(attempts.startedAt) - 3_600_000).toISOString();
    const again = resumed({ ...attempts, startedAt: anHourAgo }, upTo(attempts.calls, 'tool_call_started'));

    expect(await Effect.runPromise(again.stepping)).toMatchObject({
      ending: { type: 'stopped', because: 'run_bound' },
    });
    expect(again.journal.recorded()).toMatchObject([{ type: 'tool_call_failed', data: { because: 'interrupted' } }]);
  });
});

describe('a run that goes on from its facts, whose cancel another server recorded', () => {
  it('ends its open call as interrupted, starts no call, and ends cancelled', async () => {
    const attempts = await firstAttempt({ tools: [search], replies: [asking, answering] });
    const again = resumed(attempts, upTo(attempts.calls, 'tool_call_started'), { cancelledAfter: 1 });

    expect(await Effect.runPromise(again.stepping)).toMatchObject({
      ending: { type: 'cancelled', kind: 'requested' },
    });
    expect([typesOf(again.journal.recorded()), again.sends()]).toEqual([['tool_call_failed'], []]);
  });
});
