import type { Telemetry } from 'ai';
import { describe, expect, it } from 'vitest';

import { anthropicMessage } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { accessFor, succeeded, textRequest } from '../testing/adapter-harness.ts';

interface Recorded {
  readonly recordInputs: boolean | undefined;
  readonly recordOutputs: boolean | undefined;
}

type Recording = Readonly<{ recordInputs?: boolean; recordOutputs?: boolean }>;

interface RecordingIntegration {
  readonly integration: Telemetry;
  readonly started: () => readonly Recorded[];
}

function recordingIntegration(): RecordingIntegration {
  const started: Recorded[] = [];
  return {
    integration: {
      onStart: ({ recordInputs, recordOutputs }: Recording) => {
        started.push({ recordInputs, recordOutputs });
      },
    },
    started: () => started,
  };
}

async function startedWith(recordContent: boolean): Promise<readonly Recorded[]> {
  const recording = recordingIntegration();
  const fetched = recordingFetch(() => jsonResponse(anthropicMessage('Short.')));
  const access = await accessFor(
    { ANTHROPIC_API_KEY: 'k' },
    { fetch: fetched.fetch, telemetry: { integrations: [recording.integration], recordContent } },
  );
  await succeeded(access, textRequest('anthropic/claude-sonnet-4-5'));
  return recording.started();
}

describe('a call of a model given the telemetry of its server', () => {
  it('hands the call to its integrations, which leave out what was sent and answered unless content is on', async () => {
    expect([await startedWith(false), await startedWith(true)]).toEqual([
      [{ recordInputs: false, recordOutputs: false }],
      [{ recordInputs: true, recordOutputs: true }],
    ]);
  });
});
