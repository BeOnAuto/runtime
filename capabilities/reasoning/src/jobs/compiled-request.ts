import { outputShapeOf } from '@on.auto/definitions';
import { Result } from 'effect';

import { DefinitionInvalid } from '../failure/definition-invalid.ts';
import type { ModelRequest, OutputRequest } from '../model/model-request.ts';
import { compileAnswerSchema, shapedAnswerSchema } from '../schema/answer-schema.ts';
import type { ModelCallRequest, OutputDocument } from './jobs.ts';

export function outputDocumentOf(output: OutputRequest): OutputDocument {
  if (output.type === 'text') {
    return output;
  }
  const { schema, shape } = output;
  return { type: 'json', schema: schema.document, ...(shape === undefined ? {} : { shape: shape.name }) };
}

function compiledOutput(output: OutputDocument): Result.Result<OutputRequest, DefinitionInvalid> {
  if (output.type === 'text') {
    return Result.succeed(output);
  }
  const { schema, shape: shapeName } = output;
  if (shapeName !== undefined) {
    const shape = outputShapeOf(shapeName);
    return Result.succeed({ type: 'json', schema: shapedAnswerSchema(shape), shape });
  }
  return Result.match(compileAnswerSchema(schema), {
    onSuccess: (compiled) => Result.succeed({ type: 'json', schema: compiled }),
    onFailure: (issues) =>
      Result.fail(
        new DefinitionInvalid({
          detail: 'The output schema of the model call is not one this package can validate',
          provider: null,
          status: null,
          provider_message: null,
          issues: issues.map(({ pointer, detail }) => ({ pointer: `/output/schema${pointer}`, detail })),
        }),
      ),
  });
}

export type CompiledRequest = (request: ModelCallRequest) => Result.Result<ModelRequest, DefinitionInvalid>;

export function requestCompiler(): CompiledRequest {
  const compiled = new WeakMap<OutputDocument, Result.Result<OutputRequest, DefinitionInvalid>>();
  const outputOf = (output: OutputDocument): Result.Result<OutputRequest, DefinitionInvalid> => {
    const known = compiled.get(output);
    if (known !== undefined) {
      return known;
    }
    const made = compiledOutput(output);
    compiled.set(output, made);
    return made;
  };
  return ({ output, ...request }) => Result.map(outputOf(output), (made) => ({ ...request, output: made }));
}
