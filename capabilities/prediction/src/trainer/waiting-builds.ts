import { recordedRunInPlaybook } from '@on.auto/definitions';
import { Conflict, NotFound, PlaybookContext, PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { childIdOf, requestReference } from '../build-work/child-runs.ts';
import {
  asksATrainer,
  buildRecordOf,
  buildStateOf,
  type BuildState,
  type RequestRecord,
} from '../builds/build-state.ts';

export interface WaitingBuild {
  readonly build: BuildState;
  readonly record: RequestRecord;
}

function notABuild(id: string): Conflict {
  return new Conflict({ detail: `Run ${id} is not a build`, kind: 'not_a_build' });
}

function noTrainer(id: string): Conflict {
  return new Conflict({
    detail: `Build ${id} asks no trainer: its function names no source, so the playbook fits its candidates itself`,
    kind: 'no_trainer',
  });
}

export const buildEnded = new Conflict({ detail: 'The build has ended', kind: 'build_ended' });

function childHasEnded(id: string): Effect.Effect<boolean, never, PlaybookReader> {
  return Effect.flatMap(PlaybookReader, (reader) =>
    Effect.map(recordedRunInPlaybook(reader, childIdOf(id, requestReference)), (child) =>
      child === undefined ? false : child.run.status !== 'started',
    ),
  );
}

export function waitingBuildOf(
  id: string,
): Effect.Effect<WaitingBuild, Conflict | NotFound, PlaybookReader | PlaybookContext> {
  return Effect.gen(function* () {
    const { org, playbook } = yield* PlaybookContext;
    const reader = yield* PlaybookReader;
    const run = yield* recordedRunInPlaybook(reader, id);
    if (run === undefined) {
      return yield* new NotFound({ detail: 'There is no such run in this playbook' });
    }
    const build = buildStateOf({ org, playbook, id }, run);
    if (build === undefined) {
      return yield* notABuild(id);
    }
    const record = buildRecordOf(build.run);
    if (record !== undefined && !asksATrainer(record)) {
      return yield* noTrainer(id);
    }
    if (record === undefined || !build.run.awaitsSettlement || build.run.answer !== null) {
      return yield* buildEnded;
    }
    const childEnded = record.waiting_for !== undefined && (yield* childHasEnded(build.address.id));
    return childEnded ? yield* buildEnded : { build, record };
  });
}
