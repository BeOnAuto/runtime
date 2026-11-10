import type { StreamReader } from '@on.auto/operations';
import { Effect, type Option, type Schema } from 'effect';

import type { Capability, PreparedDefinition } from '../capability/capability.ts';
import { sourceToPrepare } from '../operations/definition-views.ts';
import { payloadsKeptIn, payloadValueOf, type KeptContentReader } from '../payloads/run-payloads.ts';
import { definitionVersionIn } from '../registry/definition-versions.ts';
import type { RunStreamAddress } from '../runs/run-settler.ts';
import type { RecordedRunState } from '../runs/run-state.ts';

export interface RunOfItsCapability {
  readonly ledger: StreamReader & KeptContentReader;
  readonly capabilities: readonly Capability[];
  readonly run: RunStreamAddress;
}

function inputOfTheRun({ ledger, run }: RunOfItsCapability, { input }: RecordedRunState) {
  return payloadValueOf(input, payloadsKeptIn(ledger.content, run));
}

export function longestRunOf(of: RunOfItsCapability, state: RecordedRunState): Effect.Effect<Option.Option<number>> {
  const { ledger, capabilities, run: address } = of;
  const { run } = state;
  const capability = capabilities.find(({ type }) => type === run.type);
  if (capability === undefined) {
    return Effect.succeedNone;
  }
  const version = { type: run.type, name: run.name, version: run.definition_version };
  return Effect.flatMap(definitionVersionIn(ledger, address, version), (found) =>
    found === undefined
      ? Effect.succeedNone
      : Effect.option(
          Effect.all([
            capability.prepare(sourceToPrepare(capability.type, found.source), found.stripped),
            inputOfTheRun(of, state),
          ]).pipe(
            Effect.map(([{ longestRunMsFor }, input]: readonly [PreparedDefinition, Schema.Json]) =>
              longestRunMsFor(input),
            ),
          ),
        ),
  );
}
