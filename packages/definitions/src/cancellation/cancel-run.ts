import { PlaybookReader, PlaybookWriter, capitalized, defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { refusingBlankText, refusingForbiddenCharacters } from '../events/cloud-event.ts';
import { commandMetadata } from '../operations/command-metadata.ts';
import { RunIdInputField } from '../operations/definition-fields.ts';
import { definitionWordsFor } from '../plain-language/definition-words.ts';
import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import { RunSchema, type Run } from '../runs/run.ts';
import { runAfterItsAttemptHere } from './run-cancels.ts';

const mostReasonLength = 1024;

const ReasonField = Schema.String.annotate({
  description: `Why the run is cancelled, in words the run's history keeps, 1 to ${mostReasonLength} characters`,
}).check(Schema.isMinLength(1), Schema.isMaxLength(mostReasonLength), refusingForbiddenCharacters, refusingBlankText);

const description = [
  'Cancels a run that is still going, such as a workflow or a reasoning function, at the request of the person:',
  "the request is recorded on the run at once, and the run ends as cancelled within a moment, a reasoning function's before its next call, a workflow's steps stopped and the runs they wait for cancelled too.",
  'It cannot be undone, and what the run did before it ended stays done.',
  'Use it only when the person asks to stop that run; a run that ends within its call, as a computation or recall function does, a prediction function asked a question or an interaction function that calls a tool, cannot be cancelled.',
  "`run_id` is the run's id and `reason`, kept on the run, says why; asking again records nothing more, and get_run shows how it ended.",
].join(' ');

const correlationOf = Effect.fnUntraced(function* (id: string) {
  const { records } = yield* (yield* PlaybookReader).readRecorded(
    { kind: 'run', run: id },
    { order: 'asc', limit: 1, dataOf: [] },
  );
  return records[0]?.correlationId ?? id;
});

const cancelled = Effect.fnUntraced(function* (id: string, reason: string | undefined) {
  const { by, at } = yield* commandMetadata;
  const correlationId = yield* Effect.orDie(correlationOf(id));
  yield* (yield* PlaybookWriter)
    .execute(
      runStreamNameOf(id),
      runDecider,
      { type: 'cancel', kind: 'requested', reason: reason ?? `Cancelled at the request of ${by}`, runId: id, by, at },
      { causationId: null, correlationId },
    )
    .pipe(Effect.catchTag('cancelled', Effect.die));
  return yield* runAfterItsAttemptHere(id);
});

export function defineCancelRun(capabilities: readonly Capability[]) {
  const words = definitionWordsFor(capabilities);
  const cancelling = ({ type, name }: Pick<Run, 'type' | 'name'>) =>
    `${capitalized(words.named(type, name))} is being cancelled: it ends as cancelled within a moment, unless it finishes first, and how it ended can be looked up then.`;
  return defineCommand('playbook', {
    name: 'cancel_run',
    title: 'Cancel run',
    description,
    route: { method: 'POST', path: '/runs/{run_id}/cancel' },
    irreversible: true,
    repeatable: true,
    inputSchema: Schema.Struct({ run_id: RunIdInputField, reason: Schema.optionalKey(ReasonField) }),
    outputSchema: RunSchema,
    reasons: ['not_found', 'conflict'],
    handle: ({ run_id: id, reason }) => cancelled(id, reason),
    plainLanguage: {
      task: 'cancel a run',
      attempt: () => 'cancel the run',
      outcome: cancelling,
    },
  });
}
