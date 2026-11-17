import { sha256Of, textToKeep } from '@on.auto/content';
import { memoryContentStore } from '@on.auto/content/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { type PlaybookAddress, PlaybookContext } from '../caller/playbook-context.ts';
import { messageIdOf, streamPrefixOfPlaybook } from '../index.ts';
import { PayloadOffloading, textBytesOf, textPayloadText } from '../payloads/payload-texts.ts';
import { PayloadsShared, sharedPayloadsWithin } from '../payloads/shared-payloads.ts';
import { remarkedContext, remarkFacts, RemarkFactSchema } from '../projections/remark-rows.ts';
import { acmeAdmin, globexAdmin } from '../testing/callers.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { memoryLedger } from '../testing/memory-ledger.ts';
import { addNote, notebook, readNoteContent, readNoteEvent } from '../testing/notes.ts';
import type { Ledger } from './ledger.ts';
import { playbookLedgerOf, playbookReaderOf } from './playbook-ledger.ts';
import { playbookPayloadReader, PlaybookReader } from './playbook-reader.ts';
import { playbookPayloadKept, PlaybookWriter } from './playbook-writer.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const gamma = { org: 'globex', playbook: 'gamma' };

const text = 'n'.repeat(3000);

const toKeep = { ...textPayloadText(text), sha256: sha256Of(text), bytes: textBytesOf(text) };

const toAlpha = toPlaybook('acme', 'alpha');

const toGamma = toPlaybook('globex', 'gamma');

const textPlaybookReaderShared = '{"query":"x"}';

const kept = { sha256: sha256Of(textPlaybookReaderShared), bytes: 13 };

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
  await Effect.runPromise(service.content.put(alpha, textToKeep(textPlaybookReaderShared, 'application/json')));
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

const textPlaybookReader = '{"query":"x"}';

const keptPlaybookReader = { sha256: sha256Of(textPlaybookReader), bytes: 13 };

function payloadReadIn(service: Ledger['Service'], address: PlaybookAddress) {
  const read = Effect.flatMap(playbookPayloadReader, (payloads) => Effect.flip(payloads.json(keptPlaybookReader)));
  return Effect.runPromise(
    read.pipe(
      Effect.catch((value) => Effect.succeed(value)),
      Effect.provideContext(playbookLedgerOf(service, address)),
      Effect.provideService(PlaybookContext, address),
    ),
  );
}

const textPlaybookWriterShared = '{"query":"x"}';

const toKeepPlaybookWriterShared = {
  sha256: sha256Of(textPlaybookWriterShared),
  bytes: 13,
  text: textPlaybookWriterShared,
  mediaType: 'application/json',
};

async function heldAfterAPut(outside: boolean): Promise<string | undefined> {
  const sharedPlaybookWriterShared = sharedPayloadsWithin(1024);
  const { service } = memoryLedger();
  await Effect.runPromise(
    playbookPayloadKept(toKeepPlaybookWriterShared).pipe(
      Effect.provideContext(playbookLedgerOf(service, alpha)),
      Effect.provideService(PlaybookContext, alpha),
      Effect.provideService(PayloadsShared, sharedPlaybookWriterShared),
      Effect.provideService(PayloadOffloading, outside),
    ),
  );
  return sharedPlaybookWriterShared.cache.textOf(alpha, toKeepPlaybookWriterShared.sha256);
}

describe('the ledger of one playbook, for code that holds the whole ledger', () => {
  it("reads and writes that playbook's streams alone", async () => {
    const ledger = memoryLedger();
    const inAlpha = playbookLedgerOf(ledger.service, { org: 'acme', playbook: 'alpha' });
    const inGamma = playbookLedgerOf(ledger.service, { org: 'globex', playbook: 'gamma' });
    const noted = PlaybookWriter.use((writer) => writer.execute('notes', notebook, { name: 'anvil', text: 'heavy' }));
    const read = PlaybookReader.use((reader) => reader.load('notes', notebook));

    await Effect.runPromise(Effect.provideContext(noted, inAlpha));

    expect(ledger.streamNames()).toEqual(['playbook/acme/alpha/notes']);
    expect(await Effect.runPromise(Effect.provideContext(read, inAlpha))).toMatchObject({
      state: [{ name: 'anvil', text: 'heavy' }],
    });
    expect(await Effect.runPromise(Effect.provideContext(read, inGamma))).toMatchObject({ state: [] });
  });
});

describe('the keeper of the payloads of the playbook of a call', () => {
  it('keeps a payload in the content of that playbook alone, before a fact names it', async () => {
    const { service } = memoryLedger();
    await Effect.runPromise(
      playbookPayloadKept(toKeep).pipe(
        Effect.provideContext(playbookLedgerOf(service, alpha)),
        Effect.provideService(PlaybookContext, alpha),
      ),
    );
    const heads = Effect.all([
      service.content.getHead(alpha, toKeep.sha256),
      service.content.getHead(gamma, toKeep.sha256),
    ]);

    expect(await Effect.runPromise(heads)).toMatchObject([
      { bytes: 3000, mediaType: 'text/plain; charset=utf-8' },
      undefined,
    ]);
  });
});

