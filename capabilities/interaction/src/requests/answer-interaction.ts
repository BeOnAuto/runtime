import { Buffer } from 'node:buffer';

import {
  RunIdInputField,
  playbookBoundAnswerer,
  recordedRunInPlaybook,
  type RecordedRun,
  refusingBlankText,
  refusingForbiddenCharacters,
  type Capability,
} from '@on.auto/definitions';
import {
  PlaybookReader,
  PlaybookWriter,
  Caller,
  Conflict,
  InvalidInput,
  NotFound,
  RecordedCallerSchema,
  defineCommand,
  recordedCallerOf,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { interactionBounds } from '../run/run-bounds.ts';
import { answerFor } from './answering.ts';
import { answerTakenBy, correlationOfRun, openRequestRowIn, type AnswerTaken } from './request-reads.ts';

const ClaimedForField = Schema.String.annotate({
  description: `Whom the caller says it answers for, kept with the answer as a claim and never checked, at most ${interactionBounds.claimBytes} bytes`,
}).check(
  Schema.makeFilter((text: string) => Buffer.byteLength(text, 'utf8') <= interactionBounds.claimBytes, {
    expected: `at most ${interactionBounds.claimBytes} bytes`,
  }),
  refusingForbiddenCharacters,
  refusingBlankText,
);

const description = [
  "Answers a request a function's run waits on; the run takes the answer within the host's sweep, a second by default,",
  "and an interaction function's run succeeds with it.",
  'Use it when the person approves, rejects, revises or otherwise answers a request list_interactions shows, wherever it reached them;',
  'a new run asks again and answers nothing, and send_run_event gives an event to a waiting workflow instead.',
  '`run_id` is the run of the request, and `answer` takes the shape of the request\'s answer_schema, which list_interactions shows, such as {"decision": "approve"}.',
  '`claimed_for` is whom the caller says it answers for, kept as a claim.',
  'The same answer again answers as before, another is a conflict, and one that does not match leaves the request open.',
].join(' ');

const AnsweredRequestSchema = Schema.Struct({
  run_id: Schema.String.annotate({ description: 'The run that took the answer' }),
  answer_id: Schema.String.annotate({ description: 'The id of the fact the answer is recorded as, for get_event' }),
  answer: Schema.Json.annotate({ description: 'The answer the run took' }),
  claimed_for: Schema.optionalKey(Schema.String.annotate({ description: 'Whom the answer was claimed for' })),
  reply: Schema.optionalKey(
    Schema.Struct({ id: Schema.String, sender: Schema.String }).annotate({
      description: 'The reply that brought the answer, when a reply did',
    }),
  ),
  answered_by: RecordedCallerSchema.annotate({ description: 'The caller who answered it, by id and name' }),
  answered_at: Schema.String.annotate({ description: 'When the answer was recorded, in ISO 8601 UTC' }),
}).annotate({ identifier: 'AnsweredRequest', description: 'The answer a request took, as its run recorded it' });

const answerSchemaOf = Schema.decodeUnknownSync(Schema.Struct({ answer_schema: Schema.JsonObject }));

const notARequest = new Conflict({ detail: 'The run is not a request of a function that waits for an answer' });

const takesNoAnswer = new Conflict({ detail: 'The request is a notification, which takes no answer' });

type AnswerChecks = readonly Pick<Capability, 'type' | 'answerIssues'>[];

interface Answering {
  readonly id: string;
  readonly answer: Schema.Json;
  readonly claimedFor: string | undefined;
}

function takenBy(
  checks: AnswerChecks,
  run: RecordedRun,
  answer: Schema.Json,
): Effect.Effect<Schema.Json, InvalidInput> {
  const capability = checks.find(({ type }) => type === run.run.type);
  const issues = capability?.answerIssues(answer, { work: run.work }) ?? [];
  return issues.length === 0
    ? Effect.succeed(answer)
    : Effect.fail(
        new InvalidInput({
          detail: 'The answer names what the run that asked cannot take',
          issues: issues.map(({ pointer, detail }) => ({ pointer: `/answer${pointer}`, detail })),
        }),
      );
}

function checkedFor(
  checks: AnswerChecks,
  run: RecordedRun,
  answer: Schema.Json,
): Effect.Effect<Schema.Json, InvalidInput | Conflict> {
  if (!run.awaitsSettlement) {
    return Effect.succeed(answer);
  }
  return Effect.flatMap(answerFor(answer, answerSchemaOf(run.run.record).answer_schema), (matched) =>
    takenBy(checks, run, matched),
  );
}

function shownOf(id: string, { id: answerId, answer, claimedFor, reply, by, at }: AnswerTaken) {
  return {
    run_id: id,
    answer_id: answerId,
    answer,
    ...(claimedFor === undefined ? {} : { claimed_for: claimedFor }),
    ...(reply === undefined ? {} : { reply }),
    answered_by: by,
    answered_at: at,
  };
}

const answered = Effect.fnUntraced(function* (checks: AnswerChecks, { id, answer, claimedFor }: Answering) {
  const answeredBy = recordedCallerOf(yield* Caller);
  const row = yield* openRequestRowIn(id);
  const run = yield* recordedRunInPlaybook(yield* PlaybookReader, id);
  if (run === undefined) {
    return yield* new NotFound({ detail: 'There is no such run in this playbook' });
  }
  if (row === undefined) {
    return yield* notARequest;
  }
  if (!row.answers) {
    return yield* takesNoAnswer;
  }
  const checked = yield* checkedFor(checks, run, answer);
  yield* playbookBoundAnswerer(yield* PlaybookWriter)(
    id,
    { answer: checked, ...(claimedFor === undefined ? {} : { claimed_for: claimedFor }) },
    answeredBy,
    { causationId: row.request_id, correlationId: yield* correlationOfRun(id) },
  );
  return shownOf(id, yield* answerTakenBy(id));
});

export function defineAnswerInteraction(checks: AnswerChecks) {
  return defineCommand('playbook', {
    name: 'answer_interaction',
    title: 'Answer a request',
    description,
    route: { method: 'POST', path: '/runs/{run_id}/answer' },
    irreversible: true,
    repeatable: true,
    inputSchema: Schema.Struct({
      run_id: RunIdInputField,
      answer: Schema.Json.annotate({ description: 'The answer, a JSON value the answer schema of the request takes' }),
      claimed_for: Schema.optionalKey(ClaimedForField),
    }),
    outputSchema: AnsweredRequestSchema,
    reasons: ['invalid_input', 'not_found', 'conflict'],
    handle: ({ run_id: id, answer, claimed_for: claimedFor }) => answered(checks, { id, answer, claimedFor }),
    plainLanguage: {
      task: 'answer a request',
      attempt: () => 'answer the request',
      outcome: () =>
        "The request is answered: the run that asked it takes the answer within the host's sweep, a second by default, and get_run shows how it ended.",
    },
  });
}
