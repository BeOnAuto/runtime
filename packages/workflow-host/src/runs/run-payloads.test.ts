import { PayloadErased, payloadReaderOf, sharedPayloadsWithin, type PayloadReader } from '@on.auto/operations/payloads';
import { Effect, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';

import { keptOf, notesKept, storeOn, streamedIn } from '../payload-testing/kept-payloads.ts';
import { runKeyOf } from './run-address.ts';
import { hostRunPayloadsOf } from './run-payloads.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const alphaRun = runKeyOf({ org: 'acme', playbook: 'alpha', runId });

const betaRun = runKeyOf({ org: 'acme', playbook: 'beta', runId });

const answer = keptOf({ text: 'a'.repeat(20_000) });

function erasing(reader: PayloadReader): PayloadReader {
  return {
    ...reader,
    text: (kept) =>
      Effect.fail(new PayloadErased({ org: 'acme', playbook: 'alpha', sha256: kept.sha256, message: 'erased' })),
  };
}

describe('the store of payloads the host composes for its engine', () => {
  it('keeps a text in the playbook its run names and reads it back whole, which a run of another playbook reads as missing', async () => {
    const { payloads, notes } = storeOn();

    await Effect.runPromise(payloads.keep(alphaRun, [answer]));
    const inAlpha = await Effect.runPromise(payloads.read(alphaRun, [answer]));
    const inBeta = await Effect.runPromise(payloads.read(betaRun, [answer]));

    expect(inAlpha).toEqual(new Map([[answer.sha256, { kind: 'read', text: answer.text }]]));
    expect(inBeta).toEqual(new Map([[answer.sha256, { kind: 'missing' }]]));
    expect(notes()).toEqual([
      {
        kind: 'payloads_read',
        run: { org: 'acme', playbook: 'alpha', runId },
        texts: 1,
        bytes: answer.bytes,
        unread: 0,
      },
      {
        kind: 'payloads_read',
        run: { org: 'acme', playbook: 'beta', runId },
        texts: 1,
        bytes: 0,
        unread: 1,
      },
    ]);
  });

  it('offloads payloads exactly as the switch it is given says', () => {
    expect([storeOn(true).payloads.payloadOffloading, storeOn(false).payloads.payloadOffloading]).toEqual([
      true,
      false,
    ]);
  });
});

describe('the store of payloads the host composes, shared by the runs of its process', () => {
  it('answers a text it kept or read from the memory of its process, with no read of the store', async () => {
    const { payloads, gets } = storeOn();
    await Effect.runPromise(payloads.keep(alphaRun, [answer]));

    await Effect.runPromise(payloads.read(alphaRun, [answer]));

    expect(gets()).toBe(0);
  });

  it('reads a digest once for two runs of a playbook that ask for it at once', async () => {
    const counted = storeOn(true, sharedPayloadsWithin(0));
    await Effect.runPromise(counted.payloads.keep(alphaRun, [answer]));
    const held = counted.hold();

    const both = Effect.all([counted.payloads.read(alphaRun, [answer]), counted.payloads.read(alphaRun, [answer])], {
      concurrency: 2,
    });
    const fiber = Effect.runFork(both);
    await counted.whenAsked();
    held.release();
    const [first, second] = await Effect.runPromise(Fiber.join(fiber));

    expect([first, second, counted.gets()]).toEqual([first, first, 1]);
  });
});

describe('the store of payloads the host composes, when the store fails or answers in pieces', () => {
  it('fails as the content store’s outage, and asks the store nothing again until its gate opens', async () => {
    const failing = storeOn(true, sharedPayloadsWithin(0));
    failing.down(true);

    const read = await Effect.runPromise(Effect.flip(failing.payloads.read(alphaRun, [answer])));
    const kept = await Effect.runPromise(Effect.flip(failing.payloads.keep(alphaRun, [answer])));

    expect([read, kept]).toMatchObject([{ _tag: 'content_unavailable' }, { _tag: 'content_unavailable' }]);
    expect(failing.gets()).toBe(1);
  });

  it('answers erased for a payload its reader reads as erased', async () => {
    const { content } = storeOn();
    const payloads = hostRunPayloadsOf({
      content,
      payloadOffloading: true,
      shared: sharedPayloadsWithin(0),
      note: notesKept().note,
      readerOf: (source) => erasing(payloadReaderOf(source)),
    });

    const read = await Effect.runPromise(payloads.read(alphaRun, [answer]));

    expect(read).toEqual(new Map([[answer.sha256, { kind: 'erased' }]]));
  });

  it('hands back a text read in many pieces joined into one', async () => {
    const pieces = streamedIn(answer, 64);

    const read = await Effect.runPromise(pieces.payloads.read(alphaRun, [answer]));

    expect(read.get(answer.sha256)).toEqual({ kind: 'read', text: answer.text });
    expect(pieces.chunks()).toBe(Math.ceil(answer.bytes / 64));
  });
});
