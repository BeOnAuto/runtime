import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { mostContentChunkBytes } from '../content/content-chunks.ts';
import { sha256Of } from '../content/content-digest.ts';
import { textToKeep } from '../content/streamed-content.ts';
import { keptTextOf } from './kept-text.ts';
import { memoryRecordedContent } from './memory-content.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const beta = { org: 'acme', playbook: 'beta' };

const octets = 'application/octet-stream';

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
});
