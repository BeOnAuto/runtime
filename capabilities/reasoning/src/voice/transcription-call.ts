import { Effect, Predicate } from 'effect';

import { ProviderNotConfigured } from '../failure/provider-not-configured.ts';
import { ProviderUnavailable } from '../failure/provider-unavailable.ts';
import { costOf } from '../model-calls/answer-mapping.ts';
import { apiCallFailure, retryAfterMs } from '../model-calls/api-call-failure.ts';
import { OutboundFailure } from '../providers/outbound-failure.ts';
import { refusedByTheAccount } from './account-refusal.ts';
import type {
  FailedAttempt,
  Recording,
  Transcription,
  TranscriptionEndpoint,
  TranscriptionPolicy,
} from './transcription.ts';

interface Answer {
  readonly status: number;
  readonly ok: boolean;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly text: string;
}

const mostReportedCharacters = 2000;

const paymentRequired = 402;

const retriedStatuses: ReadonlySet<number> = new Set([408, 409, 429]);

function formOf(model: string, { audio, type }: Recording): FormData {
  const form = new FormData();
  form.append('file', new Blob([audio], { type }), `recording.${type.slice('audio/'.length)}`);
  form.append('model', model);
  return form;
}

async function answerOf(
  endpoint: TranscriptionEndpoint,
  policy: TranscriptionPolicy,
  recording: Recording,
  signal: Readonly<AbortSignal>,
): Promise<Answer> {
  const response = await policy.fetch(endpoint.url, {
    method: 'POST',
    headers: { ...endpoint.headers },
    body: formOf(endpoint.model, recording),
    signal,
  });
  return {
    status: response.status,
    ok: response.ok,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers),
    text: await response.text(),
  };
}

function jsonOf(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

function errorMessageOf(data: unknown, statusText: string): string {
  return Predicate.hasProperty(data, 'error') &&
    Predicate.hasProperty(data.error, 'message') &&
    typeof data.error.message === 'string'
    ? data.error.message
    : statusText;
}

function transcriptionOf(endpoint: TranscriptionEndpoint, answer: Answer): Effect.Effect<Transcription, FailedAttempt> {
  const data = jsonOf(answer.text);
  const { provider } = endpoint;
  return Predicate.hasProperty(data, 'text') && typeof data.text === 'string'
    ? Effect.succeed({ text: data.text, cost_usd: costOf(answer.headers, endpoint.costHeader) ?? null })
    : Effect.fail({
        failed: Effect.fail(
          new ProviderUnavailable({
            detail: `The response of ${provider} could not be read`,
            provider,
            status: answer.status,
          }),
        ),
        retryable: false,
        retryAfterMs: null,
      });
}

function isRetried(status: number): boolean {
  return status >= 500 || retriedStatuses.has(status);
}

const refusedCall = Effect.fnUntraced(function* (
  endpoint: TranscriptionEndpoint,
  policy: TranscriptionPolicy,
  answer: Answer,
) {
  const data = jsonOf(answer.text);
  const refusal = answer.status === paymentRequired ? refusedByTheAccount(data) : undefined;
  if (refusal !== undefined) {
    return refusal;
  }
  const message = errorMessageOf(data, answer.statusText);
  const { provider, reference } = endpoint;
  if (message.trim() !== '') {
    yield* policy.report({
      provider,
      model: reference,
      status: answer.status,
      message: policy.scrub(message.trim()).slice(0, mostReportedCharacters),
      run_id: null,
    });
  }
  const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
  const failed: FailedAttempt = {
    failed: Effect.fail(
      answer.status === paymentRequired
        ? new ProviderUnavailable({
            detail: `${provider} could not serve the request (HTTP ${paymentRequired})`,
            provider,
            status: paymentRequired,
          })
        : apiCallFailure({
            provider,
            status: answer.status,
            message,
            responseBody: answer.text,
            headers: answer.headers,
            data,
            now,
            showsMessage: policy.showsProviderMessages,
            scrub: policy.scrub,
            lastInputTokens: null,
          }),
    ),
    retryable: isRetried(answer.status),
    retryAfterMs: retryAfterMs(answer.headers, now),
  };
  return failed;
});

const unsent = Effect.fnUntraced(function* (
  endpoint: TranscriptionEndpoint,
  policy: TranscriptionPolicy,
  error: unknown,
) {
  const { provider, reference } = endpoint;
  if (!(error instanceof OutboundFailure)) {
    const unreached: FailedAttempt = {
      failed: Effect.fail(
        new ProviderUnavailable({ detail: `${provider} could not be reached`, provider, status: null }),
      ),
      retryable: true,
      retryAfterMs: null,
    };
    return unreached;
  }
  yield* policy.reportHint({
    provider,
    model: reference,
    hint: `The TLS certificate of ${provider} is not trusted; add its certificate authority with NODE_EXTRA_CA_CERTS`,
    run_id: null,
  });
  const untrusted: FailedAttempt = {
    failed: Effect.fail(
      new ProviderNotConfigured({
        detail: `The TLS certificate of ${provider} is not trusted by this server; its operator must add the certificate authority`,
        provider,
        configured: [],
        missing: ['NODE_EXTRA_CA_CERTS'],
      }),
    ),
    retryable: false,
    retryAfterMs: null,
  };
  return untrusted;
});

export function transcriptionAttempt(
  endpoint: TranscriptionEndpoint,
  policy: TranscriptionPolicy,
  recording: Recording,
): Effect.Effect<Transcription, FailedAttempt> {
  return Effect.tryPromise({
    try: (signal) => answerOf(endpoint, policy, recording, signal),
    catch: (error) => error,
  }).pipe(
    Effect.matchEffect({
      onFailure: (error) => Effect.flip(unsent(endpoint, policy, error)),
      onSuccess: (answer) =>
        answer.ok ? transcriptionOf(endpoint, answer) : Effect.flip(refusedCall(endpoint, policy, answer)),
    }),
  );
}
