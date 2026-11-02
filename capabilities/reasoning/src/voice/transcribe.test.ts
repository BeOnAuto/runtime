import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { asked, answeredWith, reader, recorded, transcribed } from '../provider-testing/voice-dispatch.ts';
import { defineTranscribe } from './transcribe.ts';

const said = { text: '  Flag any entry over ten thousand dollars for Priya.\n', cost_usd: 0.000167 };

describe('transcribe', () => {
  it('is a command of the org at POST /voice/transcriptions, over HTTP alone, for a reader of playbooks', () => {
    expect(defineTranscribe(Effect.succeed(null)).registration).toMatchObject({
      scope: 'org',
      kind: 'command',
      name: 'transcribe',
      route: { method: 'POST', path: '/voice/transcriptions' },
      servedOverHttpAlone: { kind: 'json' },
      permissions: ['playbook:read'],
      successStatus: 200,
    });
  });

  it('sends the model the recording as it came, its type and its length', async () => {
    const { recordings } = await answeredWith(Effect.succeed(said));

    expect(recordings).toEqual([{ audio: recorded, type: 'audio/webm', seconds: 6 }]);
  });

  it('answers the text without the white space around it', async () => {
    const { outcome } = await answeredWith(Effect.succeed(said));

    expect(outcome).toEqual({
      status: 'succeeded',
      output: { text: 'Flag any entry over ten thousand dollars for Priya.' },
    });
  });

  it('answers an empty text where the model heard nothing', async () => {
    const { outcome, facts } = await answeredWith(Effect.succeed({ text: '  ', cost_usd: null }));

    expect(outcome).toEqual({ status: 'succeeded', output: { text: '' } });
    expect(facts[0]?.data).toMatchObject({ text_characters: 0, cost_usd: null });
  });
});

describe('the transcription on the ledger', () => {
  it('is on a stream of its own on the org ledger, named by its id', async () => {
    const { streams, facts } = await answeredWith(Effect.succeed(said));

    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatch(/^org\/acme\/voice\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
    expect(streams[0]).toBe(`org/acme/voice/${String(facts[0]?.data.id)}`);
  });

  it('records the model, the recording and the cost, as and by whom it was asked, and never the text', async () => {
    const { facts } = await answeredWith(Effect.succeed(said));

    expect(facts.map(({ type }) => type)).toEqual(['voice_transcribed']);
    expect(facts[0]?.data).toEqual({
      id: facts[0]?.data.id,
      model: 'gateway/xai/scribe_v2',
      type: 'audio/webm',
      audio_bytes: 6,
      seconds: 6,
      text_characters: 51,
      cost_usd: 0.000167,
    });
    expect(facts[0]?.context).toEqual({ at: facts[0]?.context.at, by: 'person:user_2ada' });
    expect(Date.parse(String(facts[0]?.context.at))).not.toBeNaN();
    expect(JSON.stringify(facts)).not.toContain('Priya');
  });
});

describe('a transcription refused before the model is called', () => {
  it('is refused as unavailable where the runtime has no voice model, and records nothing', async () => {
    const { outcome, streams } = await transcribed(null);

    expect(outcome).toEqual({ status: 'rejected', reason: 'unavailable', detail: 'This runtime has no voice model' });
    expect(streams).toEqual([]);
  });

  it.each([
    ['/audio', 'an empty audio', { ...asked, audio: '' }],
    ['/audio', 'an audio that is not base64', { ...asked, audio: 'not base64!' }],
    ['/audio', 'an audio cut short', { ...asked, audio: 'GkXfo5' }],
    ['/type', 'a type other than the four', { ...asked, type: 'audio/mpeg' }],
    ['/seconds', 'no seconds', { audio: asked.audio, type: 'audio/webm' }],
    ['/seconds', 'no whole seconds', { ...asked, seconds: 2.5 }],
    ['/seconds', 'no seconds at all', { ...asked, seconds: 0 }],
    ['/seconds', 'more than two minutes', { ...asked, seconds: 121 }],
  ] as const)('is refused at %s for %s, and records nothing', async (pointer, _case, input) => {
    const { outcome, recordings, streams } = await answeredWith(Effect.succeed(said), input);

    expect(outcome).toMatchObject({ status: 'rejected', reason: 'invalid_input', issues: [{ pointer }] });
    expect(recordings).toEqual([]);
    expect(streams).toEqual([]);
  });

  it('takes a recording of two minutes', async () => {
    const { outcome } = await answeredWith(Effect.succeed(said), { ...asked, seconds: 120 });

    expect(outcome).toMatchObject({ status: 'succeeded' });
  });

  it('is refused to a caller who may not read playbooks', async () => {
    const { outcome } = await transcribed(null, asked, { ...reader, permissions: ['org:read'] });

    expect(outcome).toMatchObject({ status: 'rejected', reason: 'forbidden' });
  });
});
