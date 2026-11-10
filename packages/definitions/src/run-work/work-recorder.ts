import type { RecordedContent } from '@on.auto/content';
import {
  PlaybookIdSchema,
  Conflict,
  type Unavailable,
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

import { payloadWrittenIn } from '../payloads/payload-writing.ts';
import { payloadsKeptIn } from '../payloads/run-payloads.ts';
import type { CapabilityFact, GivenAnswer, RunAnswer, RunWork } from '../runs/run-commands.ts';
import { isChangedSinceRead, runStreamNameOf, type RunDeciders } from '../runs/run-decider.ts';
import type { RunStreamAddress } from '../runs/run-settler.ts';
import { startedRunOf, type RecordedRunState } from '../runs/run-state.ts';
import { answerCommandOf, type AnswerPayloads } from './answer-commands.ts';

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
) => Effect.Effect<RecordedWorkAt, Conflict | Unavailable>;

export interface WorkLedger extends StreamReader, StreamWriter {
  readonly content: Pick<RecordedContent, 'put' | 'get' | 'getHead'>;
}

const isWellFormed = Schema.is(
  Schema.Struct({ org: OrgIdSchema, playbook: PlaybookIdSchema, id: Schema.String.check(Schema.isUUID()) }),
);

const noSuchRun = new Conflict({ detail: 'There is no such run in this playbook, so it records no work' });

const readsAgainAtMost = 3;

function admitted(): undefined {
  return undefined;
}

function commandOf<Services>(
  work: Work,
  by: RecordedCaller,
  recorded: RecordedRunState | undefined,
  payloads: AnswerPayloads<Services>,
): Effect.Effect<RunWork | RunAnswer, Conflict | Unavailable, Services> {
  return work.type === 'answer' ? answerCommandOf(work.answer, by, recorded, payloads) : Effect.succeed(work);
}

function payloadsIn({ content }: WorkLedger, run: RunStreamAddress): AnswerPayloads<never> {
  return { written: payloadWrittenIn(content, run), reader: Effect.succeed(payloadsKeptIn(content, run)) };
}

export function workRecorder(ledger: WorkLedger, deciders: RunDeciders): RecordWork {
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
    const recordedWork = yield* commandOf(work, thePlaybook, recorded, payloadsIn(ledger, run));
    const command = { ...recordedWork, runId, by: thePlaybook.id, at };
    const { version } = yield* ledger
      .execute(stream, deciders.asRead, { readAt: read.version, command }, lineage)
      .pipe(Effect.catchTags({ not_found: Effect.die, cancelled: Effect.die }));
    return { id: messageIdOf(stream, version), at };
  });
  return (run, work, lineage, rule = admitted) =>
    recordedAsRead(run, work, lineage, rule).pipe(Effect.retry({ times: readsAgainAtMost, while: isChangedSinceRead }));
}
