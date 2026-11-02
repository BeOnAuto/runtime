import { Caller, OrgWriter, Unavailable, defineHttpOperation, randomUUIDv7 } from '@on.auto/operations';
import { DateTime, Effect, Schema } from 'effect';

import { rejectedAsTranscription } from './transcription-refusals.ts';
import { voiceTypes, type Recording, type Transcriber, type Transcription } from './transcription.ts';
import { voiceDecider, voiceStreamOf, type VoiceEvent } from './voice-facts.ts';

const mostRecordingSeconds = 120;

const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

const TranscribeInputSchema = Schema.Struct({
  audio: Schema.String.check(
    Schema.isMinLength(1),
    Schema.makeFilter((audio: string) => base64.test(audio), { expected: 'a recording in base64' }),
  ).annotate({ description: 'The recording, in base64' }),
  type: Schema.Literals(voiceTypes).annotate({
    description: 'The media type of the recording: audio/webm, audio/ogg, audio/mp4 or audio/wav',
  }),
  seconds: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: mostRecordingSeconds })).annotate({
    description: `How long the recording is, as the caller measured it, a whole number from 1 to ${mostRecordingSeconds}`,
  }),
});

type TranscribeInput = typeof TranscribeInputSchema.Type;

const TranscribeOutputSchema = Schema.Struct({
  text: Schema.String.annotate({
    description: 'The transcription as the voice model gave it, without the white space around it',
  }),
});

const noVoiceModel = new Unavailable({ detail: 'This runtime has no voice model' });

type Heard = Omit<Extract<VoiceEvent, { readonly type: 'voice_refused' }>['data'], 'because'>;

const recorded = Effect.fnUntraced(function* (fact: VoiceEvent) {
  const caller = yield* Caller;
  yield* (yield* OrgWriter).execute(voiceStreamOf(fact.data.id), voiceDecider, {
    fact,
    at: DateTime.formatIso(yield* DateTime.now),
    by: caller.id,
  });
});

function answerRecordedOf(heard: Heard) {
  return ({ text, cost_usd }: Transcription) => {
    const answered = text.trim();
    return Effect.as(
      recorded({ type: 'voice_transcribed', data: { ...heard, text_characters: answered.length, cost_usd } }),
      { text: answered },
    );
  };
}

function heardBy({ model, transcribe }: Transcriber, recording: Recording) {
  const { type, seconds, audio } = recording;
  const heard: Heard = { id: randomUUIDv7(), model, type, audio_bytes: audio.byteLength, seconds };
  return rejectedAsTranscription(transcribe(recording), (because) =>
    recorded({ type: 'voice_refused', data: { ...heard, because } }),
  ).pipe(Effect.flatMap(answerRecordedOf(heard)));
}

const transcribedBy = (voice: Effect.Effect<Transcriber | null>) =>
  Effect.fnUntraced(function* ({ audio, type, seconds }: TranscribeInput) {
    const transcriber = yield* voice;
    return transcriber === null
      ? yield* Effect.fail(noVoiceModel)
      : yield* heardBy(transcriber, { audio: Buffer.from(audio, 'base64'), type, seconds });
  });

export function defineTranscribe(voice: Effect.Effect<Transcriber | null>) {
  return defineHttpOperation('org', 'command', {
    name: 'transcribe',
    title: 'Transcribe a recording',
    description: [
      'Writes out what a person says in a recording, with the voice model the runtime’s settings name, so a person can speak a comment rather than type it.',
      'It answers the text, and records the transcription on the org’s ledger without the recording or its text.',
    ].join(' '),
    route: { method: 'POST', path: '/voice/transcriptions' },
    permittedBy: ['playbook:read'],
    body: { kind: 'json' },
    inputSchema: TranscribeInputSchema,
    outputSchema: TranscribeOutputSchema,
    reasons: ['invalid_input', 'unavailable', 'conflict'],
    handle: transcribedBy(voice),
  });
}
