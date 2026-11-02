import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { VoiceEventSchema, voiceDecider, voiceStreamOf, type RecordedVoiceEvent } from './voice-facts.ts';

const acted = { at: '2026-11-02T09:14:03.000Z', by: 'person:user_2ada' };

const heard = {
  id: '019a4412-3c5e-7d10-9b2a-4e6f8a1c2d3e',
  model: 'gateway/xai/scribe_v2',
  type: 'audio/webm',
  audio_bytes: 24_380,
  seconds: 6,
} as const;

const baseline: readonly RecordedVoiceEvent[] = [
  { type: 'voice_transcribed', data: { ...heard, text_characters: 74, cost_usd: 0.000167 }, context: acted },
  { type: 'voice_refused', data: { ...heard, because: 'rate_limited' }, context: acted },
];

describe('the facts of a transcription', () => {
  recordedFactsBehaviour({
    schema: VoiceEventSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.56.0': baseline },
  });
});

describe('the stream of a transcription', () => {
  it('is its own, named by its id', () => {
    expect(voiceStreamOf(heard.id)).toBe(`voice/${heard.id}`);
  });
});

describe('the decision to record a transcription', () => {
  it('records the fact it is given, as and by whom the transcription was asked', () => {
    const fact = { type: 'voice_transcribed', data: { ...heard, text_characters: 0, cost_usd: null } } as const;

    expect(voiceDecider.decide({ fact, ...acted }, null)).toEqual(Result.succeed([fact]));
    expect(voiceDecider.context({ fact, ...acted }, null)).toEqual(acted);
    expect(voiceDecider.evolve(null, { ...fact, context: acted })).toBeNull();
  });
});
