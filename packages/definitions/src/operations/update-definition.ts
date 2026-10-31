import { defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { definitionWordsFor, whatItDoes } from '../plain-language/definition-words.ts';
import { DefinitionSchema } from '../registry/definition.ts';
import { DefinitionNameField, DiagramField, OverviewField, SourceField } from './definition-fields.ts';
import { answeredDefinition } from './definition-reading.ts';
import { contentOf } from './definition-views.ts';
import { recordInRegistry } from './registry-access.ts';

export function defineUpdateDefinition(capabilities: readonly Capability[]) {
  const known = knownCapabilities(capabilities);
  const words = definitionWordsFor(capabilities);
  return known.publish(
    defineCommand('playbook', {
      name: 'update_definition',
      title: 'Update definition',
      description: [
        'Replaces the document of an active function or workflow and returns its new version, which every run uses from then on.',
        'Use it when the person changes a saved definition; a retired one cannot change.',
        '`type` and `name` say which, `source` is the whole new document, and `overview` Markdown for the person who runs the business, written again each time; left out, the saved one stays.',
        'A function needs `diagram` each time, Mermaid source of how it works or the word none, and a workflow takes no `diagram`.',
        'A document that does not fit its format is refused with the line and what is wrong; one the same as saved, with the same diagram and its overview the same or left out, records nothing.',
        "A new version of a recall function builds its view again from the playbook's history.",
      ].join(' '),
      repeatable: true,
      route: { method: 'PUT', path: '/definitions/{type}/{name}' },
      reachesOutside: known.reachesOutside,
      inputSchema: Schema.Struct({
        type: known.field,
        name: DefinitionNameField,
        source: SourceField,
        overview: Schema.optionalKey(OverviewField),
        diagram: Schema.optionalKey(DiagramField),
      }),
      outputSchema: DefinitionSchema,
      reasons: ['not_found', 'invalid_input', 'conflict', 'unavailable'],
      handle: Effect.fnUntraced(function* ({ type, name, ...written }) {
        const capability = yield* known.capabilityOfType(type);
        const content = yield* contentOf(capability, written);
        return yield* answeredDefinition(
          capability,
          known.types,
          yield* recordInRegistry(capability, { type: 'update', name, content }),
        );
      }),
      plainLanguage: {
        task: `update a ${words.kinds}`,
        attempt: ({ type, name }) => `update ${words.named(type, name)}`,
        outcome: (definition) =>
          `Updated ${words.named(definition.type, definition.name)}.${whatItDoes(definition)} The change applies from its next run.`,
      },
    }),
  );
}
