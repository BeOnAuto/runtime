import { sha256Of, textToKeep } from '@on.auto/content';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  type ContentHolders,
  keptContentOf,
  mostShownFieldBytes,
  mostToolFieldBytes,
  PlaybookReader,
  type RecordedEvent,
  shownData,
} from '../index.ts';
import {
  playbookBoundAppendedFactsReader,
  playbookBoundProjectionReader,
  playbookBoundRecordedReader,
  playbookBoundRunOutcomesReader,
  prefixedAges,
  prefixedReader,
} from '../ledger/bound-ports.ts';
import { nothingKept } from '../testing/index.ts';
import { memoryLedger } from '../testing/memory-ledger.ts';

function textOfBytes(bytes: number): string {
  return 'a'.repeat(bytes - 2);
}

describe('the data of an event on a page', () => {
  it('shows a large field whole within 2 KiB, and as its size past it', () => {
    const data = { output: textOfBytes(mostShownFieldBytes), input: textOfBytes(mostShownFieldBytes + 1), number: 1 };

    expect(shownData(data, 'page')).toEqual({
      output: data.output,
      input_bytes: mostShownFieldBytes + 1,
      number: 1,
    });
  });

  it('leaves out a result, and the arguments past 2 KiB, whose sizes the fact already holds', () => {
    const data = {
      arguments_bytes: 5000,
      arguments: { query: textOfBytes(mostShownFieldBytes) },
      result_bytes: 40,
      result: { content: [] },
      answer: { rows: 2 },
    };

    expect(shownData(data, 'page')).toEqual({ arguments_bytes: 5000, result_bytes: 40, answer: { rows: 2 } });
  });

  it('replaces the largest field by its size first when the data would still pass 4 KiB', () => {
    const data = {
      input: textOfBytes(1500),
      output: textOfBytes(2000),
      record: textOfBytes(1800),
      answer: textOfBytes(1000),
    };

    expect(shownData(data, 'page')).toEqual({
      input: data.input,
      output_bytes: 2000,
      record_bytes: 1800,
      answer: data.answer,
    });
  });

  it('keeps data within 4 KiB as it is, and a published event shows its data or its size', () => {
    expect(shownData({ kind: 'cron' }, 'page')).toEqual({ kind: 'cron' });
    expect(shownData({ data: textOfBytes(3000) }, 'page')).toEqual({ data_bytes: 3000 });
  });
});

describe('the data of a model call on a page', () => {
  it('shows its messages, its response, the tool calls it asked for, its warnings, its issues and its repair by the same rule', () => {
    const data = {
      messages_bytes: 9000,
      messages: { said: textOfBytes(mostShownFieldBytes) },
      response_bytes: 20,
      response: [{ role: 'assistant' }],
      tool_calls: [{ call_id: textOfBytes(mostShownFieldBytes) }],
      warnings: [{ detail: textOfBytes(mostShownFieldBytes) }],
      issues: [],
      repair: { issues: [{ detail: textOfBytes(mostShownFieldBytes) }] },
    };

    expect(shownData(data, 'page')).toEqual({
      messages_bytes: 9000,
      response_bytes: 20,
      response: [{ role: 'assistant' }],
      tool_calls_bytes: mostShownFieldBytes + 14,
      warnings_bytes: mostShownFieldBytes + 13,
      issues: [],
      repair_bytes: mostShownFieldBytes + 24,
    });
  });
});

describe('the data of an event read whole', () => {
  it('shows every field whole', () => {
    const data = { output: textOfBytes(10_000), result: { content: [] } };

    expect(shownData(data, 'whole')).toBe(data);
  });

  it('as a tool shows every field that may be large whole within 64 KiB and as its size past it', () => {
    const data = {
      input: { asked: 'x' },
      output: textOfBytes(mostToolFieldBytes + 1),
      record: textOfBytes(mostToolFieldBytes),
      arguments_bytes: 12,
      arguments: { query: 'x' },
      result_bytes: mostToolFieldBytes * 2,
      result: textOfBytes(mostToolFieldBytes + 1),
      answer: textOfBytes(mostToolFieldBytes + 1),
    };

    expect(shownData(data, 'tool')).toEqual({
      input: { asked: 'x' },
      output_bytes: mostToolFieldBytes + 1,
      record: data.record,
      arguments_bytes: 12,
      arguments: { query: 'x' },
      result_bytes: mostToolFieldBytes * 2,
      answer_bytes: mostToolFieldBytes + 1,
    });
  });
});

const playbook = { org: 'acme', playbook: 'alpha' };

const at = '2026-10-05T09:00:00.000Z';

const texts = {
  a1: '{"query":"x"}',
  r1: '{"content":[]}',
  r2: '{"content":[{"type":"text","text":"large"}]}',
  m1: 'model weights',
};

const [a1, r1, r2, m1] = [sha256Of(texts.a1), sha256Of(texts.r1), sha256Of(texts.r2), sha256Of(texts.m1)];

function recordOf(data: unknown, type = 'tool_call_answered'): RecordedEvent {
  return {
    id: 'm-1',
    cursor: 'c-1',
    causationId: null,
    correlationId: null,
    stream: 'runs/r-1',
    version: 1,
    globalPosition: 1,
    type,
    data,
    context: { at, by: 'playbook:alpha' },
    recordedAt: at,
  };
}

function keptOf(
  records: readonly RecordedEvent[],
  mostBytes: number,
  digests: readonly string[],
  holders: ContentHolders = new Map(),
) {
  const { service } = memoryLedger();
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* service.content.put(playbook, textToKeep(texts.a1, 'application/json'));
      yield* service.content.put(playbook, textToKeep(texts.r1, 'application/problem+json'));
      yield* service.content.put(playbook, textToKeep(texts.r2, 'text/plain; charset=utf-8'));
      yield* service.content.put(playbook, textToKeep(texts.m1, 'application/octet-stream'));
      const content = yield* keptContentOf(records, mostBytes, holders);
      return digests.map((digest) => content(digest));
    }).pipe(
      Effect.provideService(
        PlaybookReader,
        PlaybookReader.of({
          ...prefixedReader(service, 'playbook/acme/alpha/'),
          ...prefixedAges(service, 'playbook/acme/alpha/'),
          ...playbookBoundRecordedReader(service, playbook),
          ...playbookBoundAppendedFactsReader(service, playbook),
          ...playbookBoundRunOutcomesReader(service, playbook),
          ...playbookBoundProjectionReader(service, playbook),
          readContent: (sha256) => service.content.get(playbook, sha256),
          readContentHead: (sha256) => service.content.getHead(playbook, sha256),
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

  it('passes over a payload a fact keeps outside, which only a reader of payloads reads, and reads the content beside it', async () => {
    const holders: ContentHolders = new Map([
      ['run_succeeded', { payloads: [{ sha256: '/output_sha256', bytes: '/output_bytes' }] }],
    ]);
    const records = [
      recordOf({ output_sha256: r2, output_bytes: 45, arguments_sha256: a1, arguments_bytes: 13 }, 'run_succeeded'),
    ];

    await expect(keptOf(records, 4096, [r2, a1], holders)).resolves.toEqual([undefined, texts.a1]);
    await expect(keptOf(records, 4096, [r2, a1])).resolves.toEqual([texts.r2, texts.a1]);
  });

  it('is nothing for any digest when a read kept no content', () => {
    expect([a1, r1].map((digest) => nothingKept(digest))).toEqual([undefined, undefined]);
  });
});
