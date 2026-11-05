import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { keptTextOf } from '@on.auto/content/testing';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { controlledSignals, recordingCallJournal, reportingAccess, toolRun } from '../testing/index.ts';
import { fakeApiKey, serveFakeMcp } from '../testing/served-fakes.ts';
import type { ImageCall, KeepImage } from './answered-images.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const alpha = { org: 'acme', playbook: 'alpha' };

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');

const keptAnswer = JSON.stringify({
  content: [
    { type: 'image', mimeType: 'image/png', asset: 'asset-1' },
    { type: 'audio', data: pixel, mimeType: 'audio/wav' },
  ],
});

const sentAnswer = JSON.stringify({
  content: [
    { type: 'image', data: pixel, mimeType: 'image/png' },
    { type: 'audio', data: pixel, mimeType: 'audio/wav' },
  ],
});

const placeholders = '[image content (image/png), not shown]\n[audio content (audio/wav), not shown]';

interface Kept {
  readonly bytes: string;
  readonly call: ImageCall;
}

async function photoTaken(entry: Readonly<Record<string, unknown>> = {}) {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  const { access, content } = reportingAccess(
    { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...entry } },
    { environment: { GRAPH_API_KEY: fakeApiKey } },
  );
  closing.push(access.close);
  const kept: Kept[] = [];
  const keepImage: KeepImage = (bytes, call) => {
    kept.push({ bytes: Buffer.from(bytes).toString('base64'), call });
    return Promise.resolve(`asset-${kept.length}`);
  };
  const journal = recordingCallJournal();
  const tools = await Effect.runPromise(
    access.open(toolRun(journal, { keepImage }), [{ server: 'graph', tool: 'photo' }]),
  );
  closing.push(tools.close);
  const [photo] = tools.offered;
  return { photo, journal, kept, content };
}

describe('an image a call of a run answered', () => {
  it('is kept through the run, and the answer the call keeps names its asset in place of its bytes', async () => {
    const { photo, journal, kept, content } = await photoTaken();

    const reply = await photo?.call({ callId: 'toolu_01', input: {} }, controlledSignals());

    expect(reply).toMatchObject({ text: placeholders, isError: false, resultBytes: Buffer.byteLength(keptAnswer) });
    expect(kept).toEqual([{ bytes: pixel, call: { call_id: 'toolu_01', server: 'graph', tool: 'photo' } }]);
    expect(journal.facts().at(-1)).toMatchObject({
      type: 'tool_call_answered',
      data: { result_bytes: Buffer.byteLength(keptAnswer), result_sha256: digest(keptAnswer) },
    });
    expect(await keptTextOf(content, alpha, digest(keptAnswer))).toBe(keptAnswer);
  });

  it('is kept as the run sends a call it records itself, and the model reads what it read before', async () => {
    const { photo, kept } = await photoTaken();

    const sent = await photo?.send({ callId: 'toolu_02', input: {} }, new AbortController().signal);

    expect(sent).toMatchObject({
      ended: { type: 'tool_call_answered', data: { result_sha256: digest(keptAnswer) } },
      reply: { text: placeholders, isError: false },
    });
    expect(kept.map(({ call }) => call.call_id)).toEqual(['toolu_02']);
  });

  it('is not kept where the server keeps no content, and the call records the size of the answer as the tool sent it', async () => {
    const { photo, journal, kept } = await photoTaken({ record_content: false });

    await photo?.call({ callId: 'toolu_03', input: {} }, controlledSignals());

    expect(kept).toEqual([]);
    expect(journal.facts().at(-1)).toMatchObject({
      type: 'tool_call_answered',
      data: { result_bytes: Buffer.byteLength(sentAnswer) },
    });
    expect(journal.facts().at(-1)).not.toHaveProperty('data.result_sha256');
  });
});
