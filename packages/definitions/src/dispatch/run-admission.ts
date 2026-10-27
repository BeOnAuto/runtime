import {
  Caller,
  PlaybookContext,
  type CallerIdentity,
  type Conflict,
  type GivenLineage,
  type Unavailable,
} from '@on.auto/operations';
import { Context, Effect, Option, type Schema } from 'effect';

import type { VersionToRun } from '../operations/definition-preparation.ts';
import type { RunRequest } from '../runs/run-commands.ts';

export interface RunDispatch {
  readonly org: string;
  readonly playbook: string;
  readonly runId: string;
  readonly definition: VersionToRun & { readonly type: string };
  readonly input: Schema.Json;
  readonly caller: CallerIdentity;
  readonly calledBy: GivenLineage['calledBy'];
  readonly trigger: GivenLineage['trigger'];
}

export type BeforeRunDispatch = () => Effect.Effect<void, Conflict | Unavailable>;

export class RunAdmission extends Context.Service<
  RunAdmission,
  {
    readonly dispatch: (run: RunDispatch) => Effect.Effect<void, Conflict | Unavailable>;
  }
>()('@on.auto/definitions/RunAdmission') {}

export const dispatchFor = Effect.fnUntraced(function* (
  runId: string,
  definition: VersionToRun,
  request: RunRequest,
  { calledBy, trigger }: Pick<GivenLineage, 'calledBy' | 'trigger'>,
) {
  const admission = yield* Effect.serviceOption(RunAdmission);
  const run: RunDispatch = structuredClone({
    ...(yield* PlaybookContext),
    runId,
    definition: {
      name: definition.name,
      version: definition.version,
      source: definition.source,
      type: request.definition_type,
    },
    input: request.input,
    caller: yield* Caller,
    calledBy,
    trigger,
  });
  return Option.isNone(admission)
    ? () => Effect.void
    : () => Effect.suspend(() => admission.value.dispatch(structuredClone(run)));
});
