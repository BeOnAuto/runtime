import { defineCommand, withNotices } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import { definitionRenamed, renamerOf } from '../renaming/rename-definition.ts';
import {
  changeAsked,
  updateInputOf,
  updatePlainLanguage,
  withUpdatedDefinitions,
} from '../renaming/update-or-rename.ts';
import { answeredDefinition } from './definition-reading.ts';
import { noGoalsKept, savedFrom } from './saved-content.ts';
import { updatedDefinitionSchemaOf, withDefinitionPageInStudio } from './studio-pages.ts';

const description = [
  'Replaces the document of an active definition and returns its new version, used from then on.',
  'Use it when the person changes or renames a saved definition; a retired one cannot change.',
  '`type` and `name` say which, `source` is the whole new document, and `overview` Markdown for the person who runs the business, written again each time; left out, the saved one stays.',
  'A function needs `diagram` with each `source`; a workflow takes none.',
  'A document that does not fit its format is refused with the line and what is wrong; one the same as saved, with the same diagram and its overview the same or left out, records nothing.',
  '`new_name`, given alone, renames it instead: its versions, runs, page and schedule stay, and each definition that uses it is saved again with the new name.',
].join(' ');

export function defineUpdateDefinition(
  capabilities: readonly Capability[],
  pages: SubjectPages,
  kept = noGoalsKept,
  started?: readonly string[],
) {
  const { goals, messages } = kept;
  const known = knownCapabilities(capabilities);
  const renamer = renamerOf(capabilities, { pages }, started);
  return known.publish(
    defineCommand('playbook', {
      name: 'update_definition',
      title: 'Update definition',
      description,
      repeatable: true,
      route: { method: 'PUT', path: '/definitions/{type}/{name}' },
      reachesOutside: known.reachesOutside,
      inputSchema: updateInputOf(known.field),
      outputSchema: updatedDefinitionSchemaOf(goals),
      reasons: ['not_found', 'invalid_input', 'conflict', 'unavailable'],
      handle: Effect.fnUntraced(function* (asked) {
        const { type, name, source: _source, new_name: _newName, ...texts } = asked;
        const capability = yield* known.capabilityOfType(type);
        const change = yield* changeAsked(asked);
        const updated =
          'rename' in change
            ? yield* definitionRenamed(renamer, { type, from: name, to: change.rename })
            : {
                ...(yield* savedFrom(
                  { capability, pages, written: { ...texts, ...change, name }, goals, messages },
                  (content) => ({ type: 'update', name, content, blanksRefused: goals }),
                )),
                savedAgain: [],
              };
        const linked = yield* withDefinitionPageInStudio(
          yield* answeredDefinition(capability, known.types, updated, {
            change: 'saved',
            inHand: updated.inHand,
            goals,
          }),
          updated.newVersion ? 'updated' : undefined,
        );
        return withNotices(withUpdatedDefinitions(linked, updated.savedAgain), updated.notices);
      }),
      plainLanguage: updatePlainLanguage(capabilities),
    }),
  );
}
