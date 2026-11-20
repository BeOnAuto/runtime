import { InvalidInput } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import {
  DefinitionNameField,
  OverviewField,
  SourceField,
  definitionNameFieldOf,
  diagramFieldOf,
} from '../operations/definition-fields.ts';
import { definitionWordsFor, pageWords, whatItDoes } from '../plain-language/definition-words.ts';
import type { Definition } from '../registry/definition.ts';
import type { NamedDefinition } from '../used-by/called-definitions.ts';
import {
  bothGiven,
  diagramWhenGiven,
  neitherGiven,
  newNameDescription,
  renameAttempt,
  renameOutcome,
  textsOfAVersion,
  theNameItHas,
  updatedDefinitionsDescription,
  updatedNameDescription,
  updatedTypeDescription,
} from './rename-words.ts';

export function updateInputOf<Type extends Schema.Top>(type: Type) {
  return Schema.Struct({
    type,
    name: DefinitionNameField,
    source: Schema.optionalKey(SourceField),
    new_name: Schema.optionalKey(definitionNameFieldOf(newNameDescription)),
    overview: Schema.optionalKey(OverviewField),
    diagram: Schema.optionalKey(diagramFieldOf(diagramWhenGiven)),
  });
}

const DefinitionSavedAgainSchema = Schema.Struct({
  type: Schema.String.annotate({ description: updatedTypeDescription }),
  name: Schema.String.annotate({ description: updatedNameDescription }),
});

export const UpdatedDefinitionsField = Schema.optionalKey(
  Schema.Array(DefinitionSavedAgainSchema).annotate({ description: updatedDefinitionsDescription }),
);

interface UpdatedDefinitions {
  readonly updated_definitions?: readonly NamedDefinition[];
}

export function withUpdatedDefinitions<Answer extends object>(answer: Answer, savedAgain: readonly NamedDefinition[]) {
  return savedAgain.length === 0 ? answer : { ...answer, updated_definitions: savedAgain };
}

interface UpdateAsked {
  readonly name: string;
  readonly source?: string;
  readonly new_name?: string;
  readonly overview?: string;
  readonly diagram?: string;
}

type ChangeAsked = { readonly source: string } | { readonly rename: string };

function refusedAt(pointer: string, detail: string): InvalidInput {
  return new InvalidInput({ detail, issues: [{ pointer, detail }] });
}

function renameRefusal({ name, new_name: to, overview, diagram }: UpdateAsked & { readonly new_name: string }) {
  if (to === name) {
    return refusedAt('/new_name', theNameItHas);
  }
  if (overview !== undefined) {
    return refusedAt('/overview', textsOfAVersion);
  }
  return diagram === undefined ? undefined : refusedAt('/diagram', textsOfAVersion);
}

export function changeAsked(asked: UpdateAsked): Effect.Effect<ChangeAsked, InvalidInput> {
  const { source, new_name: to } = asked;
  if (source !== undefined) {
    return to === undefined ? Effect.succeed({ source }) : Effect.fail(refusedAt('/new_name', bothGiven));
  }
  if (to === undefined) {
    return Effect.fail(refusedAt('', neitherGiven));
  }
  const refused = renameRefusal({ ...asked, new_name: to });
  return refused === undefined ? Effect.succeed({ rename: to }) : Effect.fail(refused);
}

export function updatePlainLanguage(capabilities: readonly Capability[]) {
  const words = definitionWordsFor(capabilities);
  return {
    task: `update or rename a ${words.kinds}`,
    attempt: ({ type, name, new_name: to }: UpdateAsked & { readonly type: string }) =>
      to === undefined ? `update ${words.named(type, name)}` : renameAttempt(words, { type, name }, to),
    outcome: (definition: Definition & UpdatedDefinitions, { name, new_name: to }: UpdateAsked) =>
      to === undefined
        ? `Updated ${words.named(definition.type, definition.name)}.${whatItDoes(definition)} The change applies from its next run.${pageWords(definition)}`
        : renameOutcome(
            words,
            { type: definition.type, name: definition.name, from: name },
            definition.updated_definitions ?? [],
          ),
  };
}
