import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { keptTextOf } from '../testing/kept-text.ts';
import { mostContentChunkBytes } from './content-chunks.ts';
import { sha256Of } from './content-digest.ts';
import { notTheBytesOfItsDigest } from './content-refusals.ts';
import { memoryRecordedContent } from './memory-content.ts';
import { textOfContent, textToKeep, type StreamedContent } from './streamed-content.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const beta = { org: 'acme', playbook: 'beta' };

const octets = 'application/octet-stream';

function readBack(content: StreamedContent | undefined) {
  return content === undefined
    ? Effect.succeed(content)
    : Effect.map(textOfContent(content), (text) => ({ text, bytes: content.bytes, mediaType: content.mediaType }));
}

function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}

describe('the text a playbook recorded', () => {
  it('reads back as the text it was put as, across chunks and empty, and as nothing for a digest the playbook does not hold', async () => {
    const content = memoryRecordedContent();
    const text = 'é'.repeat(mostContentChunkBytes + 7);
    const [{ sha256 }] = await run(
      Effect.all([content.put(alpha, textToKeep(text, 'text/plain')), content.put(alpha, textToKeep('', octets))]),
    );

    await expect(keptTextOf(content, alpha, sha256)).resolves.toBe(text);
    await expect(keptTextOf(content, alpha, sha256Of(''))).resolves.toBe('');
    await expect(keptTextOf(content, beta, sha256)).resolves.toBeUndefined();
  });

  it('names a content a read found to be other bytes than its digest names', () => {
    expect(notTheBytesOfItsDigest('9f3e').message).toBe(
      'The content kept under 9f3e is not the bytes that digest names',
    );
  });
});

describe('the content staged under a run', () => {
  it('is read when its read runs, not when the read is made', async () => {
    const content = memoryRecordedContent();
    const read = content.staged(alpha, 'run-1', sha256Of('model'));

    await run(content.stage(alpha, 'run-1', textToKeep('model', octets)));

    expect(await run(Effect.flatMap(read, readBack))).toEqual({ text: 'model', bytes: 5, mediaType: octets });
  });
});
