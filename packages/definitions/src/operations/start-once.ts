import { CallLineage, PlaybookContext, personOfTheOrg } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { comparedWithItsRecordedInput, takesAStartOnce } from '../runs/run-claims.ts';
import type { RunRequest } from '../runs/run-commands.ts';
import { isTaken } from '../runs/run-decisions.ts';
import { runAnswered } from '../runs/run-lookup.ts';
import { activeVersionOf, preparedVersion, stoppedRefusalOf } from './definition-preparation.ts';
import { runPrepared } from './prepared-run.ts';
import { loadRun, loadStartedRun } from './run-access.ts';

const answeredWhileStopped = Effect.fnUntraced(function* (id: string, request: RunRequest) {
  const { recorded, run } = yield* loadStartedRun(id);
  const taken = yield* Effect.fromResult(takesAStartOnce(run, yield* comparedWithItsRecordedInput(recorded, request)));
  return taken ? yield* runAnswered(id, recorded) : undefined;
});

const lineageActingFor = Effect.fnUntraced(function* (putInPlaceBy: string) {
  const { org } = yield* PlaybookContext;
  const actsFor = yield* personOfTheOrg(org, putInPlaceBy);
  return { ...(yield* CallLineage), actsFor: actsFor ?? null };
});

export const startVersionOnce = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  capability: Capability,
  request: RunRequest & { readonly version?: number | undefined },
  id: string,
) {
  const { version, ...asked } = request;
  const toRun = version ?? (yield* activeVersionOf(capability.type, asked.name));
  const run = yield* preparedVersion(capability, asked.name, toRun);
  const stopped = yield* stoppedRefusalOf(capability.type, asked.name, version === undefined);
  if (stopped !== undefined) {
    const answered = yield* answeredWhileStopped(id, asked);
    return answered ?? (yield* stopped);
  }
  const lineage = yield* lineageActingFor(run.definition.putInPlaceBy);
  return yield* runPrepared(capabilities, id, asked, { ...run, createOnly: true }).pipe(
    Effect.provideService(CallLineage, lineage),
    Effect.catchIf(isTaken, () => Effect.flatMap(loadRun(id), (recorded) => runAnswered(id, recorded))),
  );
});
