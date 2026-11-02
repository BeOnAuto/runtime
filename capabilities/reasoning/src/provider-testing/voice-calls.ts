import { setImmediate as flushed } from 'node:timers/promises';

import { Effect, Fiber, Schema, type Result } from 'effect';
import { TestClock } from 'effect/testing';

import type { ModelAccessOptions } from '../providers/model-access-options.ts';
import { accessFor } from '../testing/adapter-harness.ts';
import type { Recording, Transcriber, Transcription, TranscriptionFailure } from '../voice/transcription.ts';
import { recordingHints, recordingReporter } from './provider-errors.ts';
import { jsonResponse } from './recording-fetch.ts';

interface SentFile {
  readonly name: string;
  readonly type: string;
  readonly bytes: readonly number[];
}

interface SentRecording {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly files: readonly SentFile[];
  readonly model: unknown;
  readonly signal: Readonly<AbortSignal>;
}

export type Answering = (sent: SentRecording, attempt: number) => Response | Promise<Response>;

type Transcribed = Result.Result<Transcription, TranscriptionFailure>;

export const relayKey = 'relay-SECRET-key-8c1d';

export const relay = {
  name: 'relay',
  base_url: 'https://relay.example.com/v1/',
  api_key: relayKey,
  headers: { 'X-Tenant': 'acme' },
  query_params: { 'api-version': '2026-01' },
  cost_header: 'X-LiteLLM-Response-Cost',
};

export const relayed = { MODEL_GATEWAYS: JSON.stringify([relay]), VOICE_MODEL: 'relay/xai/scribe_v2' };

export const spoken: Recording = { audio: new Uint8Array([26, 69, 223, 163, 1, 2]), type: 'audio/webm', seconds: 6 };

const SentInitSchema = Schema.Struct({
  method: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.instanceOf(FormData),
  signal: Schema.instanceOf(AbortSignal),
});

const sentInitOf = Schema.decodeUnknownSync(SentInitSchema);

async function sentFileOf(file: Readonly<File>): Promise<SentFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { name: file.name, type: file.type, bytes: [...bytes] };
}

async function sentOf(input: unknown, init: unknown): Promise<SentRecording> {
  const { method, headers, body, signal } = sentInitOf(init);
  const files = body.getAll('file').filter((entry): entry is File => entry instanceof File);
  return {
    url: String(input),
    method,
    headers: Object.fromEntries(
      Object.entries(headers).map(([name, value]: readonly [string, string]) => [name.toLowerCase(), value]),
    ),
    files: await Promise.all(files.map((file) => sentFileOf(file))),
    model: body.get('model'),
    signal,
  };
}

export function answeringFetch(answer: Answering) {
  const sent: SentRecording[] = [];
  const fetch = async (input: unknown, init?: unknown): Promise<Response> => {
    const request = await sentOf(input, init);
    sent.push(request);
    return answer(request, sent.length);
  };
  return { fetch, sent: (): readonly SentRecording[] => [...sent] };
}

export function answered(text: string, headers: Readonly<Record<string, string>> = {}): Answering {
  return () => jsonResponse({ text }, 200, headers);
}

async function accessWith(
  environment: Readonly<Record<string, string>>,
  answer: Answering,
  reports: Pick<ModelAccessOptions, 'reportProviderMessage' | 'reportOperatorHint'>,
) {
  const fetched = answeringFetch(answer);
  const access = await accessFor(environment, { fetch: fetched.fetch, ...reports });
  return { voice: access.voice, sent: fetched.sent };
}

export async function voiceOf(environment: Readonly<Record<string, string>>, answer: Answering) {
  const reporter = recordingReporter();
  const hints = recordingHints();
  const reports = { reportProviderMessage: reporter.report, reportOperatorHint: hints.report };
  return { ...(await accessWith(environment, answer, reports)), reports: reporter.reports, hints: hints.hints };
}

export function unreportedVoiceOf(environment: Readonly<Record<string, string>>, answer: Answering) {
  return accessWith(environment, answer, {});
}

function transcriberIn(voice: Transcriber | null): Effect.Effect<Transcriber> {
  return Effect.orDie(Effect.fromNullishOr(voice));
}

export function heard(voice: Transcriber | null, recording: Recording = spoken): Promise<Transcribed> {
  return Effect.runPromise(
    Effect.flatMap(transcriberIn(voice), ({ transcribe }) => Effect.result(transcribe(recording))),
  );
}

interface Timeline {
  readonly sentBy: readonly (readonly [number, number])[];
  readonly result: Transcribed;
}

export function onTheClock(
  voice: Transcriber | null,
  sent: () => readonly SentRecording[],
  checks: readonly number[],
): Promise<Timeline> {
  const settled = Effect.promise(() => flushed());
  return Effect.runPromise(
    Effect.gen(function* () {
      const { transcribe } = yield* transcriberIn(voice);
      const fiber = yield* Effect.forkChild(Effect.result(transcribe(spoken)));
      const sentBy: (readonly [number, number])[] = [];
      let now = 0;
      for (const check of checks) {
        yield* settled;
        yield* TestClock.adjust(check - now);
        now = check;
        yield* settled;
        yield* settled;
        sentBy.push([check, sent().length]);
      }
      return { sentBy, result: yield* Fiber.join(fiber) };
    }).pipe(Effect.provide(TestClock.layer())),
  );
}
