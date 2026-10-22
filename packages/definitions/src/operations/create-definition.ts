import { defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { definitionWordsFor, whatItDoes } from '../plain-language/definition-words.ts';
import { DefinitionSchema } from '../registry/definition.ts';
import { DefinitionNameField, OverviewField, SourceField } from './definition-fields.ts';
import { contentOf, definitionOf } from './definition-views.ts';
import { recordInRegistry } from './registry-access.ts';

export function defineCreateDefinition(capabilities: readonly Capability[]) {
  const known = knownCapabilities(capabilities);
  const words = definitionWordsFor(capabilities);
  return known.publish(
    defineCommand('playbook', {
      name: 'create_definition',
      title: 'Create definition',
      description: [
        'Saves a new function or workflow definition in the playbook from its document and returns it without running it.',
        'Use it once the person has agreed to the definition; update_definition changes one that exists, and a name is never reused in a playbook.',
        `\`type\` is the definition's type and \`name\` is how workflows and tools refer to it: ${known.typesWithNouns}.`,
        "`source` is the whole document in that type's format, which get_guide gives, and `overview` the Markdown written after it for the person who runs the business.",
        'A document that does not fit its format is refused with the line and what is wrong, and nothing is saved.',
      ].join(' '),
      route: { method: 'POST', path: '/definitions/{type}' },
      successStatus: 201,
      inputSchema: Schema.Struct({
        type: known.field,
        name: DefinitionNameField,
        source: SourceField,
        overview: Schema.optionalKey(OverviewField),
      }),
      outputSchema: DefinitionSchema,
      reasons: ['not_found', 'invalid_input', 'conflict', 'unavailable'],
      handle: Effect.fnUntraced(function* ({ type, name, ...written }) {
        const capability = yield* known.capabilityOfType(type);
        const content = yield* contentOf(capability, written);
        return definitionOf(capability, yield* recordInRegistry(capability, { type: 'create', name, content }));
      }),
      plainLanguage: {
        task: `create a new ${words.kinds}`,
        attempt: ({ type, name }) => `create ${words.named(type, name)}`,
        outcome: (definition) =>
          `Created ${words.named(definition.type, definition.name)}.${whatItDoes(definition)} It has been saved but has not been run yet.`,
      },
    }),
  );
}
