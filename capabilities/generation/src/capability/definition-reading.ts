import {
  noStrippedForms,
  outputShapeOf,
  publishedOutputOf,
  type DefinitionSummary,
  type StrippedForms,
} from '@on.auto/definitions';
import { reportedIssues } from '@on.auto/definitions/document';
import type { InvalidInput, Notice, PlaybookAddress } from '@on.auto/operations';
import { Clock, Effect, Result } from 'effect';

import { dayOf } from '../catalog/catalog-entry.ts';
import type { GenerationCatalog } from '../catalog/generation-catalog.ts';
import { invalidDefinition } from '../document/definition-refusals.ts';
import { parseGenerationDocument } from '../document/document-parsing.ts';
import type { GenerationFunctionDefinitionDocument } from '../document/generation-document.ts';
import { modelChoiceOf, retirementNotices } from '../document/model-check.ts';

export function parse(source: string): Effect.Effect<GenerationFunctionDefinitionDocument, InvalidInput> {
  return Result.match(parseGenerationDocument(source), {
    onSuccess: (document) => Effect.succeed(document),
    onFailure: (issues) => Effect.fail(invalidDefinition(issues)),
  });
}

export function checkedAgainst(
  catalog: GenerationCatalog,
): (document: GenerationFunctionDefinitionDocument) => Effect.Effect<StrippedForms, InvalidInput> {
  return (document) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) => {
      const choice = modelChoiceOf(catalog, document, dayOf(now));
      return 'issues' in choice
        ? Effect.fail(invalidDefinition(reportedIssues(choice.issues)))
        : Effect.succeed(noStrippedForms);
    });
}

export function noticedAgainst(
  catalog: GenerationCatalog,
): (document: GenerationFunctionDefinitionDocument, place: PlaybookAddress) => Effect.Effect<readonly Notice[]> {
  return (document) => Effect.map(Clock.currentTimeMillis, (now) => retirementNotices(catalog, document, dayOf(now)));
}

export function summarize({ description, input }: GenerationFunctionDefinitionDocument): DefinitionSummary {
  return {
    ...(description === undefined ? {} : { description }),
    ...(input.schema === undefined ? {} : { inputSchema: input.schema.document }),
    ...publishedOutputOf({ shape: outputShapeOf('asset') }),
  };
}
