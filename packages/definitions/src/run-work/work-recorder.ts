import {
  PlaybookIdSchema,
  Conflict,
  OrgIdSchema,
  playbookCallerOf,
  messageIdOf,
  recordedCallerOf,
  streamPrefixOfPlaybook,
  type Lineage,
  type RecordedCaller,
  type StreamReader,
  type StreamWriter,
} from '@on.auto/operations';
import { DateTime, Effect, Schema } from 'effect';

import type { CapabilityFact, GivenAnswer, RunAnswer, RunWork } from '../runs/run-commands.ts';
import { isChangedSinceRead, runDecider, runStreamNameOf, type RunDeciders } from '../runs/run-decider.ts';
import type { RunStreamAddress } from '../runs/run-settler.ts';
import { startedRunOf, type RecordedRunState } from '../runs/run-state.ts';

export interface RecordedWorkAt {
  readonly id: string;
  readonly at: string;
}

export type Work =
  | { readonly type: 'work'; readonly fact: CapabilityFact }
  | { readonly type: 'answer'; readonly answer: GivenAnswer };

export type WorkRule = (run: RecordedRunState) => Conflict | undefined;

export type RecordWork = (
  run: RunStreamAddress,
  work: Work,
  lineage: Lineage,
  rule?: WorkRule,
) => Effect.Effect<RecordedWorkAt, Conflict>;

const isWellFormed = Schema.is(
  Schema.Struct({ org: OrgIdSchema, playbook: PlaybookIdSchema, id: Schema.String.check(Schema.isUUID()) }),
);

const noSuchRun = new Conflict({ detail: 'There is no such run in this playbook, so it records no work' });

const readsAgainAtMost = 3;

function admitted(): undefined {
  return undefined;
}

function answeredBy(answer: GivenAnswer, by: RecordedCaller): RunAnswer {
  return { type: 'answer', answer: { ...answer, answered_by: by } };
}

function recordedAs(work: Work, by: RecordedCaller): RunWork | RunAnswer {
  return work.type === 'answer' ? answeredBy(work.answer, by) : work;
}

export function workRecorder(ledger: StreamReader & StreamWriter, deciders: RunDeciders): RecordWork {
  const recordedAsRead = Effect.fnUntraced(function* (
    run: RunStreamAddress,
    work: Work,
    lineage: Lineage,
    rule: WorkRule,
  ) {
    if (!isWellFormed(run)) {
      return yield* noSuchRun;
    }
    const runId = run.id.toLowerCase();
    const stream = `${streamPrefixOfPlaybook(run)}${runStreamNameOf(runId)}`;
    const read = (yield* ledger.load(stream, deciders.asRead)).state;
    const recorded = startedRunOf(read.state);
    const refusal = recorded === undefined ? undefined : rule(recorded);
    if (refusal !== undefined) {
      return yield* refusal;
    }
    const at = DateTime.formatIso(yield* DateTime.now);
    const thePlaybook = recordedCallerOf(playbookCallerOf(run));
    const command = { ...recordedAs(work, thePlaybook), runId, by: thePlaybook.id, at };
    const { version } = yield* ledger
      .execute(stream, deciders.asRead, { readAt: read.version, command }, lineage)
      .pipe(Effect.catchTags({ not_found: Effect.die, cancelled: Effect.die }));
    return { id: messageIdOf(stream, version), at };
  });
  return (run, work, lineage, rule = admitted) =>
    recordedAsRead(run, work, lineage, rule).pipe(Effect.retry({ times: readsAgainAtMost, while: isChangedSinceRead }));
}

export type AnswerRun = (
  id: string,
  answer: GivenAnswer,
  by: RecordedCaller,
  lineage: Lineage,
) => Effect.Effect<void, Conflict>;

export function playbookBoundAnswerer(writer: StreamWriter): AnswerRun {
  return (id, answer, by, lineage) =>
    Effect.gen(function* () {
      const runId = id.toLowerCase();
      const at = DateTime.formatIso(yield* DateTime.now);
      yield* writer
        .execute(runStreamNameOf(runId), runDecider, { ...answeredBy(answer, by), runId, by: by.id, at }, lineage)
        .pipe(Effect.catchTags({ not_found: Effect.die, cancelled: Effect.die }));
    });
}
