import { Caller, defineCommand, recordedCallerOf } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { definitionWordsFor, whatItDoes } from '../plain-language/definition-words.ts';
import { DefinitionNameField, DiagramField, OverviewField, SourceField } from './definition-fields.ts';
import { answeredDefinition } from './definition-reading.ts';
import { contentOf, createdWithItsSubject } from './saved-content.ts';
import { SavedDefinitionSchema, withDefinitionPageInStudio } from './studio-pages.ts';

export function defineCreateDefinition(capabilities: readonly Capability[]) {
  const known = knownCapabilities(capabilities);
  const words = definitionWordsFor(capabilities);
  return known.publish(
    defineCommand('playbook', {
      name: 'create_definition',
      title: 'Create definition',
      description: [
        'Saves a new function, workflow or page from its document, without running it.',
        'Use it once the person agrees; update_definition changes one saved, and a name is never reused.',
        `\`type\` is ${known.typesInWords}, and \`name\` how workflows and tools refer to it.`,
        "`source` is the whole document in its type's format, which get_guide gives, and `overview` Markdown for the person who runs the business.",
        'A function needs `diagram` too, Mermaid source of how it works or the word none; a workflow takes no `diagram`, a page neither.',
        'A document that does not fit its format is refused with the line and what is wrong.',
      ].join(' '),
      route: { method: 'POST', path: '/definitions/{type}' },
      reachesOutside: known.reachesOutside,
      successStatus: 201,
      inputSchema: Schema.Struct({
        type: known.field,
        name: DefinitionNameField,
        source: SourceField,
        overview: Schema.optionalKey(OverviewField),
        diagram: Schema.optionalKey(DiagramField),
      }),
      outputSchema: SavedDefinitionSchema,
      reasons: ['not_found', 'invalid_input', 'conflict', 'unavailable'],
      handle: Effect.fnUntraced(function* ({ type, name, ...written }) {
        const capability = yield* known.capabilityOfType(type);
        const saving = { types: known.types };
        const content = yield* contentOf(capability, written, saving);
        const created = yield* createdWithItsSubject(
          capability,
          { type: 'create', name, content, created_by: recordedCallerOf(yield* Caller) },
          saving,
        );
        return yield* withDefinitionPageInStudio(
          yield* answeredDefinition(capability, known.usingTypes, created),
          'created',
        );
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
