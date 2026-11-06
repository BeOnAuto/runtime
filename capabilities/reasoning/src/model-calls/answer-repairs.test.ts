import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import {
  answersInTurn,
  describingGateway,
  enforcingGateway,
  gatewayModel,
  usageOfOneAnswer,
  usageOfTwoAnswers,
} from '../provider-testing/answers-in-turn.ts';
import { generatedText, mockGeneration } from '../provider-testing/mock-models.ts';
import { chatCompletion, openAiResponse } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { chatCompletionToolCall } from '../provider-testing/tool-call-replies.ts';
import { accessFor, failed, jsonRequest, succeeded } from '../testing/adapter-harness.ts';

const notJsonWords =
  'Your answer is not JSON. Answer again in full, with only a JSON value that matches the schema of the answer, and no other text.';

function rulesWords(...rules: readonly string[]): string {
  return `Your answer does not meet these rules of the answer's schema:\n${rules.join('\n')}\n\nAnswer again in full, following every rule.`;
}

const verdictIssue = { pointer: '/verdict', detail: 'Expected string' };

const anyDuration: unknown = expect.any(Number);

function wrongThenRight(environment = describingGateway) {
  return answersInTurn(environment, chatCompletion('{"verdict":42}'), chatCompletion('{"verdict":"approve"}'));
}

describe('a JSON answer that misses its schema', () => {
  it('is asked for once more, after the answer, with the issues at the pointers of what the model wrote', async () => {
    const { access, requests } = await wrongThenRight();

    const result = await succeeded(access, jsonRequest(gatewayModel));

    expect(requests().map(({ body }) => body)).toMatchObject([
      { messages: [{ role: 'system' }, { role: 'user' }] },
      {
        messages: [
          { role: 'system' },
          { role: 'user' },
          { role: 'assistant', content: '{"verdict":42}' },
          { role: 'user', content: rulesWords('/verdict: Expected string') },
        ],
      },
    ]);
    expect(result).toMatchObject({
      text: '{"verdict":"approve"}',
      json: { verdict: 'approve' },
      output_mode: 'described',
      repair: { outcome: 'repaired', issues: [verdictIssue], usage: usageOfOneAnswer, cost_usd: 0.25 },
    });
    expect(result.repair).toHaveProperty('duration_ms', anyDuration);
  });
});

describe('a JSON answer that misses its schema and is asked for once more', () => {
  it('is answered with the usage, the cost and the bytes of both requests summed', async () => {
    const asked = await wrongThenRight();
    const once = await answersInTurn(describingGateway, chatCompletion('{"verdict":"approve"}'));

    const result = await succeeded(asked.access, jsonRequest(gatewayModel));
    const answeredOnce = await succeeded(once.access, jsonRequest(gatewayModel));

    expect(result).toMatchObject({ usage: usageOfTwoAnswers, cost_usd: 0.5 });
    expect(answeredOnce).toMatchObject({ usage: usageOfOneAnswer, cost_usd: 0.25 });
    expect(result.request_bytes).toBeGreaterThan(2 * answeredOnce.request_bytes);
  });

  it('is told an answer that is not JSON is not JSON', async () => {
    const { access, requests } = await answersInTurn(
      describingGateway,
      chatCompletion('I would approve it.'),
      chatCompletion('{"verdict":"approve"}'),
    );

    expect(await succeeded(access, jsonRequest(gatewayModel))).toMatchObject({
      json: { verdict: 'approve' },
      repair: { outcome: 'repaired', issues: [] },
    });
    expect(requests()[1]?.body).toMatchObject({
      messages: [{}, {}, { role: 'assistant', content: 'I would approve it.' }, { content: notJsonWords }],
    });
  });

  it('tells at most five of its issues', async () => {
    const { access, requests } = await answersInTurn(
      describingGateway,
      chatCompletion('{"verdict":1,"a":1,"b":2,"c":3,"d":4,"e":5}'),
      chatCompletion('{"verdict":"approve"}'),
    );

    const result = await succeeded(access, jsonRequest(gatewayModel));

    expect(result.repair).toHaveProperty(['issues', 'length'], 5);
    expect(JSON.stringify(requests()[1]?.body).match(/Expected/gu)).toHaveLength(5);
  });
});

