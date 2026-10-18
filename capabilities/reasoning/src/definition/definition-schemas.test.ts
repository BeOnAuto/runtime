import { shapeNamed } from '@on.auto/definitions/testing';
import { describe, expect, it } from 'vitest';

import { documentOf, issuesIn, parsed } from '../testing/definition-documents.ts';

const inputSchema = [
  'input:',
  '  schema:',
  '    type: object',
  '    properties:',
  '      account: {type: string}',
  '      limit: {type: integer, minimum: 1}',
  '      owner:',
  '        type: object',
  '        properties: {name: {type: string}}',
  '        required: [name]',
  '    required: [account, owner]',
  '    additionalProperties: false',
].join('\n');

function withInput(defaults: string): string {
  return documentOf(`model: openai/gpt-5\n${inputSchema}\n  default: ${defaults}`, 'Account {{ input.account }}');
}

describe('the input schema', () => {
  it('describes an object', () => {
    expect(
      issuesIn(documentOf('model: openai/gpt-5\ninput:\n  schema: {type: array, items: {type: string}}', 'List')),
    ).toEqual(['Line 4, /input/schema: The input schema describes an object: its root has "type": "object"']);
    expect(issuesIn(documentOf('model: openai/gpt-5\ninput:\n  schema: {type: string, pattern: "x"}', 'Text'))).toEqual(
      [
        'Line 4, /input/schema: The input schema describes an object: its root has "type": "object"',
        'Line 4, /input/schema/pattern: Regular expressions are not accepted, because a hostile pattern can stall validation',
      ],
    );
  });

  it('is a schema the input can be validated against', () => {
    expect(
      issuesIn(
        documentOf(
          'model: openai/gpt-5\ninput:\n  schema:\n    type: object\n    properties:\n      code: {type: string, pattern: "^[A-Z]+$"}',
          'Code',
        ),
      ),
    ).toEqual([
      'Line 7, /input/schema/properties/code/pattern: Regular expressions are not accepted, because a hostile pattern can stall validation',
    ]);
  });

  it('is rejected, and never read, when its definitions loop', () => {
    const looping = '{type: object, properties: {x: {$ref: "#/$defs/a"}}, $defs: {a: {$ref: "#/$defs/a"}}}';
    const loop =
      'This definition leads into a loop of $ref, allOf, anyOf or oneOf with no property or item in between, so no value can be checked against it';

    expect(issuesIn(documentOf(`model: openai/gpt-5\ninput:\n  schema: ${looping}`, 'Hi'))).toEqual([
      `Line 4, /input/schema/$defs/a: ${loop}`,
    ]);
    expect(issuesIn(documentOf(`model: openai/gpt-5\noutput:\n  format: json\n  schema: ${looping}`, 'Hi'))).toEqual([
      `Line 5, /output/schema/$defs/a: ${loop}`,
    ]);
  });

  it('is kept with the defaults when it is valid', () => {
    const { input } = parsed(withInput('{limit: 10}'));

    expect(input.defaults).toEqual({ limit: 10 });
    expect(input.schema?.document).toMatchObject({ required: ['account', 'owner'] });
  });
});

describe('the defaults of the input', () => {
  it('need not hold the required fields', () => {
    expect(issuesIn(withInput('{}'))).toEqual([]);
  });

  it('must match the types of the fields they name', () => {
    expect(issuesIn(withInput('{limit: 0, account: 7}'))).toEqual([
      'Line 15, /input/default/account: Expected string',
      'Line 15, /input/default/limit: Expected a value greater than or equal to 1',
    ]);
  });

  it('must hold whole objects for the fields they name', () => {
    expect(issuesIn(withInput('{owner: {}}'))).toEqual(['Line 15, /input/default/owner/name: Missing key']);
  });

  it('name only fields the schema allows', () => {
    expect(issuesIn(withInput('{region: eu}'))).toEqual([
      'Line 15, /input/default/region: Expected no excess property',
    ]);
  });

  it('are any object when there is no schema', () => {
    expect(parsed(documentOf('model: openai/gpt-5\ninput:\n  default: {tone: warm}')).input).toEqual({
      defaults: { tone: 'warm' },
    });
  });
});

