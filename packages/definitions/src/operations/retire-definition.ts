import { defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { definitionWordsFor } from '../plain-language/definition-words.ts';
import { DefinitionSchema } from '../registry/definition.ts';
import { DefinitionNameField } from './definition-fields.ts';
import { definitionOf } from './definition-views.ts';
import { recordInRegistry } from './registry-access.ts';

export function defineRetireDefinition(capabilities: readonly Capability[]) {
  const known = knownCapabilities(capabilities);
  const words = definitionWordsFor(capabilities);
  return known.publish(
    defineCommand('playbook', {
      name: 'retire_definition',
      title: 'Retire definition',
      description: [
        'Retires a function or workflow definition for good and returns it: it can still be read and listed, but it can no longer run or change, its name is not used again in the playbook, and there is no way to restore it.',
        'Use it only when the person asks to retire that definition; update_definition changes it instead.',
        '`type` and `name` say which definition, and retiring one already retired changes nothing.',
      ].join(' '),
      irreversible: true,
      repeatable: true,
      route: { method: 'POST', path: '/definitions/{type}/{name}/retire' },
      inputSchema: Schema.Struct({ type: known.field, name: DefinitionNameField }),
      outputSchema: DefinitionSchema,
      reasons: ['not_found', 'conflict'],
      handle: Effect.fnUntraced(function* ({ type, name }) {
        const capability = yield* known.capabilityOfType(type);
        return definitionOf(capability, yield* recordInRegistry(capability, { type: 'retire', name }));
      }),
      plainLanguage: {
        task: `retire a ${words.kinds}`,
        attempt: ({ type, name }) => `retire ${words.named(type, name)}`,
        outcome: ({ type, name }) =>
          `Retired ${words.named(type, name)}. It can no longer be run or changed, and its name cannot be used again in this playbook.`,
      },
    }),
  );
}
