import type { ModelCallFailedBecause } from '@on.auto/definitions';
import { Conflict, InvalidInput, Unavailable, type RejectionBecause } from '@on.auto/operations';
import { Effect } from 'effect';

import { saidBy, waitFor } from '../capability/model-rejection.ts';
import type { AccountRefusalKind, TranscriptionFailure } from './transcription.ts';

type TranscriptionRejection = Conflict | Unavailable | InvalidInput;

interface Refusal {
  readonly kind: AccountRefusalKind;
  readonly detail: string;
  readonly resolve_at?: string;
  readonly because?: RejectionBecause;
}

interface Described {
  readonly detail: string;
}

interface Refused extends Described {
  readonly provider_message: string | null;
}

interface Limited extends Described {
  readonly retry_after_ms: number | null;
}

type Rejected = Effect.Effect<never, TranscriptionRejection>;

function refusedByTheAccount({ kind, detail, resolve_at: resolveAt, because }: Refusal): Rejected {
  const why = because === undefined ? {} : { because };
  return Effect.fail(
    kind === 'credits_exhausted' || kind === 'account_closed'
      ? new Conflict({ detail, kind, ...why, ...(resolveAt === undefined ? {} : { resolve_at: resolveAt }) })
      : new Unavailable({ detail, kind, ...why }),
  );
}

function unworkable({ detail, provider_message: said }: Refused): Rejected {
  return Effect.fail(new Conflict({ detail: `${detail}${saidBy(said ?? undefined)}`, kind: 'unworkable' }));
}

function refusedContent({ detail }: Described): Rejected {
  return Effect.fail(
    new InvalidInput({
      detail,
      issues: [{ pointer: '/audio', detail: 'The model refused this recording under its content policy' }],
    }),
  );
}

function limited({ detail, retry_after_ms: wait }: Limited): Rejected {
  return Effect.fail(new Unavailable({ detail: `${detail}; try again ${waitFor(wait ?? undefined)}` }));
}

function unavailableWith(advice: string): (failure: Described) => Rejected {
  return ({ detail }) => Effect.fail(new Unavailable({ detail: `${detail}${advice}` }));
}

type RefusalRecorder<R> = (because: ModelCallFailedBecause) => Effect.Effect<void, Conflict, R>;

export function rejectedAsTranscription<A, R, Recording>(
  transcribed: Effect.Effect<A, TranscriptionFailure, R>,
  recorded: RefusalRecorder<Recording>,
): Effect.Effect<A, TranscriptionRejection, R | Recording> {
  const recordedThen =
    <Failure>(because: ModelCallFailedBecause, rejected: (failure: Failure) => Rejected) =>
    (failure: Failure) =>
      Effect.andThen(recorded(because), rejected(failure));
  return transcribed.pipe(
    Effect.catchTags({
      account_refused: refusedByTheAccount,
      definition_invalid: recordedThen('definition_invalid', unworkable),
      request_too_long: recordedThen('request_too_long', unworkable),
      content_refused: recordedThen('content_refused', refusedContent),
      rate_limited: recordedThen('rate_limited', limited),
      provider_unavailable: recordedThen('provider_unavailable', unavailableWith('; try again later')),
      timed_out: recordedThen('timed_out', unavailableWith('; try again later')),
      output_invalid: recordedThen('output_invalid', unavailableWith('; try again')),
      provider_not_configured: recordedThen('provider_not_configured', unavailableWith('')),
      model_not_allowed: recordedThen('model_not_allowed', unavailableWith('')),
      credentials_rejected: recordedThen('credentials_rejected', unavailableWith('')),
    }),
  );
}
