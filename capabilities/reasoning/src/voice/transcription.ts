import type { RejectionBecause } from '@on.auto/operations';
import { Data, type Effect } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import type { ReportOperatorHint, ReportProviderMessage } from '../providers/model-access-options.ts';
import type { Fetch } from '../providers/sdk-model.ts';

export const voiceTypes = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav'] as const;

export type VoiceType = (typeof voiceTypes)[number];

export interface Recording {
  readonly audio: Readonly<Uint8Array<ArrayBuffer>>;
  readonly type: VoiceType;
  readonly seconds: number;
}

export interface Transcription {
  readonly text: string;
  readonly cost_usd: number | null;
}

export type AccountRefusalKind = 'credits_exhausted' | 'account_closed' | 'meter_unavailable' | 'model_not_offered';

export class AccountRefused extends Data.TaggedError('account_refused')<{
  readonly kind: AccountRefusalKind;
  readonly detail: string;
  readonly resolve_at?: string;
  readonly because?: RejectionBecause;
}> {}

export type TranscriptionFailure = ModelFailure | AccountRefused;

export interface Transcriber {
  readonly model: string;
  readonly transcribe: (recording: Recording) => Effect.Effect<Transcription, TranscriptionFailure>;
}

export interface TranscriptionEndpoint {
  readonly provider: string;
  readonly reference: string;
  readonly model: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly costHeader: string | null;
}

export interface TranscriptionPolicy {
  readonly fetch: Fetch;
  readonly showsProviderMessages: boolean;
  readonly scrub: (text: string) => string;
  readonly report: ReportProviderMessage;
  readonly reportHint: ReportOperatorHint;
}

export interface FailedAttempt {
  readonly failed: Effect.Effect<never, TranscriptionFailure>;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
}
