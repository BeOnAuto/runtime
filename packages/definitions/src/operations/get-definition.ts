import { defineQuery } from '@on.auto/operations';
import { Schema } from 'effect';

import type { DefinitionKind } from '../capability/definition-kinds.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { pageOperationsOf } from '../page/render-page.ts';
import {
  definitionStanding,
  definitionWordsFor,
  offeredAttemptFor,
  whatItDoes,
  type OfferedDefinition,
} from '../plain-language/definition-words.ts';
import { DefinitionSchema } from '../registry/definition.ts';
import { DefinitionNameField, RenderField, SampleOutputField } from './definition-fields.ts';
import { definitionRead } from './definition-read.ts';

const description = [
  'Reads one definition with its document, active or retired, with its version and the input and output its document declares.',
  'For a recall function or a page it also returns how its views stand: live, rebuilding, waiting or stalled.',
  'For a workflow it also returns its triggers, the event trigger and the schedules that start it on its own.',
  'A definition with a page answers page.lately; `render: true` previews a page.',
  'Use it to show the person a definition or to learn the input a run takes; list_definitions lists the definitions of a type.',
  "`type` is the definition's type and `name` its name.",
].join(' ');

function readingVerbOf({ render }: Pick<OfferedDefinition, 'render'>): string {
  return render === true ? 'render' : 'look up';
}

export function defineGetDefinition(capabilities: readonly DefinitionKind[]) {
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
      handle: definitionRead(capabilities),
      plainLanguage: {
        task: `look up a ${words.kinds}`,
        attempt: (asked) => `${readingVerbOf(asked)} ${words.named(asked.type, asked.name)}`,
        attemptAsOffered: offeredAttemptFor(capabilities, readingVerbOf),
        outcome: (definition) => `${definitionStanding(words, definition)}${whatItDoes(definition)}`,
      },
    }),
  );
}

export function definitionReadings(capabilities: readonly DefinitionKind[]) {
  return [defineGetDefinition(capabilities), ...pageOperationsOf(capabilities)];
}
