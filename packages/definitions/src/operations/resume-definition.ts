import { defineCommand, PlaybookReader } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { definitionWordsFor, resumedInWords } from '../plain-language/definition-words.ts';
import { anotherReadRefused } from '../read-model-reads/listened-connections.ts';
import { definitionSchemaOf } from '../registry/definition.ts';
import { DefinitionNameField } from './definition-fields.ts';
import { answeredWithItsStanding } from './definition-reading.ts';
import { loadDefinition, recordInRegistry } from './registry-access.ts';

const description = [
  'Resumes a paused function or workflow and returns it, so that it can be run again.',
  'Its triggers start runs from the first time or event after it is resumed, and nothing they met while it was paused is run.',
  '`type` and `name` say which definition; resuming one that is not paused changes nothing.',
].join(' ');

const anotherReadRefusedOnResume = Effect.fnUntraced(function* (type: string, name: string) {
  const held = yield* loadDefinition(type, name);
  if (held?.status === 'paused') {
    yield* anotherReadRefused(yield* PlaybookReader, [held]);
  }
});

export function defineResumeDefinition(capabilities: readonly Capability[], goals = false) {
  const known = knownCapabilities(capabilities);
  const words = definitionWordsFor(capabilities);
  return known.publish(
    defineCommand('playbook', {
      name: 'resume_definition',
      title: 'Resume definition',
      description,
      repeatable: true,
      route: { method: 'POST', path: '/definitions/{type}/{name}/resume' },
      inputSchema: Schema.Struct({ type: known.field, name: DefinitionNameField }),
      outputSchema: definitionSchemaOf(goals),
      reasons: ['not_found', 'conflict', 'unavailable'],
      handle: Effect.fnUntraced(function* ({ type, name }) {
        const capability = yield* known.capabilityOfType(type);
        yield* anotherReadRefusedOnResume(type, name);
        const resumed = yield* recordInRegistry(capability, { type: 'resume', name, blanksRefused: goals });
        return yield* answeredWithItsStanding(capability, known.types, resumed, { change: 'resumed', goals });
      }),
      plainLanguage: {
        task: `resume a ${words.kinds}`,
        attempt: ({ type, name }) => `resume ${words.named(type, name)}`,
        outcome: (definition) => resumedInWords(words, definition),
      },
    }),
  );
}
