import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { JsonOutput } from '../model/model-request.ts';
import {
  answersInTurn,
  enforcingGateway,
  gatewayModel,
  refusedByTheGateway,
  respondedInTurn,
} from '../provider-testing/answers-in-turn.ts';
import { chatCompletion, openAiResponse } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { scoresSchema } from '../schema-testing/answer-schemas.ts';
import { treeSchema } from '../schema-testing/revision-schemas.ts';
import { compileAnswerSchema } from '../schema/answer-schema.ts';
import { accessFor, failed, succeeded, textRequest } from '../testing/adapter-harness.ts';

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
