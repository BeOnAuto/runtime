import {
  OrgIdSchema,
  PlaybookIdSchema,
  type CalledBy,
  type StartingTrigger,
  type StreamReader,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { runDecider, runStreamIn, type RunPlacing } from '../runs/run-decider.ts';
import type { RunStreamAddress } from '../runs/run-settler.ts';
import { isRunning, startedRunOf, type RecordedRunState, type RunStreamState } from '../runs/run-state.ts';

export interface HoldingAttempt {
  readonly fencingToken: number;
  readonly type: string;
  readonly startedBy: string;
  readonly resumes: boolean;
  readonly calledBy: CalledBy | null;
  readonly trigger: StartingTrigger | null;
  readonly actsFor: string | null;
  readonly depth: number;
  readonly callDepth: number;
}

const isWellFormed = Schema.is(
  Schema.Struct({ org: OrgIdSchema, playbook: PlaybookIdSchema, id: Schema.String.check(Schema.isUUID()) }),
);

function holdingOf(state: RecordedRunState): HoldingAttempt {
  const { fencingToken, run, resumes, calledBy, trigger, depth, callDepth } = state;
  return {
    fencingToken,
    type: run.type,
    startedBy: run.started_by.id,
    resumes,
    calledBy: calledBy ?? null,
    trigger: trigger ?? null,
    actsFor: run.acts_for ?? null,
    depth,
    callDepth,
  };
}

function holdingIn(state: RunStreamState): HoldingAttempt | undefined {
  const run = startedRunOf(state);
  return run !== undefined && isRunning(run) ? holdingOf(run) : undefined;
}

export function holdingAttemptIn(
  reader: StreamReader & RunPlacing,
  address: RunStreamAddress,
): Effect.Effect<HoldingAttempt | undefined> {
  if (!isWellFormed(address)) {
    return Effect.undefined;
  }
  return Effect.flatMap(runStreamIn(reader, { ...address, id: address.id.toLowerCase() }), (stream) =>
    stream === undefined
      ? Effect.undefined
      : Effect.map(reader.load(stream, runDecider), ({ state }) => holdingIn(state)),
  );
}
