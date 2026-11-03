import { defineQuery, InvalidInput } from '@on.auto/operations';
import { Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import {
  definitionStanding,
  definitionWordsFor,
  offeredAttemptFor,
  whatItDoes,
  type OfferedDefinition,
} from '../plain-language/definition-words.ts';
import { DefinitionSchema } from '../registry/definition.ts';
import { DefinitionNameField, RenderField, SampleOutputField } from './definition-fields.ts';
import { definitionRead, type PageMissing } from './definition-read.ts';

const description = [
  'Reads one definition with its document, active or retired, with its version and the input and output its document declares.',
  'For a workflow it also returns its triggers, the event trigger and the schedules that start it on its own.',
  'A definition whose document has a page answers page.runs and how its views stand; `render: true` previews the page.',
  'Use it to show the person a definition or to learn the input a run takes; list_definitions lists the definitions of a type.',
  "`type` is the definition's type and `name` its name.",
].join(' ');

function readingVerbOf({ render }: Pick<OfferedDefinition, 'render'>): string {
  return render === true ? 'render' : 'look up';
}

function noPageToRender({ label, name }: PageMissing): InvalidInput {
  const detail = `The ${label} ${name} has no page to render; save one with update_definition, or leave render out`;
  return new InvalidInput({ detail, issues: [{ pointer: '/render', detail }] });
}

export function defineGetDefinition(capabilities: readonly Capability[], pages: SubjectPages) {
  const known = knownCapabilities(capabilities);
  const words = definitionWordsFor(capabilities);
  return known.publish(
    defineQuery('playbook', {
      name: 'get_definition',
      title: 'Get definition',
      description,
      route: { method: 'GET', path: '/definitions/{type}/{name}' },
      inputSchema: Schema.Struct({
        type: known.field,
        name: DefinitionNameField,
        render: Schema.optionalKey(RenderField),
        sample_output: Schema.optionalKey(SampleOutputField),
      }),
      outputSchema: DefinitionSchema,
      reasons: ['not_found', 'invalid_input', 'conflict'],
      handle: definitionRead(capabilities, pages, noPageToRender),
      plainLanguage: {
        task: `look up a ${words.kinds}`,
        attempt: (asked) => `${readingVerbOf(asked)} ${words.named(asked.type, asked.name)}`,
        attemptAsOffered: offeredAttemptFor(capabilities, readingVerbOf),
        outcome: (definition) => `${definitionStanding(words, definition)}${whatItDoes(definition)}`,
      },
    }),
  );
}
