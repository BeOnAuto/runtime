import { memoriesShape, publishedOutputOf, type DefinitionSummary } from '@on.auto/definitions';
import { issueText } from '@on.auto/definitions/document';
import { InvalidInput } from '@on.auto/operations';
import { Effect, Result, type Schema } from 'effect';

import { parseMemoryDocument } from '../document/document-parsing.ts';
import type { MemoryFunctionDefinitionDocument } from '../document/memory-document.ts';

const rememberedOutputSchema: Schema.JsonObject = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'The id of the memory, the same for every version of it' },
    version: { type: 'integer', minimum: 1, description: 'The version of the memory this run kept' },
    scope: {
      type: 'string',
      enum: ['playbook', 'organization'],
      description: 'Who keeps the memory: the playbook, or its organization',
    },
  },
  required: ['id', 'version', 'scope'],
  additionalProperties: false,
};

export function parse(
  source: string,
  organizationKept: boolean,
): Effect.Effect<MemoryFunctionDefinitionDocument, InvalidInput> {
  return Result.match(parseMemoryDocument(source, organizationKept), {
    onSuccess: (document) => Effect.succeed(document),
    onFailure: (issues) =>
      Effect.fail(
        new InvalidInput({
          detail: `The memory function definition has ${issues.length === 1 ? 'a problem' : `${issues.length} problems`}`,
          issues: issues.map((issue) => ({ pointer: '', detail: issueText(issue) })),
        }),
      ),
  });
}

function outputOf({ block }: MemoryFunctionDefinitionDocument): Pick<DefinitionSummary, 'outputSchema' | 'details'> {
  return block.kind === 'recall'
    ? publishedOutputOf({ shape: memoriesShape, details: { recalls: block.recall.scope } })
    : publishedOutputOf({ schema: rememberedOutputSchema, details: { remembers: block.remember.scope } });
}

export function summarize(document: MemoryFunctionDefinitionDocument): DefinitionSummary {
  const { description, input } = document;
  return {
    ...(description === undefined ? {} : { description }),
    ...(input.schema === undefined ? {} : { inputSchema: input.schema.document }),
    ...outputOf(document),
  };
}
