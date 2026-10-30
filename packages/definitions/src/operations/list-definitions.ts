import { defineQuery } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { definitionsListed, definitionWordsFor } from '../plain-language/definition-words.ts';
import { ListedDefinitionSchema } from '../registry/definition.ts';
import { IncludeRetiredField } from './definition-fields.ts';
import { byName, listedDefinitionOf } from './definition-views.ts';
import { loadRegistry } from './registry-access.ts';

export function defineListDefinitions(capabilities: readonly Capability[]) {
  const known = knownCapabilities(capabilities);
  const words = definitionWordsFor(capabilities);
  return known.publish(
    defineQuery('playbook', {
      name: 'list_definitions',
      title: 'List definitions',
      description: [
        'Lists the definitions of one type in the playbook, sorted by name, each with its version, its status and what its document says it does, without the document.',
        'Use it to find a function or workflow the person names, or to see which exist before one is made; get_definition reads one with its document.',
        '`type` is the type to list, and `include_retired` adds the retired definitions, which are left out otherwise.',
      ].join(' '),
      route: { method: 'GET', path: '/definitions/{type}' },
      inputSchema: Schema.Struct({
        type: known.field,
        include_retired: Schema.optionalKey(IncludeRetiredField),
      }),
      outputSchema: Schema.Struct({ definitions: Schema.Array(ListedDefinitionSchema) }),
      reasons: ['not_found'],
      handle: Effect.fnUntraced(function* ({ type, include_retired: includeRetired = false }) {
        const capability = yield* known.capabilityOfType(type);
        const registry = yield* loadRegistry(capability.type);
        const definitions = [...registry.values()].filter(({ status }) => includeRetired || status === 'active');
        return {
          definitions: definitions.toSorted(byName).map((definition) => listedDefinitionOf(capability, definition)),
        };
      }),
      plainLanguage: {
        task: `list the ${words.allKinds}`,
        attempt: ({ type }) => `list the ${words.nounOf(type).other}`,
        outcome: ({ definitions }, { type }) => definitionsListed(words.nounOf(type), definitions),
      },
    }),
  );
}
