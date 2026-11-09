import { Schema } from 'effect';

import { CancelledKindSchema } from './cancelled-run.ts';
import { ConflictKindSchema } from './conflict.ts';
import { InvalidInputKindSchema } from './invalid-input.ts';
import { RejectionBecauseSchema } from './rejection-because.ts';
import { UnansweredKindSchema } from './unanswered-run.ts';
import { UnavailableKindSchema } from './unavailable.ts';

export const RejectionReasonSchema = Schema.Literals([
  'invalid_input',
  'forbidden',
  'not_found',
  'conflict',
  'unavailable',
  'cancelled',
  'unanswered',
]);

export const RejectionKindSchema = Schema.Union([
  InvalidInputKindSchema,
  UnavailableKindSchema,
  ConflictKindSchema,
  CancelledKindSchema,
  UnansweredKindSchema,
]);

const CauseStatusSchema = Schema.Literals(['rejected', 'failed', 'unreachable', 'timed_out']);

export const RejectionCauseSchema = Schema.Struct({
  step: Schema.String.annotate({
    description:
      'The step whose work ended the run, its reference in the workflow without its leading /, such as do/1/review',
  }),
  run_id: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'The run the step started, by id, when its call was of a definition; a run refused before it started was never recorded, so the id may name no run',
    }),
  ),
  status: CauseStatusSchema.annotate({
    description:
      "How the step's work ended: rejected, failed or unreachable, as its call answered, or timed_out, when the step's time limit or the call's deadline passed first",
  }),
  reason: Schema.optionalKey(
    RejectionReasonSchema.annotate({
      description:
        'With rejected: the reason of the run the step started, or, where that run is a workflow a step of its own ended, of the run that ended it',
    }),
  ),
  kind: Schema.optionalKey(RejectionKindSchema.annotate({ description: 'With rejected: its kind, where it gave one' })),
  because: Schema.optionalKey(
    RejectionBecauseSchema.annotate({ description: 'With rejected: its because, where it gave one' }),
  ),
}).annotate({
  identifier: 'RejectionCause',
  description:
    "The step whose work ended a workflow run, and how that work ended, in codes; the rejection's detail says it in words",
});

export type RejectionCause = typeof RejectionCauseSchema.Type;
