import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'description: Summarizes a text',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  '{% system %}Be brief.{% endsystem %}Summarize: {{ input.text }}',
].join('\n');

let server: ReasoningServer;

beforeEach(async () => {
  server = await servingReasoning([]);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
});

afterEach(async () => {
  await server.stop();
});

function creating(name: string, source: string) {
  return server.call('POST', `${alpha}/definitions/reasoning`, { body: { name, source } });
}

describe('the reasoning function definitions of a playbook over HTTP', () => {
  it('creates a definition with 201, with what the capability says about it', async () => {
    expect(await creating('summary', summary)).toMatchObject({
      status: 201,
      body: {
        type: 'reasoning',
        name: 'summary',
        version: 1,
        status: 'active',
        media_type: 'text/markdown',
        description: 'Summarizes a text',
        input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        source: summary,
      },
    });
  });
});

describe('the life of a reasoning function definition over HTTP', () => {
  it('lists, reads, updates and retires a definition', async () => {
    await creating('summary', summary);
    const listed = await server.call('GET', `${alpha}/definitions/reasoning`);
    const read = await server.call('GET', `${alpha}/definitions/reasoning/summary`);
    const updated = await server.call('PUT', `${alpha}/definitions/reasoning/summary`, {
      body: { source: summary.replace('Be brief.', 'Be very brief.') },
    });
    const retired = await server.call('POST', `${alpha}/definitions/reasoning/summary/retire`);

    expect(listed).toMatchObject({
      status: 200,
      body: { definitions: [{ name: 'summary', description: 'Summarizes a text' }] },
    });
    expect(listed.body).not.toHaveProperty('definitions.0.source');
    expect(read).toMatchObject({ status: 200, body: { name: 'summary', version: 1, source: summary } });
    expect(updated).toMatchObject({ status: 200, body: { version: 2 } });
    expect(retired).toMatchObject({ status: 200, body: { status: 'retired' } });
  });

  it('shows the warnings of a JSON definition whose schema not every provider enforces', async () => {
    const source = [
      '---',
      'model: anthropic/claude-sonnet-4-5',
      'output:',
      '  format: json',
      '  schema: {type: object, properties: {score: {type: integer, maximum: 10}}, required: [score], additionalProperties: false}',
      '---',
      'Score {{ input.text }}',
    ].join('\n');

    expect(await creating('score', source)).toMatchObject({
      status: 201,
      body: {
        warnings: [
          'Line 5, /output/schema/properties/score/maximum: maximum is not enforced while Anthropic models write the answer; an answer outside it fails as output_invalid (anthropic, bedrock, bedrock-anthropic, vertex-anthropic)',
        ],
      },
    });
  });
});

const invalidDocuments: readonly (readonly [string, string, string])[] = [
  [
    'without front matter',
    'Summarize {{ input.text }}',
    'Line 1: A reasoning function definition starts with a line of three dashes (---) that opens its front matter of YAML',
  ],
  [
    'whose front matter is not closed',
    '---\nmodel: openai/gpt-5\nSummarize',
    'Line 1: The front matter that opens on line 1 is never closed by a line of three dashes (---)',
  ],
  [
    'whose YAML cannot be read',
    '---\nmodel: [openai\n---\nHi',
    'Line 2: Flow sequence in block collection must be sufficiently indented and end with a ]',
  ],
  [
    'with an unknown key',
    '---\nmodel: openai/gpt-5\nprompt: hi\n---\nHi',
    'Line 3, /prompt: prompt is not a key of the front matter; it takes description, about, model, config, input, output, provider_options, tools',
  ],
  [
    'with a model not written provider/model',
    '---\nmodel: gpt-5\n---\nHi',
    'Line 2, /model: Expected provider/model, for example anthropic/claude-sonnet-4-5',
  ],
  [
    'with settings out of range',
    '---\nmodel: openai/gpt-5\nconfig: {max_output_tokens: 100000}\n---\nHi',
    'Line 3, /config/max_output_tokens: Expected at most 64000',
  ],
  [
    'with an input schema that is not an object',
    '---\nmodel: openai/gpt-5\ninput:\n  schema: {type: string}\n---\nHi',
    'Line 4, /input/schema: The input schema describes an object: its root has "type": "object"',
  ],
  [
    'with a JSON output without a schema',
    '---\nmodel: openai/gpt-5\noutput: {format: json}\n---\nHi',
    'Line 3, /output: A json output needs a schema of the answer',
  ],
  [
    'with Liquid it cannot parse',
    '---\nmodel: openai/gpt-5\n---\n{% if input.vip %}Hi',
    'Line 4: tag {% if input.vip %} not closed',
  ],
  [
    'that loads another template',
    '---\nmodel: openai/gpt-5\n---\n{% include "header" %}',
    'Line 4: tag "include" not found',
  ],
  [
    'that reads a variable it may not',
    '---\nmodel: openai/gpt-5\n---\n{{ secrets }}',
    'Line 4: secrets is not a variable of a reasoning function’s prompt template, which reads input, today and now; assign it first',
  ],
];

describe('a reasoning function definition document that is not valid', () => {
  it.each(invalidDocuments)('is rejected with 422, %s, with the line under /source', async (_case, source, detail) => {
    expect(await creating('broken', source)).toMatchObject({
      status: 422,
      body: { reason: 'invalid_input', errors: [{ pointer: '/source', detail }] },
    });
    expect((await server.call('GET', `${alpha}/definitions/reasoning`)).body).toEqual({ definitions: [] });
  });
});
