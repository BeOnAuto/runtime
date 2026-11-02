import {
  noStrippedForms,
  outputShapeOf,
  publishedOutputOf,
  type DefinitionSummary,
  type StrippedForms,
} from '@on.auto/definitions';
import { reportedIssues } from '@on.auto/definitions/document';
import type { InvalidInput } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import type { GenerationCatalog } from '../catalog/generation-catalog.ts';
import { invalidDefinition } from '../document/definition-refusals.ts';
import { parseGenerationDocument } from '../document/document-parsing.ts';
import type { GenerationFunctionDefinitionDocument } from '../document/generation-document.ts';
import { modelChoiceOf } from '../document/model-check.ts';

export function parse(source: string): Effect.Effect<GenerationFunctionDefinitionDocument, InvalidInput> {
  return Result.match(parseGenerationDocument(source), {
    onSuccess: (document) => Effect.succeed(document),
    onFailure: (issues) => Effect.fail(invalidDefinition(issues)),
  });
}

export function checkedAgainst(
  catalog: GenerationCatalog,
): (document: GenerationFunctionDefinitionDocument) => Effect.Effect<StrippedForms, InvalidInput> {
  return (document) => {
    const choice = modelChoiceOf(catalog, document);
    return 'issues' in choice
      ? Effect.fail(invalidDefinition(reportedIssues(choice.issues)))
      : Effect.succeed(noStrippedForms);
  };
}

export function summarize({ description, input }: GenerationFunctionDefinitionDocument): DefinitionSummary {
  return {
    ...(description === undefined ? {} : { description }),
    ...(input.schema === undefined ? {} : { inputSchema: input.schema.document }),
    ...publishedOutputOf({ shape: outputShapeOf('asset') }),
  };
}
