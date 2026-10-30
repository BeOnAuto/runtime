import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { inputSchemaWarnings } from './input-schema-warnings.ts';

const searchTool = 'graph__search';

const boundedQuery: Schema.JsonObject = {
  type: 'object',
  properties: { query: { type: 'string', maxLength: 80 } },
  required: ['query'],
};

function warningsFor(provider: string, inputSchema: Schema.JsonObject) {
  return inputSchemaWarnings([{ name: searchTool, description: 'Finds rows.', inputSchema }], provider);
}

describe('the warnings of a run whose tools have an input schema', () => {
  it("say where the provider of the run may not hold a tool's arguments to its input schema, and nothing for another provider", () => {
    expect([warningsFor('anthropic', boundedQuery), warningsFor('openai', boundedQuery)]).toEqual([
      [
        {
          type: 'compatibility',
          feature: `${searchTool} inputSchema#/properties/query/maxLength`,
          detail:
            "maxLength is not enforced while Anthropic models write a tool's arguments; arguments outside it reach the tool, which may refuse them",
        },
      ],
      [],
    ]);
  });

  it('say where the provider of the run may refuse the input schema itself', () => {
    expect(warningsFor('openai', { type: 'array', items: { type: 'string' } })).toEqual([
      {
        type: 'compatibility',
        feature: `${searchTool} inputSchema#/type`,
        detail: 'The root of the schema should be "type": "object"',
      },
    ]);
  });

  it('say nothing of an open object with optional properties, since tools are not sent as strict structured outputs', () => {
    const openQuery = { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } } };

    expect([warningsFor('anthropic', openQuery), warningsFor('openai', openQuery)]).toEqual([[], []]);
  });

  it('say nothing of an input schema too large to check', () => {
    const tooLarge = {
      type: 'object',
      description: 'x'.repeat(70_000),
      properties: { query: { type: 'string', maxLength: 80 } },
      required: ['query'],
    };

    expect(warningsFor('anthropic', tooLarge)).toEqual([]);
  });
});
