import { PlaybookContext, defineQuery } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { definitionStanding, definitionWordsFor, whatItDoes } from '../plain-language/definition-words.ts';
import { DefinitionSchema } from '../registry/definition.ts';
import { DefinitionNameField } from './definition-fields.ts';
import { readDefinition } from './definition-reading.ts';
import { triggersSince } from './registry-access.ts';

export function defineGetDefinition(capabilities: readonly Capability[]) {
  const known = knownCapabilities(capabilities);
  const words = definitionWordsFor(capabilities);
  return known.publish(
    defineQuery('playbook', {
      name: 'get_definition',
      title: 'Get definition',
      description: [
        'Reads one function or workflow definition with its document and returns it, active or retired, with its version and the input and output its document declares.',
        'For a recall function it also returns the standing of its view: live, rebuilding, waiting or stalled, the events it has folded and how far it lags the playbook.',
        'For a workflow it also returns its triggers, the event trigger and the schedules that start it on its own.',
        'Use it to show the person a definition or to learn the input a run takes; list_definitions lists the definitions of a type.',
        "`type` is the definition's type and `name` its name.",
      ].join(' '),
      route: { method: 'GET', path: '/definitions/{type}/{name}' },
      inputSchema: Schema.Struct({ type: known.field, name: DefinitionNameField }),
      outputSchema: DefinitionSchema,
      reasons: ['not_found'],
      handle: Effect.fnUntraced(function* ({ type, name }) {
        const capability = yield* known.capabilityOfType(type);
        const { stored, definition: read } = yield* readDefinition(capability, known.types, name);
        const definition =
          (stored.triggers ?? []).length > 0 && stored.status === 'active'
            ? { ...read, triggers_since: yield* triggersSince(capability.type, stored) }
            : read;
        const { org, playbook } = yield* PlaybookContext;
        const standing = yield* capability.standing({
          org,
          playbook,
          name,
          version: definition.version,
          status: definition.status,
          ...(stored.details === undefined ? {} : { details: stored.details }),
        });
        return standing === undefined ? definition : { ...definition, standing };
      }),
      plainLanguage: {
        task: `look up a ${words.kinds}`,
        attempt: ({ type, name }) => `look up ${words.named(type, name)}`,
        outcome: (definition) => `${definitionStanding(words, definition)}${whatItDoes(definition)}`,
      },
    }),
  );
}
