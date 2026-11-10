import { Caller, defineCommand, recordedCallerOf } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { definitionWordsFor } from '../plain-language/definition-words.ts';
import { DefinitionSchema } from '../registry/definition.ts';
import { DefinitionNameField } from './definition-fields.ts';
import { answeredDefinition } from './definition-reading.ts';
import { recordInRegistry } from './registry-access.ts';

const description = [
  'Restores a retired function or workflow, with its page, and returns it: it comes back paused, under its own name and with its history, and starts no runs until resume_definition resumes it.',
  'A playbook restores a definition within the bounds it creates one under.',
  '`type` and `name` say which definition; restoring one that is not retired changes nothing.',
].join(' ');

export function defineRestoreDefinition(capabilities: readonly Capability[]) {
  const known = knownCapabilities(capabilities);
  const words = definitionWordsFor(capabilities);
  return known.publish(
    defineCommand('playbook', {
      name: 'restore_definition',
      title: 'Restore definition',
      description,
      repeatable: true,
      route: { method: 'POST', path: '/definitions/{type}/{name}/restore' },
      inputSchema: Schema.Struct({ type: known.field, name: DefinitionNameField }),
      outputSchema: DefinitionSchema,
      reasons: ['not_found', 'conflict', 'unavailable'],
      handle: Effect.fnUntraced(function* ({ type, name }) {
        const capability = yield* known.capabilityOfType(type);
        const restoredBy = recordedCallerOf(yield* Caller);
        const restored = yield* recordInRegistry(capability, { type: 'restore', name, restored_by: restoredBy });
        return yield* answeredDefinition(capability, known.types, restored, { change: 'restored' });
      }),
      plainLanguage: {
        task: `restore a ${words.kinds}`,
        attempt: ({ type, name }) => `restore ${words.named(type, name)}`,
        outcome: ({ type, name }) =>
          `Restored ${words.named(type, name)}. It is paused: resume it when it is ready to run.`,
      },
    }),
  );
}
