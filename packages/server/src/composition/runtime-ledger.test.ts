import { textToKeep } from '@on.auto/content';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { memoryRuntime } from '../testing/records/memory-runtime.ts';
import { runtimeLedger } from './runtime-ledger.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const gamma = { org: 'globex', playbook: 'gamma' };

describe("the ledger the server hands its capabilities, over the runtime's own", () => {
  it('reads the head of a content a playbook keeps, its size and type, and none for another playbook', async () => {
    const runtime = await memoryRuntime();
    const { content } = runtimeLedger(runtime);
    const kept = await Effect.runPromise(content.put(alpha, textToKeep('{"lead":"lead-1"}', 'application/json')));
    const heads = await Effect.runPromise(
      Effect.all([content.getHead(alpha, kept.sha256), content.getHead(gamma, kept.sha256)]),
    );
    await runtime.dispose();

    expect(heads).toMatchObject([{ bytes: 17, mediaType: 'application/json' }, undefined]);
  });
});
