import { Result, type Schema } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JsonOutput } from '../model/model-request.ts';
import {
  answersInTurn,
  describingGateway,
  enforcingGateway,
  gatewayModel,
  refusedByTheGateway,
  respondedInTurn,
  usageOfOneAnswer,
} from '../provider-testing/answers-in-turn.ts';
import { chatCompletion, openAiResponse } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { scoresSchema } from '../schema-testing/answer-schemas.ts';
import { treeSchema } from '../schema-testing/revision-schemas.ts';
import { compileAnswerSchema } from '../schema/answer-schema.ts';
import { accessFor, failed, jsonRequest, succeeded, textRequest } from '../testing/adapter-harness.ts';

function jsonOutputOf(document: Schema.JsonObject): JsonOutput {
  return { type: 'json', schema: Result.getOrThrow(compileAnswerSchema(document)) };
}

const wrongScore = '{"scores":[{"key":"Ada","value":11}],"winner":"Ada"}';

const toldTheIssue =
  "Your answer does not meet these rules of the answer's schema:\n/scores/0/value: Expected a value less than or equal to 10\n\nAnswer again in full, following every rule.";

describe('a JSON answer in the portable form whose root is not one object', () => {
  it('keeps the answer as the model wrote it, and gives the caller the root unwrapped', async () => {
    const recording = recordingFetch(() => jsonResponse(openAiResponse('{"value":["a","b"]}')));
    const access = await accessFor({ OPENAI_API_KEY: 'k' }, { fetch: recording.fetch });

    const result = await succeeded(
      access,
      textRequest('openai/gpt-5', { output: jsonOutputOf({ type: 'array', items: { type: 'string' } }) }),
    );

    expect(result).toMatchObject({ text: '{"value":["a","b"]}', json: ['a', 'b'], output_mode: 'portable' });
  });
});

describe('a JSON answer whose schema is not portable, asked of a provider that takes schemas', () => {
  it('is asked for with the schema as written in the instructions, and no response format', async () => {
    const { access, requests } = await answersInTurn(
      enforcingGateway,
      chatCompletion('{"root":{"name":"a","children":[{"name":"b"}]}}'),
    );

    const result = await succeeded(access, textRequest(gatewayModel, { output: jsonOutputOf(treeSchema) }));

    const [request] = requests();
    expect(request?.body).not.toHaveProperty('response_format');
    expect(JSON.stringify(request?.body)).toContain(JSON.stringify(JSON.stringify(treeSchema)).slice(1, -1));
    expect(result).toMatchObject({
      json: { root: { name: 'a', children: [{ name: 'b' }] } },
      output_mode: 'described',
    });
  });

  it('is not asked for again when the provider refuses it, since its schema was not sent', async () => {
    const { access, requests } = await respondedInTurn(enforcingGateway, refusedByTheGateway(400));

    const failure = await failed(access, textRequest(gatewayModel, { output: jsonOutputOf(treeSchema) }));

    expect(requests()).toHaveLength(1);
    expect(failure).toMatchObject({ _tag: 'definition_invalid' });
    expect(failure).not.toHaveProperty('schema_refusal');
  });
});

describe('a JSON answer in the portable form that misses its schema', () => {
  it('is told its issues at the pointers of what the model wrote, and records them where the schema as written has them', async () => {
    const { access, requests } = await answersInTurn(
      enforcingGateway,
      chatCompletion(wrongScore),
      chatCompletion('{"scores":[{"key":"Ada","value":9}],"winner":"Ada"}'),
    );

    const result = await succeeded(access, textRequest(gatewayModel, { output: jsonOutputOf(scoresSchema) }));

    expect(requests()[1]?.body).toMatchObject({
      response_format: { type: 'json_schema' },
      messages: [{}, {}, { role: 'assistant', content: wrongScore }, { role: 'user', content: toldTheIssue }],
    });
    expect(result).toMatchObject({
      json: { scores: { Ada: 9 }, winner: 'Ada' },
      output_mode: 'portable',
      repair: {
        outcome: 'repaired',
        issues: [{ pointer: '/scores/Ada', detail: 'Expected a value less than or equal to 10' }],
      },
    });
  });
});