describe('a JSON answer that misses its schema when asked for once more too', () => {
  it('fails with the issues of the corrected answer, and is asked for no third time', async () => {
    const { access, requests } = await answersInTurn(
      describingGateway,
      chatCompletion('{"verdict":42}'),
      chatCompletion('{"verdict":"approve","note":"x"}'),
    );

    const failure = await failed(access, jsonRequest(gatewayModel));

    expect(requests()).toHaveLength(2);
    expect(failure).toMatchObject({
      _tag: 'output_invalid',
      detail: 'The answer does not match the output schema',
      issues: [{ pointer: '/note', detail: 'Expected no excess property' }],
      usage: usageOfTwoAnswers,
      output_mode: 'described',
      repair: { outcome: 'invalid', issues: [verdictIssue], usage: usageOfOneAnswer },
    });
  });

  it('fails as content refused, its correction invalid, when a content filter stopped the corrected answer', async () => {
    const { access } = await answersInTurn(
      describingGateway,
      chatCompletion('{"verdict":42}'),
      chatCompletion('{"verdict":"approve"}', 'content_filter'),
    );

    expect(await failed(access, jsonRequest(gatewayModel))).toMatchObject({
      _tag: 'content_refused',
      usage: usageOfTwoAnswers,
      repair: { outcome: 'invalid', issues: [verdictIssue] },
    });
  });
});

describe('a JSON answer that misses its schema, asked for once more by a run that offers tools', () => {
  it('is asked for with the tools offered as before, and a tool call in the answer is no JSON', async () => {
    const tools = [{ name: 'lookup', description: 'Looks an account up', inputSchema: { type: 'object' } }];
    const { access, requests } = await answersInTurn(
      describingGateway,
      chatCompletion('I would approve it.'),
      chatCompletionToolCall('lookup', { account: 'acme' }),
    );

    const failure = await failed(access, jsonRequest(gatewayModel, { tools }));

    expect(requests().map(({ body }) => body)).toMatchObject([
      { tool_choice: 'auto', tools: [{ function: { name: 'lookup' } }] },
      { tool_choice: 'auto', tools: [{ function: { name: 'lookup' } }] },
    ]);
    expect(failure).toMatchObject({
      _tag: 'output_invalid',
      detail: 'The answer is not JSON',
      finish_reason: 'tool_calls',
      repair: { outcome: 'invalid' },
    });
  });
});

describe('a JSON answer that misses a schema the provider enforced', () => {
  it('is asked for once more through a gateway, with the schema enforced again', async () => {
    const { access, requests } = await wrongThenRight(enforcingGateway);

    const result = await succeeded(access, jsonRequest(gatewayModel));

    expect(requests()[1]?.body).toMatchObject({
      response_format: { type: 'json_schema' },
      messages: [
        {},
        {},
        { role: 'assistant', content: '{"verdict":42}' },
        { content: rulesWords('/verdict: Expected string') },
      ],
    });
    expect(result).toMatchObject({
      json: { verdict: 'approve' },
      usage: usageOfTwoAnswers,
      repair: { outcome: 'repaired' },
    });
    expect(result).not.toHaveProperty('output_mode');
  });

  it('is asked for once more of a provider that enforces it itself, and fails after that one correction', async () => {
    const recording = recordingFetch(() => jsonResponse(openAiResponse('{"verdict":42}')));
    const access = await accessFor({ OPENAI_API_KEY: 'k' }, { fetch: recording.fetch });

    const failure = await failed(access, jsonRequest('openai/gpt-5'));

    const bodies = recording.requests().map(({ body }) => JSON.stringify(body));
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toContain('"type":"json_schema"');
    expect(bodies[1]).toContain('/verdict: Expected string');
    expect(failure).toMatchObject({ _tag: 'output_invalid', repair: { outcome: 'invalid' } });
  });
});

describe('the warnings of a JSON answer asked for once more', () => {
  it('are those of both requests, each once', async () => {
    const seedIgnored = { type: 'unsupported', feature: 'seed' } as const;
    const slowRegion = { type: 'other', message: 'Slow region' } as const;
    const doGenerate = [
      { ...generatedText('{"verdict":42}'), warnings: [seedIgnored] },
      { ...generatedText('{"verdict":"approve"}'), warnings: [seedIgnored, slowRegion] },
    ];

    const result = await mockGeneration(() => new MockLanguageModelV4({ doGenerate })).succeeded(
      jsonRequest('mock/model'),
    );

    expect(result.warnings).toEqual([
      { type: 'unsupported', feature: 'seed', detail: null },
      { type: 'other', feature: null, detail: 'Slow region' },
    ]);
  });
});
