import { defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { definitionWordsFor } from '../plain-language/definition-words.ts';
import { hasTriggers } from '../registry/definition-triggers.ts';
import { DefinitionSchema } from '../registry/definition.ts';
import { DefinitionNameField } from './definition-fields.ts';
import { answeredDefinition } from './definition-reading.ts';
import { recordInRegistry } from './registry-access.ts';

const description = [
  'Resumes a paused function or workflow and returns it, so that it can be run again.',
  'Its triggers start runs from the first time or event after it is resumed, and nothing they met while it was paused is run.',
  '`type` and `name` say which definition; resuming one that is not paused changes nothing.',
].join(' ');

const triggersAgain = ', and its triggers start runs again from now, not for what came while it was paused';

export function defineResumeDefinition(capabilities: readonly Capability[]) {
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
      outputSchema: DefinitionSchema,
      reasons: ['not_found', 'conflict'],
      handle: Effect.fnUntraced(function* ({ type, name }) {
        const capability = yield* known.capabilityOfType(type);
        const resumed = yield* recordInRegistry(capability, { type: 'resume', name });
        return yield* answeredDefinition(capability, known.types, resumed);
      }),
      plainLanguage: {
        task: `resume a ${words.kinds}`,
        attempt: ({ type, name }) => `resume ${words.named(type, name)}`,
        outcome: (definition) =>
          `Resumed ${words.named(definition.type, definition.name)}. It can be run again${hasTriggers(definition) ? triggersAgain : ''}.`,
      },
    }),
  );
}
