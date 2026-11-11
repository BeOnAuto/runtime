import { Caller, defineCommand, recordedCallerOf } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import { definitionWordsFor, pageWords, whatItDoes } from '../plain-language/definition-words.ts';
import { DefinitionNameField, DiagramField, OverviewField, SourceField } from './definition-fields.ts';
import { answeredDefinition } from './definition-reading.ts';
import { savedFrom } from './saved-content.ts';
import { SavedDefinitionSchema, withDefinitionPageInStudio } from './studio-pages.ts';

const description = [
  'Saves a new function or workflow from its document, without running it.',
  'update_definition changes one saved, and a name is never reused.',
  'Each part of a job is its own function, of the `type` its work needs, and `name` is how workflows and tools refer to it.',
  'A workflow owns one job the business does again and again, and a check, a test or a setup is not one.',
  "`source` is the whole document in its type's format, which get_guide gives, and `overview` Markdown for the person who runs the business.",
  'A function needs `diagram` too; a workflow takes none.',
  "The document's `page` key shows the person its runs; write it as the page guide says.",
  'A document that does not fit its format is refused with the line and what is wrong.',
].join(' ');

export function defineCreateDefinition(capabilities: readonly Capability[], pages: SubjectPages) {
  const known = knownCapabilities(capabilities);
  const words = definitionWordsFor(capabilities);
  return known.publish(
    defineCommand('playbook', {
      name: 'create_definition',
      title: 'Create definition',
      description,
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
        const createdBy = recordedCallerOf(yield* Caller);
        const created = yield* savedFrom({ capability, pages, written }, (content) => ({
          type: 'create',
          name,
          content,
          created_by: createdBy,
        }));
        return yield* withDefinitionPageInStudio(
          yield* answeredDefinition(capability, known.types, created, { change: 'created', inHand: created.inHand }),
          'created',
        );
      }),
      plainLanguage: {
        task: `create a new ${words.kinds}`,
        attempt: ({ type, name }) => `create ${words.named(type, name)}`,
        outcome: (definition) =>
          `Created ${words.named(definition.type, definition.name)}.${whatItDoes(definition)} It has been saved but has not been run yet.${pageWords(definition)}`,
      },
    }),
    known.byEachPartsJob,
  );
}
