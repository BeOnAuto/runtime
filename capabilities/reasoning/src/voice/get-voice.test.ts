import { describe, expect, it } from 'vitest';

import { voiceAsked } from '../provider-testing/voice-dispatch.ts';
import { defineGetVoice } from './get-voice.ts';

describe('get_voice', () => {
  it('is a query of the org at GET /voice, over HTTP alone, for a reader of playbooks', () => {
    expect(defineGetVoice(null).registration).toMatchObject({
      scope: 'org',
      kind: 'query',
      name: 'get_voice',
      route: { method: 'GET', path: '/voice' },
      servedOverHttpAlone: { kind: 'none' },
      permissions: ['playbook:read'],
    });
  });

  it('answers the voice model as the settings name it', async () => {
    expect(await voiceAsked('openai/whisper-1')).toEqual({
      status: 'succeeded',
      output: { model: 'openai/whisper-1' },
    });
  });

  it('answers null where none is set', async () => {
    expect(await voiceAsked(null)).toEqual({ status: 'succeeded', output: { model: null } });
  });
});