function wrongThenRight(first: object = chatCompletion('{"verdict":42}')) {
  return answersInTurn(describingGateway, first, chatCompletion('{"verdict":"approve"}'));
}

describe('a JSON answer that misses its schema when the run has too few tokens left to ask again', () => {
  it.each([
    ['input tokens', 'input_tokens', { input_tokens: 38 }],
    ["tokens of the model's context window", 'context_window', { input_tokens: 1_000_000, context_window: 20 }],
  ] as const)('is not asked for again when the run has too few %s left', async (_what, because, room) => {
    const { access, requests } = await wrongThenRight();

    const failure = await failed(access, jsonRequest(gatewayModel, { room }));

    expect(requests()).toHaveLength(1);
    expect(failure).toMatchObject({
      _tag: 'output_invalid',
      usage: usageOfOneAnswer,
      issues: [{ pointer: '/verdict', detail: 'Expected string' }],
      repair: { outcome: 'skipped', because },
    });
  });

  it('is asked for again when the run has the room', async () => {
    const { access, requests } = await wrongThenRight();

    await succeeded(
      access,
      jsonRequest(gatewayModel, { room: { input_tokens: 1_000_000, context_window: 1_000_000 } }),
    );

    expect(requests()).toHaveLength(2);
  });

  it('is asked for again when the provider counted no tokens, as nothing says the room is short', async () => {
    const { access, requests } = await wrongThenRight({ ...chatCompletion('{"verdict":42}'), usage: undefined });

    await succeeded(access, jsonRequest(gatewayModel, { room: { input_tokens: 1 } }));

    expect(requests()).toHaveLength(2);
  });
});

const began = Date.parse('2026-11-06T09:00:00.000Z');

async function firstAnsweredAfter(ms: number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(began);
  const answering = await wrongThenRight();
  answering.before(() => {
    vi.setSystemTime(began + ms);
  });
  return answering;
}

describe('a JSON answer that misses its schema when little time is left', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["the call's deadline", { timeout_ms: 60_000 }],
    ["the run's bound", { room: { input_tokens: 1_000_000, ends_at: began + 50_000 } }],
  ] as const)('is not asked for again when less of %s is left than the first answer took', async (_what, more) => {
    const { access, requests } = await firstAnsweredAfter(40_000);

    const failure = await failed(access, jsonRequest(gatewayModel, more));

    expect(requests()).toHaveLength(1);
    expect(failure).toMatchObject({ _tag: 'output_invalid', repair: { outcome: 'skipped', because: 'time' } });
  });

  it('is asked for again when at least as much time is left as the first answer took', async () => {
    const { access, requests } = await firstAnsweredAfter(10_000);
    const room = { input_tokens: 1_000_000, ends_at: began + 20_000 };

    const result = await succeeded(access, jsonRequest(gatewayModel, { timeout_ms: 60_000, room }));

    expect(requests()).toHaveLength(2);
    expect(result).toMatchObject({ repair: { outcome: 'repaired' } });
  });
});

const schemaWords = 'The verdict on the renewal, in a word. '.repeat(100);

const longlyDescribed = Result.getOrThrow(
  compileAnswerSchema({
    type: 'object',
    description: schemaWords,
    properties: { verdict: { type: 'string' } },
    required: ['verdict'],
    additionalProperties: false,
  }),
);

describe('the room of a JSON answer whose schema the provider enforces', () => {
  it('counts the schema among the bytes the request sent, so the tokens of a byte are not overstated', async () => {
    const { access, requests } = await answersInTurn(
      enforcingGateway,
      chatCompletion(`{"verdict":42,"note":"${'n'.repeat(1500)}"}`),
      chatCompletion('{"verdict":"approve"}'),
    );
    const output = { type: 'json', schema: longlyDescribed } as const;

    const result = await succeeded(access, jsonRequest(gatewayModel, { output, room: { input_tokens: 100 } }));

    expect(requests()).toHaveLength(2);
    expect(result.request_bytes).toBeGreaterThan(2 * schemaWords.length);
  });
});
