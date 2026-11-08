import { Effect } from 'effect';

import { TimedOut } from '../failure/timed-out.ts';
import type { ModelAccessOptions } from '../providers/model-access-options.ts';
import { withCertificateFailures } from '../providers/outbound-fetch.ts';
import type { Fetch } from '../providers/sdk-model.ts';
import { providersShowingMessages, providerTextScrubber } from '../settings/message-exposure.ts';
import type { ModelSettings } from '../settings/model-settings.ts';
import { transcriptionAttempt } from './transcription-call.ts';
import { endpointOf } from './transcription-endpoint.ts';
import type {
  FailedAttempt,
  Recording,
  Transcriber,
  Transcription,
  TranscriptionEndpoint,
  TranscriptionFailure,
  TranscriptionPolicy,
} from './transcription.ts';

const mostAttempts = 3;

const firstWaitMs = 2000;

const longestAskedWaitMs = 60_000;

const transcriptionDeadlineMs = 60_000;

function waitBefore(attempt: number, { retryAfterMs }: FailedAttempt): number {
  return retryAfterMs !== null && retryAfterMs < longestAskedWaitMs ? retryAfterMs : firstWaitMs * 2 ** (attempt - 1);
}

function attempted(
  send: Effect.Effect<Transcription, FailedAttempt>,
  attempt: number,
): Effect.Effect<Transcription, TranscriptionFailure> {
  return send.pipe(
    Effect.catch((failed: FailedAttempt) =>
      failed.retryable && attempt < mostAttempts
        ? Effect.andThen(Effect.sleep(waitBefore(attempt, failed)), attempted(send, attempt + 1))
        : failed.failed,
    ),
  );
}

function transcribedBy(endpoint: TranscriptionEndpoint, policy: TranscriptionPolicy) {
  const { provider } = endpoint;
  return (recording: Recording): Effect.Effect<Transcription, TranscriptionFailure> =>
    Effect.timeoutOrElse(attempted(transcriptionAttempt(endpoint, policy, recording), 1), {
      duration: transcriptionDeadlineMs,
      orElse: () =>
        Effect.fail(
          new TimedOut({
            detail: `${provider} did not answer within ${transcriptionDeadlineMs} ms`,
            provider,
            timeout_ms: transcriptionDeadlineMs,
          }),
        ),
    });
}

export function transcriberOf(
  settings: ModelSettings,
  options: ModelAccessOptions & { readonly fetch: Fetch },
): Transcriber | null {
  const endpoint = settings.voice === undefined ? null : endpointOf(settings.voice, settings);
  if (endpoint === null) {
    return null;
  }
  const policy: TranscriptionPolicy = {
    fetch: withCertificateFailures(options.fetch),
    showsProviderMessages: providersShowingMessages(settings).has(endpoint.provider),
    scrub: providerTextScrubber(settings, options),
    report: options.reportProviderMessage ?? (() => Effect.void),
    reportHint: options.reportOperatorHint ?? (() => Effect.void),
  };
  return { model: endpoint.reference, transcribe: transcribedBy(endpoint, policy) };
}
