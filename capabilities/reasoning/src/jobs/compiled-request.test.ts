import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DefinitionInvalid } from '../failure/definition-invalid.ts';
import type { ModelRequest } from '../model/model-request.ts';
import { documentOf, parsed, reasoningExample } from '../testing/definition-documents.ts';
import { outputDocumentOf, requestCompiler, type CompiledRequest } from './compiled-request.ts';
import type { OutputDocument } from './jobs.ts';

const request = { model: 'anthropic/claude-sonnet-4-5', messages: [], settings: { max_output_tokens: 256 } };

function compiledOf(output: OutputDocument): Result.Result<ModelRequest, DefinitionInvalid> {
  return requestCompiler()({ ...request, output });
}

function validated(output: OutputDocument, value: unknown): boolean {
  return Result.match(compiledOf(output), {
    onFailure: () => false,
    onSuccess: ({ output: compiled }) => compiled.type === 'json' && Result.isSuccess(compiled.schema.validate(value)),
  });
}

const shaped = parsed(documentOf('model: anthropic/claude-sonnet-4-5\noutput:\n  shape: series', 'Chart it.')).output;

describe('the output of a model call job', () => {
  it('carries a text output as it is, and a JSON one as its schema document, its shape by name', () => {
    expect(outputDocumentOf({ type: 'text' })).toEqual({ type: 'text' });
    expect(outputDocumentOf(parsed(reasoningExample).output)).toEqual({
      type: 'json',
      schema: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
        additionalProperties: false,
      },
    });
    expect(outputDocumentOf(shaped)).toMatchObject({ type: 'json', shape: 'series' });
  });

  it('is compiled by the performer into the schema the definition validates with, the shape checking further', () => {
    const summary = outputDocumentOf(parsed(reasoningExample).output);
    const series = outputDocumentOf(shaped);

    expect([validated(summary, { summary: 'Rose.' }), validated(summary, { summary: 3 })]).toEqual([true, false]);
    expect(validated(series, { label: 'Revenue', points: [] })).toBe(false);
    expect(compiledOf({ type: 'text' })).toEqual(Result.succeed({ ...request, output: { type: 'text' } }));
  });

  it('is refused as an invalid definition when its schema cannot be compiled, naming where', () => {
    const refused = compiledOf({ type: 'json', schema: { type: 'object', properties: { n: { type: 'nothing' } } } });

    expect(refused).toMatchObject(
      Result.fail({
        _tag: 'definition_invalid',
        detail: 'The output schema of the model call is not one this package can validate',
        issues: [{ pointer: '/output/schema/properties/n/type' }],
      }),
    );
  });
});

function outputCompiledBy(compiledRequest: CompiledRequest, output: OutputDocument) {
  return Result.getOrUndefined(Result.map(compiledRequest({ ...request, output }), ({ output: made }) => made));
}

describe('the output of the model call jobs of one attempt', () => {
  it('is compiled once, every later model call taking the schema the first compiled', () => {
    const compiledRequest = requestCompiler();
    const output = outputDocumentOf(parsed(reasoningExample).output);

    const first = outputCompiledBy(compiledRequest, output);
    const later = outputCompiledBy(compiledRequest, output);

    expect(first).toMatchObject({ type: 'json' });
    expect(later).toBe(first);
  });
});
