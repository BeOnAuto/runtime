import { ModelCallFailedBecauseSchema } from '@on.auto/definitions';
import { ActedContextSchema, factOf, type Decided, type Decider } from '@on.auto/operations';
import { Result, Schema } from 'effect';

import { voiceTypes } from './transcription.ts';

const RecordingFields = {
  id: Schema.String,
  model: Schema.String,
  type: Schema.Literals(voiceTypes),
  audio_bytes: Schema.Int,
  seconds: Schema.Int,
};

const VoiceTranscribedSchema = factOf(
  'voice_transcribed',
  Schema.Struct({
    ...RecordingFields,
    text_characters: Schema.Int,
    cost_usd: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  }),
  ActedContextSchema,
);

const VoiceRefusedSchema = factOf(
  'voice_refused',
  Schema.Struct({ ...RecordingFields, because: ModelCallFailedBecauseSchema }),
  ActedContextSchema,
);

export const VoiceEventSchema = Schema.Union([VoiceTranscribedSchema, VoiceRefusedSchema]);

export type RecordedVoiceEvent = typeof VoiceEventSchema.Type;

export type VoiceEvent = Decided<RecordedVoiceEvent>;

interface VoiceCommand {
  readonly fact: VoiceEvent;
  readonly at: string;
  readonly by: string;
}

const voiceStreamKind = 'voice';

export function voiceStreamOf(id: string): string {
  return `${voiceStreamKind}/${id}`;
}

export const voiceDecider: Decider<null, VoiceCommand, RecordedVoiceEvent> = {
  initialState: null,
  evolve: () => null,
  decide: ({ fact }) => Result.succeed([fact]),
  context: ({ at, by }) => ({ at, by }),
  eventSchema: VoiceEventSchema,
};
