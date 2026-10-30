import { defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { definitionWordsFor } from '../plain-language/definition-words.ts';
import { runPlainLanguage } from '../plain-language/run-words.ts';
import { RunDetailSchema } from '../runs/run.ts';
import { RunIdInputField, InputField, DefinitionNameField } from './definition-fields.ts';
import { startVersionOnce } from './run-requests.ts';

const description = [
  'Starts a run of one version of a definition under a run id, once: when the playbook has a run under that id,',
  'it answers that run as it stands and starts nothing. The workflow host calls it in the process for the runs',
  'that triggers start, as the playbook itself, with their reaction depth, lineage and trigger in the request; no transport serves it.',
].join(' ');

export function defineStartVersion(capabilities: readonly Capability[]) {
  const known = knownCapabilities(capabilities);
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
        version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
        input: InputField,
        run_id: RunIdInputField,
      }),
      outputSchema: RunDetailSchema,
      reasons: ['not_found', 'conflict', 'invalid_input', 'unavailable', 'cancelled', 'unanswered'],
      handle: Effect.fnUntraced(function* ({ type, name, version, input, run_id: id }) {
        const capability = yield* known.capabilityOfType(type);
        return yield* startVersionOnce(
          capabilities,
          capability,
          { definition_type: capability.type, name, version, input },
          id,
        );
      }),
      plainLanguage: {
        ...words,
        attempt: ({ type, name }) => `start ${definitionWords.named(type, name)} once, for one of its triggers`,
      },
    }),
  );
}
