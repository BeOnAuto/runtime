import { CallLineage, defineCommand, PlaybookContext } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { attemptKeyOf, LiveAttempts } from '../attempts/live-attempts.ts';
import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { runPlainLanguage } from '../plain-language/run-words.ts';
import { RunDetailSchema } from '../runs/run.ts';
import { RunIdInputField, InputField, DefinitionNameField } from './definition-fields.ts';
import { newRunId } from './run-access.ts';
import { requestedRun } from './run-requests.ts';

const description = [
  'Runs a function or workflow with an input and records the run.',
  'A run that ends within its call answers its result; a run that finishes later answers started with a run_id unless it ends before its first wait, and get_run shows how it ended.',
  "Run a workflow for what the person asked, or a function to test it; a workflow's steps call it too.",
  '`type` and `name` say which definition, `input` is the value it takes, as the input_schema get_definition shows,',
  'and `run_id` is optional: give the same id to retry safely, since a run that ended or waits answers as it stands and one that failed runs again.',
  'A function that calls a tool may change something outside the playbook, so a run of one that did not succeed is never run again under its id;',
  'list_playbook_events with its run_id shows what it called.',
].join(' ');

export function defineRunDefinition(capabilities: readonly Capability[]) {
  const known = knownCapabilities(capabilities);
  return known.publish(
    defineCommand('playbook', {
      name: 'run_definition',
      title: 'Run definition',
      description,
      route: { method: 'POST', path: '/definitions/{type}/{name}/run' },
      reachesOutside: known.reachesOutside,
      mayChangeOutside: capabilities.some(({ mayChangeOutside }) => mayChangeOutside),
      inputSchema: Schema.Struct({
        type: known.field,
        name: DefinitionNameField,
        input: Schema.optionalKey(InputField),
        run_id: Schema.optionalKey(RunIdInputField),
      }),
      outputSchema: RunDetailSchema,
      reasons: ['not_found', 'conflict', 'invalid_input', 'unavailable', 'cancelled', 'unanswered'],
      handle: Effect.fnUntraced(function* ({ type, name, input = {}, run_id: suppliedId }) {
        const capability = yield* known.capabilityOfType(type);
        const id = suppliedId ?? (yield* newRunId);
        const requested = requestedRun(capabilities, capability, { definition_type: capability.type, name, input }, id);
        const live = yield* Effect.serviceOption(LiveAttempts);
        if (Option.isNone(live)) {
          return yield* requested;
        }
        const key = attemptKeyOf(yield* PlaybookContext, id);
        const { calledBy } = yield* CallLineage;
        return yield* capability.resumes && calledBy === null
          ? live.value.outliving(key, requested)
          : live.value.attempt(key, requested);
      }),
      plainLanguage: runPlainLanguage(capabilities),
    }),
  );
}
