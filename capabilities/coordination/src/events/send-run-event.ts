import { randomUUID } from 'node:crypto';

import {
  callerSourcePrefix,
  EventSourceSchema,
  getRun,
  isWorkflowRun,
  refusingBlankText,
  refusingForbiddenCharacters,
  type PlaybookOwnNames,
} from '@on.auto/definitions';
import { PlaybookContext, Caller, defineCommand, NotFound, quoted } from '@on.auto/operations';
import { jsonBytesOf, measureOf, mostValueDepth } from '@on.auto/workflow-engine';
import type { WorkflowHost } from '@on.auto/workflow-host';
import { DateTime, Effect, Schema, SchemaTransformation } from 'effect';

import { unavailableUnless } from '../runs/host-refusals.ts';

const mostEventBytes = 262_144;

const mostNameLength = 256;

const mostTextLength = 1024;

const mostDataDepth = mostValueDepth - 2;

const noRunningWorkflow = 'The playbook has no active workflow run with that id';

const notNow = 'The workflow cannot take the event now; try again shortly';

const RunIdInputField = Schema.String.annotate({
  description: 'The id of the workflow run, a UUID in any case, kept in lowercase',
})
  .check(Schema.isUUID())
  .pipe(Schema.decodeTo(Schema.String, SchemaTransformation.toLowerCase()));

function text(most: number, description: string) {
  return Schema.String.annotate({ description: `${description}, at most ${most} characters` }).check(
    Schema.isMaxLength(most),
    refusingForbiddenCharacters,
  );
}

const outsideAPathSegment = /[^\w.~!$&'()*+,;=:@-]/gu;

function pathSegmentOf(id: string): string {
  return id.toWellFormed().replaceAll(outsideAPathSegment, (character) => encodeURIComponent(character));
}

function wordedText(most: number, description: string) {
  return text(most, description).check(Schema.isNonEmpty(), refusingBlankText);
}

const EventFields = {
  type: wordedText(mostNameLength, 'What happened, such as com.acme.approval.decided'),
  source: Schema.optionalKey(EventSourceSchema),
  subject: Schema.optionalKey(wordedText(mostTextLength, 'What the event is about')),
  data: Schema.optionalKey(
    Schema.Json.annotate({
      description: `The payload of the event, any JSON value that nests at most ${mostDataDepth} levels deep`,
    }).check(
      Schema.makeFilter((data: Schema.Json) => measureOf(data, mostDataDepth) !== undefined, {
        expected: `data that nests at most ${mostDataDepth} levels deep, so that the workflow can hold the event in a list`,
      }),
    ),
  ),
};

function eventSchemaOf({ refusingThePlaybooksOwnAttributes }: PlaybookOwnNames) {
  return Schema.Struct({
    ...EventFields,
    id: Schema.optionalKey(
      wordedText(
        mostNameLength,
        'An id of the event; an event is delivered to a workflow once per id. Made when left out',
      ),
    ),
  })
    .annotate({
      description: `An event for a workflow to listen to, after the CloudEvents attributes, at most ${mostEventBytes} bytes as JSON in UTF-8`,
    })
    .check(
      Schema.makeFilter((event: Schema.Json) => jsonBytesOf(event) <= mostEventBytes, {
        expected: `an event of at most ${mostEventBytes} bytes as JSON in UTF-8`,
      }),
      refusingThePlaybooksOwnAttributes,
    );
}

const DeliveredEventSchema = Schema.Struct({
  ...EventFields,
  id: Schema.String.annotate({ description: 'The id of the event' }),
  source: Schema.String.annotate({
    description: `Where the event comes from: as given, or ${callerSourcePrefix} and the id of the caller who sent it, percent-encoded as one path segment`,
  }),
  time: Schema.String.annotate({ description: 'When the event was sent, in ISO 8601 UTC' }),
}).annotate({ identifier: 'DeliveredEvent', description: 'The event as the workflow received it' });

const description = [
  'Gives an event to one workflow run that is still going, for a step that listens for it, such as an approval, and returns the event with its id.',
  'Use it when the person answers what a run waits for; it does not start a run, and publish_event gives an event to the playbook as a whole.',
  "`run_id` is the workflow run's id and `event` has a `type` and an optional `source`, `subject`, `data` and `id`;",
  'an event whose id the run already received is ignored, so a call can be retried with its id.',
  'An event no step takes yet waits in the run.',
  "The playbook's own types and sources, and the lineage attributes it gives its own records, are refused.",
].join(' ');

export function defineSendRunEvent(runs: Pick<WorkflowHost, 'deliver'>, names: PlaybookOwnNames) {
  return defineCommand('playbook', {
    name: 'send_run_event',
    title: 'Send event to workflow run',
    description,
    route: { method: 'POST', path: '/runs/{run_id}/events' },
    inputSchema: Schema.Struct({ run_id: RunIdInputField, event: eventSchemaOf(names) }),
    outputSchema: Schema.Struct({
      run_id: Schema.String.annotate({ description: 'The id of the workflow run' }),
      event: DeliveredEventSchema,
    }),
    reasons: ['not_found', 'unavailable'],
    handle: Effect.fnUntraced(function* ({ run_id: runId, event }) {
      const run = yield* getRun.call({ run_id: runId });
      if (!isWorkflowRun(run) || run.status !== 'started') {
        return yield* new NotFound({ detail: noRunningWorkflow });
      }
      const { org, playbook } = yield* PlaybookContext;
      const { id: caller } = yield* Caller;
      const delivered = {
        ...event,
        id: event.id ?? randomUUID(),
        source: event.source ?? `${callerSourcePrefix}${pathSegmentOf(caller)}`,
        time: DateTime.formatIso(yield* DateTime.now),
      };
      const answer = yield* runs
        .deliver({ org, playbook, runId }, delivered)
        .pipe(Effect.mapError(unavailableUnless(notNow)));
      if (answer !== 'delivered') {
        return yield* new NotFound({ detail: noRunningWorkflow });
      }
      return { run_id: runId, event: delivered };
    }),
    plainLanguage: {
      task: 'send an event to a running workflow',
      attempt: ({ event }) => `send the event ${quoted(event.type)} to a running workflow`,
      outcome: ({ event }) =>
        `Delivered the event ${quoted(event.type)} to the running workflow. The workflow uses it as soon as it is waiting for it.`,
    },
  });
}
