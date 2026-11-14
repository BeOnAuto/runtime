import { sha256Of } from '@on.auto/content';
import { memoryRecordedContent } from '@on.auto/content/testing';
import {
  PayloadErased,
  mostInlinePayloadBytes,
  jsonPayloadText,
  textBytesOf,
  payloadChosen,
  payloadKept,
  payloadMembers,
  payloadReaderOf,
  textPayloadText,
  type PayloadSource,
} from '@on.auto/operations/payloads';
import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { mostOutputBytes, mostOutputsKept, runOutputsOf, type RecordedOutput } from './run-outputs.ts';

const owner = { org: 'acme', playbook: 'sales' };

const output = { results: [{ issue: 'MAR-41', customers: 3, notes: 'n'.repeat(mostInlinePayloadBytes) }] };

interface Twins {
  readonly inline: RecordedOutput;
  readonly kept: RecordedOutput;
  readonly content: PayloadSource['content'];
}

async function twinsOf(value: Schema.Json, keptInStore = true): Promise<Twins> {
  const content = memoryRecordedContent();
  const chosen = payloadChosen(value, jsonPayloadText(value), true, mostInlinePayloadBytes);
  if (keptInStore && chosen.toKeep !== undefined) {
    await Effect.runPromise(payloadKept(content, owner, chosen.toKeep));
  }
  return {
    inline: { record: 'record-inline', data: { output: value } },
    kept: { record: 'record-kept', data: payloadMembers('output', chosen.payload) },
    content,
  };
}

interface CountedReads {
  readonly content: PayloadSource['content'];
  readonly gets: () => number;
}

const unreachable: PayloadSource['content']['get'] = () => Effect.die(new Error('connect ECONNREFUSED'));

function readsOf(content: PayloadSource['content']): CountedReads {
  const counted = { gets: 0 };
  return {
    content: {
      ...content,
      get: (asked, sha256) => {
        counted.gets += 1;
        return content.get(asked, sha256);
      },
    },
    gets: () => counted.gets,
  };
}

describe('the output of a run', () => {
  it('is read from the inline arm with no read of the store, and from its kept twin through the payload reader, the same', async () => {
    const twins = await twinsOf(output);
    const store = readsOf(twins.content);
    const outputs = runOutputsOf(payloadReaderOf({ owner, content: store.content }));

    const read = await Effect.runPromise(Effect.all([outputs.outputOf(twins.inline), outputs.outputOf(twins.kept)]));

    expect('output_sha256' in twins.kept.data).toBe(true);
    expect(read).toEqual([{ output }, { output }]);
    expect([outputs.reads(), store.gets()]).toEqual([1, 1]);
  });

  it('is read once for a record while it is kept, and again once newer records pushed it out', async () => {
    const twins = await twinsOf(output);
    const store = readsOf(twins.content);
    const outputs = runOutputsOf(payloadReaderOf({ owner, content: store.content }));

    await Effect.runPromise(outputs.outputOf(twins.kept));
    await Effect.runPromise(outputs.outputOf(twins.kept));
    await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: mostOutputsKept }, (_, each) => each),
        (index) => outputs.outputOf({ record: `record-${index}`, data: { output: index } }),
      ),
    );
    await Effect.runPromise(outputs.outputOf(twins.kept));

    expect(store.gets()).toBe(2);
  });
});

describe('an output that cannot be read', () => {
  it('is gone for good when its kept payload is not in the store, or is not JSON', async () => {
    const missing = await twinsOf(output, false);
    const text = textPayloadText('t'.repeat(mostInlinePayloadBytes + 1));
    const notJson = { ...text, sha256: sha256Of(text.text), bytes: textBytesOf(text.text) };
    const content = memoryRecordedContent();
    await Effect.runPromise(payloadKept(content, owner, notJson));

    const read = await Effect.runPromise(
      Effect.all([
        runOutputsOf(payloadReaderOf({ owner, content: missing.content })).outputOf(missing.kept),
        runOutputsOf(payloadReaderOf({ owner, content })).outputOf({
          record: 'record-text',
          data: { output_sha256: notJson.sha256, output_bytes: notJson.bytes },
        }),
      ]),
    );

    expect(read).toEqual([{ gone: 'not_held' }, { gone: 'not_its_kind' }]);
  });
});

describe('an output that is gone or never kept', () => {
  it('is gone for good when it was erased, larger than an output may be, or not recorded at all', async () => {
    const outputs = runOutputsOf({
      json: (kept) => Effect.fail(new PayloadErased({ ...owner, sha256: kept.sha256, message: 'erased' })),
    });

    const read = await Effect.runPromise(
      Effect.all([
        outputs.outputOf({ record: 'a', data: { output_sha256: 'a'.repeat(64), output_bytes: 3000 } }),
        outputs.outputOf({ record: 'b', data: { output_sha256: 'b'.repeat(64), output_bytes: mostOutputBytes + 1 } }),
        outputs.outputOf({ record: 'c', data: {} }),
      ]),
    );

    expect(read).toEqual([{ gone: 'erased' }, { gone: 'too_large' }, { gone: 'not_recorded' }]);
    expect(outputs.reads()).toBe(1);
  });
});

describe('an output in a store that cannot be reached', () => {
  it('is tried again later when the store cannot be reached, and read once it can', async () => {
    const twins = await twinsOf(output);
    const store = { get: unreachable };
    const outputs = runOutputsOf(
      payloadReaderOf({ owner, content: { ...twins.content, get: (asked, sha256) => store.get(asked, sha256) } }),
    );

    const failure = await Effect.runPromise(Effect.flip(outputs.outputOf(twins.kept)));
    store.get = twins.content.get;
    const read = await Effect.runPromise(outputs.outputOf(twins.kept));

    expect(failure).toMatchObject({ _tag: 'unavailable' });
    expect(read).toEqual({ output });
  });
});
