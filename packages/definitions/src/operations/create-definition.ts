import { Caller, defineCommand, randomUUIDv7, recordedCallerOf, withNotices } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import { definitionWordsFor, pageWords, whatItDoes } from '../plain-language/definition-words.ts';
import { DefinitionNameField, DiagramField, OverviewField, SourceField } from './definition-fields.ts';
import { answeredDefinition } from './definition-reading.ts';
import { createdFrom, noGoalsKept } from './saved-content.ts';
import { savedDefinitionSchemaOf, withDefinitionPageInStudio } from './studio-pages.ts';

const savesWithoutRunning = 'Saves a new function or workflow from its document, without running it.';

const savesWithItsContribution =
  'Saves a new function or workflow from its document, without running it; a workflow needs a `contributes` list, as the goals guide says.';

const diagramAndPage = [
  'A function needs `diagram`; a workflow takes none.',
  "The document's `page` shows the person its runs; write it as its type's guide shows.",
];

const diagramAndPageInOne =
  "A function needs `diagram`, a workflow none; the `page` shows the person its runs, as its type's guide shows.";

function descriptionOf(contributing: boolean): string {
  return [
    contributing ? savesWithItsContribution : savesWithoutRunning,
    'update_definition changes one saved, and a name is never reused.',
    'A workflow, designed before its functions, owns one job the business does again and again; a check, a test or a setup is not one.',
    'Each step that does work calls a function of the `type` that work needs, by its `name`.',
    "`source` is the whole document in its type's format, which get_guide gives, and `overview`, optional, Markdown for the person who runs the business.",
    ...(contributing ? [diagramAndPageInOne] : diagramAndPage),
    'A document that does not fit its format is refused with the line and what is wrong.',
  ].join(' ');
}

export function defineCreateDefinition(capabilities: readonly Capability[], pages: SubjectPages, kept = noGoalsKept) {
  const { goals, messages } = kept;
  const known = knownCapabilities(capabilities);
  const words = definitionWordsFor(capabilities);
  return known.publish(
    defineCommand('playbook', {
      name: 'create_definition',
      title: 'Create definition',
      description: descriptionOf(goals && known.types.includes('workflow')),
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
      outputSchema: savedDefinitionSchemaOf(goals),
      reasons: ['not_found', 'invalid_input', 'conflict', 'unavailable'],
      handle: Effect.fnUntraced(function* ({ type, ...written }) {
        const capability = yield* known.capabilityOfType(type);
        const createdBy = recordedCallerOf(yield* Caller);
        const definitionId = yield* Effect.sync(randomUUIDv7);
        const created = yield* createdFrom({ capability, pages, written, goals, messages }, known.types, (content) => ({
          type: 'create',
          name: written.name,
          content,
          created_by: createdBy,
          blanksRefused: goals,
          definition_id: definitionId,
        }));
        const answered = { change: 'created', inHand: created.inHand, goals } as const;
        const linked = yield* withDefinitionPageInStudio(
          yield* answeredDefinition(capability, known.types, created, answered),
          'created',
        );
        return withNotices(linked, created.notices);
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
