import { makeDispatcher, type CallerIdentity, type Fold, type Outcome } from '@on.auto/operations';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { Effect, Layer } from 'effect';

import { defineGetVoice } from '../voice/get-voice.ts';
import { defineTranscribe } from '../voice/transcribe.ts';
import type { Recording, Transcriber, Transcription, TranscriptionFailure } from '../voice/transcription.ts';
import { VoiceEventSchema, type RecordedVoiceEvent } from '../voice/voice-facts.ts';

export const reader: CallerIdentity = {
  id: 'person:user_2ada',
  name: 'Ada',
  org: 'acme',
  permissions: ['playbook:read'],
  playbooks: ['finance'],
};

export const recorded = Buffer.from([26, 69, 223, 163, 1, 2]);

export const asked = { audio: recorded.toString('base64'), type: 'audio/webm', seconds: 6 };

interface Dispatched {
  readonly outcome: Outcome;
  readonly facts: readonly RecordedVoiceEvent[];
  readonly streams: readonly string[];
}

interface Answered extends Dispatched {
  readonly recordings: readonly Recording[];
}

const collected: Fold<readonly RecordedVoiceEvent[], RecordedVoiceEvent> = {
  initialState: [],
  evolve: (facts, fact) => [...facts, fact],
  eventSchema: VoiceEventSchema,
};

function servicesOn(ledger: ReturnType<typeof memoryLedger>) {
  return Layer.mergeAll(ledger.layer, memoryPlaybookRegistry([]), recordingReporter().layer);
}

export async function transcribed(
  voice: Transcriber | null,
  input: unknown = asked,
  caller: CallerIdentity = reader,
): Promise<Dispatched> {
  const ledger = memoryLedger();
  const { registration } = defineTranscribe(Effect.succeed(voice));
  const outcome = await Effect.runPromise(
    makeDispatcher([])
      .dispatchToOrg(registration, { caller, org: 'acme', input, encoding: 'json' })
      .pipe(Effect.provide(servicesOn(ledger))),
  );
  const streams = ledger.streamNames();
  const loaded = await Effect.runPromise(
    Effect.forEach(streams, (stream) => Effect.map(ledger.service.load(stream, collected), ({ state }) => state)),
  );
  return { outcome, facts: loaded.flat(), streams };
}

export async function answeredWith(
  answer: Effect.Effect<Transcription, TranscriptionFailure>,
  input: unknown = asked,
): Promise<Answered> {
  const recordings: Recording[] = [];
  const transcriber: Transcriber = {
    model: 'gateway/xai/scribe_v2',
    transcribe: (recording) => {
      recordings.push(recording);
      return answer;
    },
  };
  return { ...(await transcribed(transcriber, input)), recordings };
}

export function voiceAsked(model: string | null): Promise<Outcome> {
  return Effect.runPromise(
    makeDispatcher([])
      .dispatchToOrg(defineGetVoice(model).registration, {
        caller: reader,
        org: 'acme',
        input: {},
        encoding: 'strings',
      })
      .pipe(Effect.provide(servicesOn(memoryLedger()))),
  );
}
