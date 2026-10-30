import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { reportingAccess } from '@on.auto/tool-servers/testing';
import { Effect, Exit } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { ContentRefused, DefinitionInvalid, RequestTooLong, TimedOut, type ModelResult } from '../index.ts';
import { documentOf } from '../testing/definition-documents.ts';
import {
  answers,
  callingTools,
  textResult,
  toolCallsResult,
  type ScriptedCall,
  type ScriptedReply,
} from '../testing/index.ts';
import { reasoningWithTools, type ReasoningRun } from '../testing/reasoning-runs.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function graphServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

const source = documentOf('model: anthropic/claude-sonnet-4-5\ntools: [graph/*]', 'Summarize acme.');

function toolRun(fake: FakeMcpServer, ...replies: readonly ScriptedReply[]): ReasoningRun {
  const { access } = reportingAccess(
    { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
    { environment: { GRAPH_API_KEY: apiKey } },
  );
  closing.push(access.close);
  return reasoningWithTools(access, ...replies);
}

function ending(fake: FakeMcpServer, ...replies: readonly ScriptedReply[]) {
  return toolRun(fake, ...replies).running(source);
}

const byAnthropic: Partial<ModelResult> = {
  model: { requested: 'anthropic/claude-sonnet-4-5', resolved: 'anthropic/claude-sonnet-4-5', answered: 'claude' },
};

function asking(calls: readonly ScriptedCall[]): ScriptedReply {
  return answers(toolCallsResult(calls, byAnthropic));
}

const pastTheBound: ScriptedReply = () =>
  TestClock.adjust('600001 millis').pipe(Effect.andThen(Effect.succeed(textResult('Too late.'))));

const timedOut: ScriptedReply = () =>
  Effect.fail(
    new TimedOut({ detail: 'anthropic did not answer within 60000 ms', provider: 'anthropic', timeout_ms: 60_000 }),
  );

const refused: ScriptedReply = () =>
  Effect.fail(
    new ContentRefused({
      detail: 'anthropic refused',
      provider: 'anthropic',
      status: 400,
      raw_finish_reason: null,
      usage: null,
    }),
  );

const searched: readonly ScriptedCall[] = [['graph__search', { query: 'acme' }]];

const everyCall = Array.from({ length: 25 }, (_, call): ScriptedCall => ['graph__search', { query: `acme ${call}` }]);

const used = 'after the run called the search tool of graph';

const boundWords = 'The run went on for 600000 ms, the longest a run that calls tools may take';

function unfinished(because: string, detail: string) {
  return Exit.fail(expect.objectContaining({ kind: 'tools_unfinished', because, detail }));
}

describe('a run that called tools and could not answer', () => {
  it('is unavailable as unfinished because the model kept calling tools once they were withheld, and lets its session go', async () => {
    const fake = await graphServer();

    expect(await ending(fake, asking(everyCall), asking(searched))).toEqual(
      unfinished(
        'no_answer',
        `anthropic kept calling tools in the step that withheld them, instead of answering, ${used}`,
      ),
    );
    expect(fake.endedSessions()).toBe(1);
  });

  it('is unavailable as unfinished because it reached its bound', async () => {
    expect(await ending(await graphServer(), asking(searched), pastTheBound)).toEqual(
      unfinished('run_bound', `${boundWords}, ${used}`),
    );
  });
});

describe('a run that called tools and lost its model', () => {
  it('is unavailable as unfinished because the model stopped answering, never asking to try again', async () => {
    expect(await ending(await graphServer(), ...callingTools(searched, timedOut))).toEqual(
      unfinished('model_unavailable', `anthropic did not answer within 60000 ms, ${used}`),
    );
  });

  it('keeps a rejection that is not unavailable', async () => {
    expect(await ending(await graphServer(), ...callingTools(searched, refused))).toEqual(
      Exit.fail(expect.objectContaining({ _tag: 'invalid_input' })),
    );
  });
});

describe('a run whose tool servers kept failing', () => {
  it('is unavailable as unfinished because a tool server kept failing', async () => {
    const broken = [1, 2, 3, 4, 5].map((attempt): ScriptedCall => ['graph__broken', { attempt }]);

    expect(await ending(await graphServer(), asking(broken))).toEqual(
      unfinished('server_failed', 'A tool server kept failing, after the run called the broken tool of graph'),
    );
  });

  it('is unavailable as unfinished because a tool server kept asking it to slow down', async () => {
    const fake = await graphServer();
    const limited = ['a', 'b', 'c', 'd', 'e'].map((query): ScriptedCall => ['graph__search', { query }]);
    const limiting: ScriptedReply = (request) =>
      Effect.sync(() => {
        fake.answerNextWith(429, 5);
      }).pipe(Effect.andThen(asking(limited)(request)));

    expect(await ending(fake, limiting)).toEqual(
      unfinished('server_failed', `A tool server kept asking the run to slow down for longer than it waits, ${used}`),
    );
  });
});

function unknown(because: string, detail: string) {
  return Exit.fail(expect.objectContaining({ _tag: 'conflict', kind: 'effect_unknown', because, detail }));
}

const echoed: ScriptedCall = ['graph__echo', { said: 'acme' }];

describe('a run that could not finish after calling a tool its server does not mark read-only', () => {
  it('is a conflict whose effect is unknown, with the because and detail it would have had, whether that tool came first or last', async () => {
    expect(await ending(await graphServer(), ...callingTools([...searched, echoed], timedOut))).toEqual(
      unknown(
        'model_unavailable',
        'anthropic did not answer within 60000 ms, after the run called the search and echo tools of graph',
      ),
    );
    expect(await ending(await graphServer(), ...callingTools([echoed, ...searched], timedOut))).toEqual(
      unknown(
        'model_unavailable',
        'anthropic did not answer within 60000 ms, after the run called the echo and search tools of graph',
      ),
    );
  });

  it('is a conflict whose effect is unknown when its run reached its bound', async () => {
    expect(await ending(await graphServer(), asking([echoed]), pastTheBound)).toEqual(
      unknown('run_bound', `${boundWords}, after the run called the echo tool of graph`),
    );
  });
});

describe('a run that could not finish before it called a tool', () => {
  it('is unavailable as before, without saying that tools were called', async () => {
    const fake = await graphServer();

    expect(await ending(fake, pastTheBound)).toEqual(
      Exit.fail(expect.objectContaining({ _tag: 'unavailable', detail: boundWords })),
    );
    expect(await ending(fake, timedOut)).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: 'unavailable',
          detail: 'anthropic did not answer within 60000 ms; try again later',
        }),
      ),
    );
  });
});

