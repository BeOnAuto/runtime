import { Caller, defineCommand, recordedCallerOf } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { definitionWordsFor } from '../plain-language/definition-words.ts';
import { DefinitionSchema } from '../registry/definition.ts';
import { DefinitionNameField, reasonFieldOf } from './definition-fields.ts';
import { answeredDefinition } from './definition-reading.ts';
import { recordInRegistry } from './registry-access.ts';

const ReasonField = reasonFieldOf('Why the definition is paused, kept with it while it stays paused');

const description = [
  "Pauses a function or workflow and returns it: while it is paused, neither its triggers, nor run_definition, nor a workflow's step starts a run of it, and the runs already going finish.",
  'The times and events its triggers meet while it is paused are never run, and resume_definition lets it run again.',
  '`type` and `name` say which definition and `reason` says why; pausing one already paused changes nothing.',
].join(' ');

export function definePauseDefinition(capabilities: readonly Capability[]) {
  const known = knownCapabilities(capabilities);
  const words = definitionWordsFor(capabilities);
  return known.publish(
    defineCommand('playbook', {
      name: 'pause_definition',
      title: 'Pause definition',
      description,
      repeatable: true,
      route: { method: 'POST', path: '/definitions/{type}/{name}/pause' },
      inputSchema: Schema.Struct({
        type: known.field,
        name: DefinitionNameField,
        reason: Schema.optionalKey(ReasonField),
      }),
      outputSchema: DefinitionSchema,
      reasons: ['not_found', 'conflict'],
      handle: Effect.fnUntraced(function* ({ type, name, reason }) {
        const capability = yield* known.capabilityOfType(type);
        const pausedBy = recordedCallerOf(yield* Caller);
        const paused = yield* recordInRegistry(capability, {
          type: 'pause',
          name,
          paused_by: pausedBy,
          ...(reason === undefined ? {} : { reason }),
        });
        return yield* answeredDefinition(capability, known.types, paused);
      }),
      plainLanguage: {
        task: `pause a ${words.kinds}`,
        attempt: ({ type, name }) => `pause ${words.named(type, name)}`,
        outcome: ({ type, name }) =>
          `Paused ${words.named(type, name)}. It starts no runs until it is resumed, and the runs already going finish.`,
      },
    }),
  );
}
