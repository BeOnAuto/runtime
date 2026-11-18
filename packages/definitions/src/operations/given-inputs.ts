import { schemaCheckOf } from '@on.auto/json-schema';
import { CallLineage } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { normalizedArgument } from '../checking/given-values.ts';
import { stagedRegistered } from '../read-model-staging/staged-definitions.ts';
import { mostInputDepth } from '../runs/recorded-size.ts';
import type { RunRequest } from '../runs/run-commands.ts';
import { inputBytesIssues } from './definition-fields.ts';
import { requestedRun } from './run-requests.ts';

const givenInput = { operation: 'run_definition', argument: 'input' };

function inputIssuesUnder(declared: Schema.JsonObject) {
  return schemaCheckOf(declared, { what: 'input', nesting: mostInputDepth, further: inputBytesIssues });
}

const inputTakenFromText = Effect.fnUntraced(function* (type: string, name: string, input: string) {
  const declared = (yield* stagedRegistered({ reading: 'run_starts', read: 'run_start' }, type, name))?.input_schema;
  if (declared === undefined) {
    return input;
  }
  const normalized = yield* normalizedArgument(givenInput, input, inputIssuesUnder(declared));
  return 'value' in normalized ? normalized.value : input;
});

const inputAsMeant = Effect.fnUntraced(function* ({ definition_type: type, name, input }: RunRequest) {
  const { calledBy } = yield* CallLineage;
  return calledBy === null && typeof input === 'string' ? yield* inputTakenFromText(type, name, input) : input;
});

export const requestedRunAsMeant = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  given: RunRequest,
  id: string,
) {
  const input = yield* inputAsMeant(given);
  return yield* requestedRun(capabilities, capability, { ...given, input }, id);
});
