import { defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { definitionWordsFor } from '../plain-language/definition-words.ts';
import { DefinitionSchema } from '../registry/definition.ts';
import { DefinitionNameField } from './definition-fields.ts';
import { answeredDefinition } from './definition-reading.ts';
import { recordInRegistry } from './registry-access.ts';

export function defineRetireDefinition(capabilities: readonly Capability[]) {
  const known = knownCapabilities(capabilities);
  const words = definitionWordsFor(capabilities);
  return known.publish(
    defineCommand('playbook', {
      name: 'retire_definition',
      title: 'Retire definition',
      description: [
        'Retires a function or workflow, with its page, and returns it: it can still be read and listed, but it neither runs nor changes, and no other definition takes its name.',
        'restore_definition brings it back, paused. Use retire_definition when the person asks to retire that definition; update_definition changes one.',
        '`type` and `name` say which definition, and retiring one already retired changes nothing.',
      ].join(' '),
      repeatable: true,
      route: { method: 'POST', path: '/definitions/{type}/{name}/retire' },
      inputSchema: Schema.Struct({ type: known.field, name: DefinitionNameField }),
      outputSchema: DefinitionSchema,
      reasons: ['not_found', 'conflict'],
      handle: Effect.fnUntraced(function* ({ type, name }) {
        const capability = yield* known.capabilityOfType(type);
        const retired = yield* recordInRegistry(capability, { type: 'retire', name });
        return yield* answeredDefinition(capability, known.types, retired);
      }),
      plainLanguage: {
        task: `retire a ${words.kinds}`,
        attempt: ({ type, name }) => `retire ${words.named(type, name)}`,
        outcome: ({ type, name }) =>
          `Retired ${words.named(type, name)}. It neither runs nor changes until it is restored, and no other definition takes its name.`,
      },
    }),
  );
}