describe('the output', () => {
  it('is text by default, and takes no schema then', () => {
    expect(parsed(documentOf('model: openai/gpt-5\noutput: {format: text}')).output).toEqual({ type: 'text' });
    expect(issuesIn(documentOf('model: openai/gpt-5\noutput:\n  schema: {type: object}'))).toEqual([
      'Line 4, /output/schema: A text output takes no schema; set format: json to ask for JSON that matches it',
    ]);
  });

  it('as JSON needs a schema that can be validated', () => {
    expect(issuesIn(documentOf('model: openai/gpt-5\noutput:\n  format: json'))).toEqual([
      'Line 4, /output: A json output needs a schema of the answer',
    ]);
    expect(
      issuesIn(
        documentOf('model: openai/gpt-5\noutput:\n  format: json\n  schema: {type: object, not: {type: string}}'),
      ),
    ).toEqual(['Line 5, /output/schema/not: Only "not": {} (no value matches) can be validated here']);
  });
});

describe('an output of a shape', () => {
  it('is JSON of the shape it names, with or without format: json, asked for and checked with its schema', () => {
    const shape = shapeNamed('categories');
    const outputs = ['output: {shape: categories}', 'output: {format: json, shape: categories}'].map(
      (output) => parsed(documentOf(`model: openai/gpt-5\n${output}`)).output,
    );

    expect(outputs).toMatchObject([
      { type: 'json', schema: { document: shape.schema }, shape },
      { type: 'json', schema: { document: shape.schema }, shape },
    ]);
  });

  it('is refused beside a schema of its own, with a text format, or for a name no shape has', () => {
    expect(
      [
        'output:\n  shape: series\n  schema: {type: object}',
        'output:\n  format: text\n  shape: series',
        'output:\n  shape: chart',
      ].map((output) => issuesIn(documentOf(`model: openai/gpt-5\n${output}`))),
    ).toEqual([
      ["Line 5, /output/schema: An output that names a shape takes no schema: the shape's schema is its schema"],
      [
        'Line 4, /output/format: An output that names a shape is JSON of that shape: leave format out, or set it to json',
      ],
      ['Line 4, /output/shape: Expected the name of a shape: series, categories, table, or text'],
    ]);
  });

  it('carries the warnings of its schema, at the line that names it', () => {
    const { warnings } = parsed(documentOf('model: openai/gpt-5\noutput:\n  shape: text'));

    expect(warnings).toEqual([
      'Line 4, /output/shape/properties/text/maxLength: maxLength is not enforced while Anthropic models write the answer; an answer outside it fails as output_invalid (anthropic, bedrock, bedrock-anthropic, vertex-anthropic)',
    ]);
  });
});

describe('the warnings of a definition', () => {
  it('say where a JSON output schema is not portable across providers, and nothing of a format the runtime checks', () => {
    const definition = parsed(
      documentOf(
        [
          'model: openai/gpt-5',
          'output:',
          '  format: json',
          '  schema:',
          '    type: object',
          '    properties:',
          '      total: {type: number, minimum: 0}',
          '      day: {type: string, format: date}',
          '    required: [total, day]',
          '    additionalProperties: false',
        ].join('\n'),
      ),
    );

    expect(definition.warnings).toEqual([
      'Line 8, /output/schema/properties/total/minimum: minimum is not enforced while Anthropic models write the answer; an answer outside it fails as output_invalid (anthropic, bedrock, bedrock-anthropic, vertex-anthropic)',
    ]);
  });

  it('are at most 100', () => {
    const properties = Array.from({ length: 120 }, (_, index) => `      p${index}: {type: integer, minimum: 0}`);
    const names = Array.from({ length: 120 }, (_, index) => `p${index}`).join(', ');
    const definition = parsed(
      documentOf(
        [
          'model: openai/gpt-5',
          'output:',
          '  format: json',
          '  schema:',
          '    type: object',
          '    properties:',
          ...properties,
          `    required: [${names}]`,
          '    additionalProperties: false',
        ].join('\n'),
      ),
    );

    expect(definition.warnings).toHaveLength(100);
  });
});
