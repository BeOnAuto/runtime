import { sha256Of, textToKeep } from '@on.auto/content';
import { memoryContentStore } from '@on.auto/content/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { PlaybookContext } from '../caller/playbook-context.ts';
import { PayloadOffloading } from '../payloads/payload-texts.ts';
import { PayloadsShared, sharedPayloadsWithin } from '../payloads/shared-payloads.ts';
import { memoryLedger } from '../testing/memory-ledger.ts';
import { playbookLedgerOf } from './playbook-ledger.ts';
import { playbookPayloadReader } from './playbook-reader.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const text = '{"query":"x"}';

const kept = { sha256: sha256Of(text), bytes: 13 };

interface CountedStore {
  readonly readTwice: Effect.Effect<readonly unknown[], unknown>;
  readonly reads: () => number;
}

async function aStoreCounted(failing: boolean): Promise<CountedStore> {
  const store = memoryContentStore();
  const counted = { reads: 0 };
  const { service } = memoryLedger(undefined, [], undefined, {
    ...store,
    read: (owner, sha256) =>
      Effect.suspend(() => {
        counted.reads += 1;
        return failing ? Effect.die(new Error('The bucket did not answer')) : store.read(owner, sha256);
      }),
  });
  await Effect.runPromise(service.content.put(alpha, textToKeep(text, 'application/json')));
  const readTwice = Effect.flatMap(playbookPayloadReader, (payloads) =>
    Effect.all([payloads.json(kept), payloads.json(kept)].map((read) => Effect.result(read))),
  ).pipe(Effect.provideContext(playbookLedgerOf(service, alpha)), Effect.provideService(PlaybookContext, alpha));
  return { readTwice, reads: () => counted.reads };
}

async function readsOf(failing: boolean, read: (twice: CountedStore['readTwice']) => Effect.Effect<unknown, unknown>) {
  const store = await aStoreCounted(failing);
  await Effect.runPromise(Effect.ignore(read(store.readTwice)));
  return store.reads();
}

const shared = (twice: CountedStore['readTwice']) =>
  twice.pipe(Effect.provideService(PayloadsShared, sharedPayloadsWithin(1024)));

describe('the reader of the payloads of the playbook of a call, given the payloads its process shares', () => {
  it('keeps what it read in the shared cache whatever the switch, which decides only whether new payloads are kept outside, and reads the store each time where its process shares none', async () => {
    const reads = [
      await readsOf(false, (twice) => shared(twice).pipe(Effect.provideService(PayloadOffloading, false))),
      await readsOf(false, (twice) => shared(twice).pipe(Effect.provideService(PayloadOffloading, true))),
      await readsOf(false, (twice) => twice.pipe(Effect.provideService(PayloadOffloading, true))),
    ];

    expect(reads).toEqual([1, 1, 2]);
  });

  it('holds the store back through the shared gate once it failed, whatever the switch, and asks it each time where its process shares none', async () => {
    const reads = [
      await readsOf(true, (twice) => shared(twice).pipe(Effect.provideService(PayloadOffloading, false))),
      await readsOf(true, (twice) => shared(twice).pipe(Effect.provideService(PayloadOffloading, true))),
      await readsOf(true, (twice) => twice.pipe(Effect.provideService(PayloadOffloading, false))),
    ];

    expect(reads).toEqual([1, 1, 2]);
  });
});