function refusedSaying(providerMessage: string): ScriptedReply {
  return () =>
    Effect.fail(
      new DefinitionInvalid({
        detail: 'anthropic answered HTTP 400: the request was rejected as invalid',
        provider: 'anthropic',
        status: 400,
        provider_message: providerMessage,
        issues: [],
      }),
    );
}

function answeredBytesOf({ journal }: ReasoningRun): readonly number[] {
  return journal.recorded().flatMap((fact) => (fact.type === 'tool_call_answered' ? [fact.data.result_bytes] : []));
}

const refusedAsInvalid =
  'anthropic answered HTTP 400: the request was rejected as invalid; update the reasoning function definition';

function refusedAsTooLong(providerMessage: string | null = null): ScriptedReply {
  return () =>
    Effect.fail(
      new RequestTooLong({
        detail: 'anthropic refused the request as longer than the model takes, by HTTP 413',
        provider: 'anthropic',
        status: 413,
        signal: 'HTTP 413',
        provider_message: providerMessage,
        last_input_tokens: null,
      }),
    );
}

const tooLongByStatus = 'anthropic refused the request as longer than the model takes, by HTTP 413';

const counted = {
  input: { total: 190_000, uncached: null, cache_read: null, cache_write: null },
  output: { total: 40, text: null, reasoning: null },
  total: null,
};

function tooLong(detail: string) {
  return Exit.fail(expect.objectContaining({ _tag: 'conflict', kind: 'unworkable', detail }));
}

describe('a run whose provider signals its request too long after its tools answered', () => {
  it('is unworkable, with the bytes the tools answered and the input tokens of the last turn, advising a page', async () => {
    const said = 'prompt is too long: 213456 tokens > 200000 maximum';
    const run = toolRun(
      await graphServer(),
      answers(toolCallsResult(searched, { ...byAnthropic, usage: counted })),
      refusedAsTooLong(said),
    );
    const ran = await run.running(source);

    expect(ran).toEqual(
      tooLong(
        `${tooLongByStatus}; the tools of this run answered ${answeredBytesOf(run).join()} bytes, which the model reads whole, and the provider counted 190,000 input tokens in the last turn it answered, so ask the tools for a page of what they hold. The provider said: ${said}`,
      ),
    );
  });

  it('names the bytes alone when the provider reported no input tokens, and the prompt when no tool answered', async () => {
    const run = toolRun(await graphServer(), asking(searched), refusedAsTooLong());
    const ran = await run.running(source);

    expect([ran, await ending(await graphServer(), refusedAsTooLong())]).toEqual([
      tooLong(
        `${tooLongByStatus}; the tools of this run answered ${answeredBytesOf(run).join()} bytes, which the model reads whole, so ask the tools for a page of what they hold`,
      ),
      tooLong(`${tooLongByStatus}; shorten the prompt or the input of the reasoning function`),
    ]);
  });
});

describe('a run whose provider refuses its request without a signal of length', () => {
  it('is unworkable in the words it had, with no claim of length, whatever its message says', async () => {
    expect(await ending(await graphServer(), asking(searched), refusedSaying('string too long'))).toEqual(
      tooLong(`${refusedAsInvalid}. The provider said: string too long`),
    );
  });
});