describe('the read of one event, bound to a call', () => {
  it('reads an event of the playbook of the call by its id, its stream relative to the playbook, and none of another', async () => {
    const { dispatcher, run } = harness();
    await run(
      dispatcher.dispatchToPlaybook(addNote.registration, toAlpha(acmeAdmin, { name: 'anvil', text: 'heavy' })),
    );
    await run(
      dispatcher.dispatchToPlaybook(addNote.registration, toGamma(globexAdmin, { name: 'gear', text: 'round' })),
    );
    const ofAlpha = messageIdOf(`${streamPrefixOfPlaybook({ org: 'acme', playbook: 'alpha' })}notes`, 1);
    const ofGamma = messageIdOf(`${streamPrefixOfPlaybook({ org: 'globex', playbook: 'gamma' })}notes`, 1);

    expect(
      await Promise.all(
        [ofAlpha, ofGamma].map((id) =>
          run(dispatcher.dispatchToPlaybook(readNoteEvent.registration, toAlpha(acmeAdmin, { id }))),
        ),
      ),
    ).toEqual([
      { status: 'succeeded', output: { stream: 'notes', by: 'tester' } },
      { status: 'succeeded', output: { stream: null, by: null } },
    ]);
  });
});

describe('the read of a recorded content, bound to a call', () => {
  it('reads a content of the org of the call by its digest, and none of another org', async () => {
    const { dispatcher, ledger, run } = harness();
    const [digest, other] = await Promise.all([
      Effect.runPromise(
        Effect.map(
          ledger.service.content.put({ org: 'acme', playbook: 'alpha' }, textToKeep('{"rows":[]}', 'application/json')),
          ({ sha256 }) => sha256,
        ),
      ),
      Effect.runPromise(
        Effect.map(
          ledger.service.content.put({ org: 'globex', playbook: 'gamma' }, textToKeep('{}', 'application/json')),
          ({ sha256 }) => sha256,
        ),
      ),
    ]);

    expect(
      await Promise.all(
        [digest, other].map((sha256) =>
          run(dispatcher.dispatchToPlaybook(readNoteContent.registration, toAlpha(acmeAdmin, { sha256 }))),
        ),
      ),
    ).toEqual([
      { status: 'succeeded', output: { text: '{"rows":[]}' } },
      { status: 'succeeded', output: { text: null } },
    ]);
  });
});

describe('a fact read at its position', () => {
  it('is decoded by the schema given, in memory and through the reader of its playbook, and none before the first or past the last', async () => {
    const ledger = memoryLedger();
    await Effect.runPromise(
      ledger.service.execute('playbook/acme/alpha/remarks/r1', remarkFacts, [
        { type: 'remark_made', data: { text: 'first' } },
      ]),
    );
    const reader = playbookReaderOf(ledger.service, { org: 'acme', playbook: 'alpha' });
    const at = (position: number) => Effect.runPromise(reader.factAt('remarks/r1', position, RemarkFactSchema));

    expect([await at(1), await at(0), await at(2)]).toEqual([
      { type: 'remark_made', data: { text: 'first' }, context: remarkedContext },
      undefined,
      undefined,
    ]);
  });
});

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

describe('the reader of the payloads of the playbook of a call', () => {
  it('reads a payload that playbook keeps, and finds missing one that only another org keeps', async () => {
    const { service } = memoryLedger();
    await Effect.runPromise(service.content.put(gamma, textToKeep(textPlaybookReader, 'application/json')));

    expect([await payloadReadIn(service, gamma), await payloadReadIn(service, alpha)]).toMatchObject([
      { query: 'x' },
      {
        _tag: 'payload_missing',
        org: 'acme',
        playbook: 'alpha',
        sha256: keptPlaybookReader.sha256,
        because: 'not_held',
      },
    ]);
  });

  it('reads the head of that playbook, so a payload whose bytes are not found within the hour of its put may yet be read', async () => {
    const store = memoryContentStore();
    const { service } = memoryLedger(undefined, [], undefined, { ...store, read: () => Effect.undefined });
    await Effect.runPromise(service.content.put(alpha, textToKeep(textPlaybookReader, 'application/json')));

    expect(await payloadReadIn(service, alpha)).toMatchObject({ _tag: 'unavailable' });
  });
});

describe('the writer of the payloads of the playbook of a call, given the payloads its process shares', () => {
  it('holds a payload it kept in the set its process shares whatever the switch, which only its callers read', async () => {
    expect([await heldAfterAPut(false), await heldAfterAPut(true)]).toEqual([
      textPlaybookWriterShared,
      textPlaybookWriterShared,
    ]);
  });
});
