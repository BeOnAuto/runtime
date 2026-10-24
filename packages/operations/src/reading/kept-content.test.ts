import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { PlaybookReader, keptContentOf, sha256Of, textToKeep, type RecordedEvent } from '../index.ts';
import {
  playbookBoundProjectionReader,
  playbookBoundRecordedReader,
  playbookBoundRunOutcomesReader,
  prefixedAges,
  prefixedReader,
} from '../ledger/bound-ports.ts';
import { nothingKept } from '../testing/index.ts';
import { memoryLedger } from '../testing/memory-ledger.ts';

const playbook = { org: 'acme', playbook: 'alpha' };

const at = '2026-10-05T09:00:00.000Z';

const texts = {
  a1: '{"query":"x"}',
  r1: '{"content":[]}',
  r2: '{"content":[{"type":"text","text":"large"}]}',
  m1: 'model weights',
};

const [a1, r1, r2, m1] = [sha256Of(texts.a1), sha256Of(texts.r1), sha256Of(texts.r2), sha256Of(texts.m1)];

function recordOf(data: unknown): RecordedEvent {
  return {
    id: 'm-1',
    cursor: 'c-1',
    causationId: null,
    correlationId: null,
    stream: 'runs/r-1',
    version: 1,
    globalPosition: 1,
    type: 'tool_call_answered',
    data,
    context: { at, by: 'playbook:alpha' },
    recordedAt: at,
  };
}

function keptOf(records: readonly RecordedEvent[], mostBytes: number, digests: readonly string[]) {
  const { service } = memoryLedger();
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* service.content.put(playbook, textToKeep(texts.a1, 'application/json'));
      yield* service.content.put(playbook, textToKeep(texts.r1, 'application/problem+json'));
      yield* service.content.put(playbook, textToKeep(texts.r2, 'text/plain; charset=utf-8'));
      yield* service.content.put(playbook, textToKeep(texts.m1, 'application/octet-stream'));
      const content = yield* keptContentOf(records, mostBytes);
      return digests.map((digest) => content(digest));
    }).pipe(
      Effect.provideService(
        PlaybookReader,
        PlaybookReader.of({
          ...prefixedReader(service, 'playbook/acme/alpha/'),
          ...prefixedAges(service, 'playbook/acme/alpha/'),
          ...playbookBoundRecordedReader(service, playbook),
          ...playbookBoundRunOutcomesReader(service, playbook),
          ...playbookBoundProjectionReader(service, playbook),
          readContent: (sha256) => service.content.get(playbook, sha256),
        }),
      ),
    ),
  );
}

describe('the content kept for the events of a read', () => {
  it('reads the content of every digest a fact has, by the size of the kept text, within the bound of the read', async () => {
    const records = [
      recordOf({ arguments_bytes: 13, arguments_sha256: a1 }),
      recordOf({ result_bytes: 14, result_sha256: r1 }),
      recordOf({ result_bytes: 9000, result_sha256: r2 }),
    ];

    await expect(keptOf(records, 4096, [a1, r1, r2])).resolves.toEqual([texts.a1, texts.r1, undefined]);
    await expect(keptOf(records, Infinity, [r2])).resolves.toEqual([texts.r2]);
  });

  it('joins no content that is not text or JSON, leaving its digest and size to show', async () => {
    const records = [
      recordOf({ result_bytes: 13, result_sha256: m1 }),
      recordOf({ arguments_bytes: 13, arguments_sha256: a1 }),
    ];

    await expect(keptOf(records, Infinity, [m1, a1])).resolves.toEqual([undefined, texts.a1]);
  });

  it('reads nothing for a fact that carries sizes and no digest, or for data that is not a fact of a call', async () => {
    const records = [
      recordOf({ arguments_bytes: 13 }),
      recordOf({ result_sha256: r1 }),
      recordOf({ result_bytes: 14, result_sha256: 7 }),
      recordOf('text'),
      recordOf({ result_bytes: 14, result_sha256: 'missing' }),
    ];

    await expect(keptOf(records, Infinity, [a1, r1, 'missing'])).resolves.toEqual([undefined, undefined, undefined]);
  });

  it('is nothing for any digest when a read kept no content', () => {
    expect([a1, r1].map((digest) => nothingKept(digest))).toEqual([undefined, undefined]);
  });
});
