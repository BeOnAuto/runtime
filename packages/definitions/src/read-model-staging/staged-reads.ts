import type { Conflict, NotFound, PlaybookContext, PlaybookReader, Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { readDefinition, type ReadDefinition } from '../operations/definition-reading.ts';
import { triggersSince } from '../operations/registry-access.ts';
import { listedOfTheRow } from '../read-model-reads/read-model-answers.ts';
import { definitionFromTheReadModel, type ReadFromTheReadModel } from '../read-model-reads/read-model-definitions.ts';
import { differingFieldsOf, sameAnswer } from './same-answers.ts';
import { comparisonOf, loggedComparison, matched, stagedRead } from './shadow-comparison.ts';

type Reading<A, E = never> = Effect.Effect<A, E, PlaybookReader | PlaybookContext>;

export interface DefinitionReadAt extends ReadDefinition {
  triggersSince(): Reading<string>;
  triggersSinceAnswered(since: string): Effect.Effect<void>;
}

function namedFields(prefix: string, fields: readonly string[]): readonly string[] {
  return fields.map((field) => `${prefix}.${field}`);
}

export function readsCompared(capability: Capability, today: DefinitionReadAt, candidate: ReadFromTheReadModel) {
  const remembered = listedOfTheRow(capability, candidate.row, candidate.savedBy).warnings;
  return Effect.succeed(
    comparisonOf([
      ...namedFields('stored', differingFieldsOf(today.stored, candidate.stored)),
      ...namedFields('definition', differingFieldsOf(today.definition, candidate.definition)),
      ...(sameAnswer(remembered, candidate.definition.warnings) ? [] : ['remembered_warnings']),
    ]),
  );
}

export function triggersSinceCompared(type: string, savedBy: string, since: string): Effect.Effect<void> {
  const comparison = since === savedBy ? matched : comparisonOf(['triggers_since']);
  return Effect.ignore(Effect.exit(loggedComparison({ read: 'triggers_since', definitionType: type }, comparison)));
}

export function readToday(capability: Capability, types: readonly string[], name: string) {
  return Effect.map(readDefinition(capability, types, name), (read): DefinitionReadAt => ({
    ...read,
    triggersSince: () => triggersSince(capability.type, read.stored),
    triggersSinceAnswered: () => Effect.void,
  }));
}

function readFromTheReadModel({ stored, definition, inHand, savedBy }: ReadFromTheReadModel): DefinitionReadAt {
  return {
    stored,
    definition,
    inHand,
    triggersSince: () => Effect.succeed(savedBy),
    triggersSinceAnswered: () => Effect.void,
  };
}

export function stagedDefinitionRead(
  capability: Capability,
  types: readonly string[],
  name: string,
): Reading<DefinitionReadAt, NotFound | Unavailable | Conflict> {
  return stagedRead({
    read: 'get_definition',
    reading: 'answers',
    definitionType: capability.type,
    involved: [capability.type, ...types],
    today: readToday(capability, types, name),
    fromTheReadModel: definitionFromTheReadModel(capability, types, name),
    answerOf: readFromTheReadModel,
    compared: (today, candidate) => readsCompared(capability, today, candidate),
    answerCompared: (today, { savedBy }) => ({
      ...today,
      triggersSinceAnswered: (since) => triggersSinceCompared(capability.type, savedBy, since),
    }),
  });
}
