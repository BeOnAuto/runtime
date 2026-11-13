import { sha256Of } from '@on.auto/content';
import { jsonPayloadText } from '@on.auto/operations/payloads';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { ContentUnavailable } from '../run-log/content-unavailable.ts';
import { NoPayloadStore, noPayloadStore } from '../run-log/run-payloads.ts';
import { memoryPayloads } from './memory-payloads.ts';

const runId = 'the-run';

const { text, mediaType } = jsonPayloadText({ answer: 'y'.repeat(20_000) });

const payload = { sha256: sha256Of(text), bytes: text.length, text, mediaType };

const asked = { sha256: payload.sha256, bytes: payload.bytes };

describe('the store of payloads the tests use', () => {
  it('keeps a text under its digest and reads it back, and answers missing for a digest it never kept', () => {
    const store = memoryPayloads();
    const other = { sha256: 'f'.repeat(64), bytes: 1 };

    Effect.runSync(store.keep(runId, [payload]));
    const read = Effect.runSync(store.read(runId, [asked, other]));

    expect([...read]).toEqual([
      [payload.sha256, { kind: 'read', text }],
      [other.sha256, { kind: 'missing' }],
    ]);
    expect([store.keeps(), store.reads()]).toEqual([[[payload.sha256]], [[payload.sha256, other.sha256]]]);
  });

  it('fails its next read or keep as unavailable when told to, and then answers again', () => {
    const store = memoryPayloads();
    store.failNext('keep');
    store.failNext('read');

    expect([Effect.runSyncExit(store.keep(runId, [payload])), Effect.runSyncExit(store.read(runId, [asked]))]).toEqual([
      Exit.fail(new ContentUnavailable({ detail: 'The store of payloads was told to fail its next keep' })),
      Exit.fail(new ContentUnavailable({ detail: 'The store of payloads was told to fail its next read' })),
    ]);
    expect(Exit.isSuccess(Effect.runSyncExit(store.keep(runId, [payload])))).toBe(true);
  });

  it('answers a digest it was told to lose as missing or erased, though it keeps the text', () => {
    const store = memoryPayloads();
    Effect.runSync(store.keep(runId, [payload]));
    store.lose(payload.sha256, 'erased');

    expect(Effect.runSync(store.read(runId, [asked])).get(payload.sha256)).toEqual({ kind: 'erased' });
  });

  it('refuses, as a defect of the writer, a text that is not of the digest or size it is kept under', () => {
    const store = memoryPayloads();

    expect(Exit.isFailure(Effect.runSyncExit(store.keep(runId, [{ ...payload, bytes: 1 }])))).toBe(true);
    expect(Exit.isFailure(Effect.runSyncExit(store.keep(runId, [{ ...payload, text: '"other"' }])))).toBe(true);
    expect(store.texts().size).toBe(0);
  });
});

describe('the switch of the store of payloads the tests use', () => {
  it('keeps new values outside or not as it is switched, as a ring’s switch would', () => {
    const store = memoryPayloads();
    const switchedOn = store.payloadOffloading;
    store.switchTo(true);

    expect([switchedOn, store.payloadOffloading, memoryPayloads(true).payloadOffloading]).toEqual([false, true, true]);
  });
});

describe('the store of an engine composed with none', () => {
  it('keeps nothing outside, and dies if asked to read or keep, since no run of that engine names a payload', () => {
    expect(noPayloadStore.payloadOffloading).toBe(false);
    expect(Effect.runSyncExit(noPayloadStore.read(runId, [asked]))).toEqual(Exit.die(new NoPayloadStore({ runId })));
    expect(Effect.runSyncExit(noPayloadStore.keep(runId, [payload]))).toEqual(Exit.die(new NoPayloadStore({ runId })));
  });
});
