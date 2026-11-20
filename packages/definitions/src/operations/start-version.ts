import { defineCommand, PlaybookContext } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { attemptKeyOf, LiveAttempts } from '../attempts/live-attempts.ts';
import type { Capability } from '../capability/capability.ts';
import { knownRunningCapabilities } from '../capability/known-capabilities.ts';
import { definitionWordsFor } from '../plain-language/definition-words.ts';
import { runPlainLanguage } from '../plain-language/run-words.ts';
import { RunDetailSchema } from '../runs/run.ts';
import { RunIdInputField, InputField, DefinitionNameField } from './definition-fields.ts';
import { versionStartedOnce } from './version-by-identity.ts';

const description = [
  'Starts a run of one version of a definition under a run id, once, or of its active version when no version is named: when the playbook has a run under that id,',
  'it answers that run as it stands and starts nothing, and a paused definition starts none. The workflow host calls it in the process for the runs',
  'that triggers start, as the playbook itself, with their reaction depth, lineage and trigger in the request; no transport serves it.',
].join(' ');

export function defineStartVersion(capabilities: readonly Capability[]) {
  const known = knownRunningCapabilities(capabilities);
  const words = runPlainLanguage(capabilities);
  const definitionWords = definitionWordsFor(capabilities);
  return known.publish(
    defineCommand('playbook', {
      name: 'start_definition_version',
      title: 'Start a version once',
      description,
      route: { method: 'POST', path: '/definitions/{type}/{name}/start-once' },
      inputSchema: Schema.Struct({
        type: known.field,
        name: DefinitionNameField,
        version: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
        input: InputField,
        run_id: RunIdInputField,
        definition_id: Schema.optionalKey(
          Schema.String.annotate({
            description: 'The id of the definition to start, under which its run is placed whatever it is named now',
          }),
        ),
      }),
      outputSchema: RunDetailSchema,
      reasons: ['not_found', 'conflict', 'invalid_input', 'unavailable', 'cancelled', 'unanswered'],
      handle: Effect.fnUntraced(function* ({ type, name, version, input, run_id: id, definition_id: definition }) {
        const capability = yield* known.capabilityOfType(type);
        const asked = { definition_type: capability.type, name, version, input };
        const { run, started } = yield* versionStartedOnce(capabilities, capability, { id, asked, definition });
        const live = yield* Effect.serviceOption(LiveAttempts);
        return Option.isNone(live) || run.prepared.finishesLaterFor(input)
          ? yield* started
          : yield* live.value.attempt(attemptKeyOf(yield* PlaybookContext, id), started);
      }),
      plainLanguage: {
        ...words,
        attempt: ({ type, name }) => `start ${definitionWords.named(type, name)} once, for one of its triggers`,
      },
    }),
  );
}
