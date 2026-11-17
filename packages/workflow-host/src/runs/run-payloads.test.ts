import { statement } from '@on.auto/ledger';
import { contentHoldersOf } from '@on.auto/operations';
import {
  PayloadErased,
  PayloadOffloading,
  type PayloadReader,
  payloadReaderOf,
  PayloadsShared,
  sharedPayloadsWithin,
} from '@on.auto/operations/payloads';
import {
  mostInlineHeldValueBytes,
  RunLogRecordSchema,
  snapshotOf,
  stateFormat,
  stateFormatKeepingPayloads,
} from '@on.auto/workflow-engine';
import { Cause, Context, Effect, Fiber, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { keptOf, notesKept, storeOn, streamedIn } from '../payload-testing/kept-payloads.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, onPostgreSQLAt, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { describeOnPostgreSQL } from '../testing/postgresql-databases.ts';
import { readingMeasured } from '../waiting-testing/measured-reads.ts';
import { ledgerRunLogStore } from './ledger-run-store.ts';
import { runKeyOf } from './run-address.ts';
import { HeldValueSizeThreshold, hostPayloadsOf, hostRunPayloadsOf } from './run-payloads.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const alphaRun = runKeyOf({ org: 'acme', playbook: 'alpha', runId });

const betaRun = runKeyOf({ org: 'acme', playbook: 'beta', runId });

const gammaRun = runKeyOf({ org: 'globex', playbook: 'gamma', runId });

const answer = keptOf({ text: 'a'.repeat(20_000) });

function erasing(reader: PayloadReader): PayloadReader {
  return {
    ...reader,
    text: (kept) =>
      Effect.fail(new PayloadErased({ org: 'acme', playbook: 'alpha', sha256: kept.sha256, message: 'erased' })),
  };
}

const alpha = { org: 'acme', playbook: 'alpha' };

const alphaRunComposedPayloads = runKeyOf({ ...alpha, runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' });

const value = { text: 'a'.repeat(20_000) };

const answerComposedPayloads = keptOf(value);

async function keptAndReadBy(outside: boolean) {
  const shared = sharedPayloadsWithin(1_048_576);
  const store = storeOn(true, shared);
  await Effect.runPromise(store.payloads.keep(alphaRunComposedPayloads, [answerComposedPayloads]));
  const payloads = hostPayloadsOf({
    content: store.content,
    context: Context.make(PayloadOffloading, outside).pipe(Context.add(PayloadsShared, shared)),
    note: notesKept().note,
  });
  const read = await Effect.runPromise(
    payloads.factsOf(alpha).json({ sha256: answerComposedPayloads.sha256, bytes: answerComposedPayloads.bytes }),
  );
  return { outside: payloads.runs.payloadOffloading, read, gets: store.gets() };
}

function thresholdComposedFrom(context: Context.Context<never>): number {
  return hostPayloadsOf({ content: storeOn().content, context, note: notesKept().note }).runs.payloadSizeThreshold;
}

const run = runAt('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b');

const large = 'x'.repeat(mostInlineHeldValueBytes + 1);

const holding = workflow(`
do:
  - hold: { set: '\${ ({ text: "x".repeat(${mostInlineHeldValueBytes + 1}) }) }' }
  - pause: { wait: PT1H }
`);

const runValuesKeptOutside = runAt(crypto.randomUUID());

const runLog = `run-logs/${runValuesKeptOutside.runId}`;

const holders = contentHoldersOf([RunLogRecordSchema]);

type DatabaseSettings = Parameters<typeof openedOn>[0];

const LogRows = Schema.Array(Schema.Struct({ data: Schema.String }));

const HeldRows = Schema.Array(
  Schema.Struct({ stream: Schema.String, held: Schema.Union([Schema.Finite, Schema.FiniteFromString]) }),
);

async function runLogOn(settings: DatabaseSettings) {
  const database = await openedOn(settings);
  const rows = await Effect.runPromise(
    database.read(
      statement`SELECT CAST(message_data AS TEXT) AS data FROM emt_messages WHERE stream_id LIKE ${`%${runLog}`}`,
    ),
  );
  return Schema.decodeUnknownSync(LogRows)(rows).map(({ data }) => data);
}

async function heldOn(settings: DatabaseSettings) {
  const database = await openedOn(settings);
  const rows = await Effect.runPromise(database.read(statement`SELECT stream, held FROM content_references_2`));
  return Schema.decodeUnknownSync(HeldRows)(rows).filter(({ stream }) => stream === runLog);
}

async function startedKeeping(settings: DatabaseSettings): Promise<void> {
  const hosted = await hostedOn(settings, { context: Context.make(PayloadOffloading, true) });
  await Effect.runPromise(hosted.host.start(runValuesKeptOutside, startOf(holding)));
}

const runSnapshotChunks = runAt('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a');

const waiting = workflow('do:\n  - pause: { wait: PT1H }');

const detailOf = Schema.decodeUnknownSync(Schema.Struct({ detail: Schema.String }));

function defectOf<A, E>(work: Effect.Effect<A, E>): Promise<unknown> {
  return Effect.runPromise(Effect.flip(Effect.sandbox(work))).then((cause) => Cause.squash(cause));
}

describe('the store of payloads the host composes for its engine', () => {
  it('keeps a text in the org of the playbook its run names and reads it back whole, which a run of another playbook of that org reads too and a run of another org reads as missing', async () => {
    const { payloads, notes } = storeOn();

    await Effect.runPromise(payloads.keep(alphaRun, [answer]));
    const read = await Promise.all(
      [alphaRun, betaRun, gammaRun].map((runRunPayloads) => Effect.runPromise(payloads.read(runRunPayloads, [answer]))),
    );

    expect(read).toEqual([
      new Map([[answer.sha256, { kind: 'read', text: answer.text }]]),
      new Map([[answer.sha256, { kind: 'read', text: answer.text }]]),
      new Map([[answer.sha256, { kind: 'missing' }]]),
    ]);
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
        bytes: answer.bytes,
        unread: 0,
      },
      { kind: 'payloads_read', run: { org: 'globex', playbook: 'gamma', runId }, texts: 1, bytes: 0, unread: 1 },
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
      payloadSizeThreshold: mostInlineHeldValueBytes,
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

describe('the threshold past which the host keeps a value its runs hold outside their logs', () => {
  it('is the one its runtime gives, and the engine’s own where it gives none', () => {
    expect([
      thresholdComposedFrom(Context.make(HeldValueSizeThreshold, 4096)),
      thresholdComposedFrom(Context.empty()),
    ]).toEqual([4096, mostInlineHeldValueBytes]);
  });
});

describe('the payloads the host composes from the context of its runtime', () => {
  it('read a value kept earlier through the set its runtime shares whatever the switch, which decides only whether new values are kept outside', async () => {
    expect([await keptAndReadBy(false), await keptAndReadBy(true)]).toEqual([
      { outside: false, read: value, gets: 0 },
      { outside: true, read: value, gets: 0 },
    ]);
  });
});

describe('the engine the host composes', () => {
  it('keeps every value a run holds inline in its log, past the size a store of payloads would keep outside, writing format 11, while payloads are not kept outside', async () => {
    const file = aSQLiteFile();
    const hosted = await hostedOn({ store: 'sqlite', file });
    await Effect.runPromise(hosted.host.start(run, startOf(holding)));

    const stored = await Effect.runPromise(
      ledgerRunLogStore(await openedOn({ store: 'sqlite', file })).load(runKeyOf(run)),
    );

    expect(stored.tail.map(({ event }) => [event.format, 'kept' in event])).toEqual([[stateFormat, false]]);
    expect(JSON.stringify(stored.tail)).toContain(large);
  });
});

describe('the engine the host composes where payloads are kept outside', () => {
  it('keeps a value past the threshold outside its log, writing format 12, and the ledger holds it for the log in the append', async () => {
    const settings = { store: 'sqlite', file: aSQLiteFile(), holders } as const;
    await startedKeeping(settings);

    const log = await runLogOn(settings);

    expect(log.map((data) => data.includes(`"format":${stateFormatKeepingPayloads}`))).toEqual([true]);
    expect(log.join('')).not.toContain(large);
    expect(await heldOn(settings)).toEqual([{ stream: runLog, held: 1 }]);
  });
});

describeOnPostgreSQL('the engine the host composes where payloads are kept outside', (aDatabase) => {
  it('keeps it outside and holds it the same way', async () => {
    const settings = { ...onPostgreSQLAt(await aDatabase()), holders };
    await startedKeeping(settings);

    const log = await runLogOn(settings);

    expect(log.join('')).not.toContain(large);
    expect(await heldOn(settings)).toEqual([{ stream: runLog, held: 1 }]);
  });
});

describe('the run store of the host, refusing', () => {
  it('refuses to load a run whose snapshot does not decode', async () => {
    const file = aSQLiteFile();
    const hosted = await hostedOn({ store: 'sqlite', file });
    await Effect.runPromise(hosted.host.start(runSnapshotChunks, startOf(waiting)));
    const database = await openedOn({ store: 'sqlite', file });
    await Effect.runPromise(
      database.write(
        statement`INSERT INTO workflow_snapshot_chunks (run_key, version, chunk, chunks, bytes, text)
          VALUES (${runKeyOf(runSnapshotChunks)}, ${1}, ${0}, ${1}, ${2}, ${'{}'})`,
      ),
    );

    const defect = await defectOf(ledgerRunLogStore(database).load(runKeyOf(runSnapshotChunks)));

    expect(detailOf(defect).detail).toContain('A snapshot of the run does not decode');
  });

  it('refuses a snapshot of an event its log does not hold yet', async () => {
    const file = aSQLiteFile();
    const hosted = await hostedOn({ store: 'sqlite', file });
    await Effect.runPromise(hosted.host.start(runSnapshotChunks, startOf(waiting)));
    const state = await Effect.runPromise(hosted.host.stateOf(runSnapshotChunks));
    const runStore = ledgerRunLogStore(await openedOn({ store: 'sqlite', file }));

    const defect = await defectOf(runStore.saveSnapshot(snapshotOf(state, 2, stateFormat)));

    expect(defect).toEqual(new RangeError('A snapshot at version 2 of a run whose log holds 1 events'));
  });
});

describe('the run store of the host, saving a snapshot', () => {
  it('learns that its log holds the event from the version of the log, reading nothing of the event', async () => {
    const file = aSQLiteFile();
    const hosted = await hostedOn({ store: 'sqlite', file });
    await Effect.runPromise(hosted.host.start(runSnapshotChunks, startOf(waiting, { text: 'x'.repeat(100 * 1024) })));
    const state = await Effect.runPromise(hosted.host.stateOf(runSnapshotChunks));
    const measured = readingMeasured(await openedOn({ store: 'sqlite', file }));

    await Effect.runPromise(ledgerRunLogStore(measured.database).saveSnapshot(snapshotOf(state, 1, stateFormat)));
    const read = measured.bytesRead();
    const { snapshot } = await Effect.runPromise(
      ledgerRunLogStore(measured.database).load(runKeyOf(runSnapshotChunks)),
    );

    expect([read, snapshot?.snapshot.version]).toEqual([0, 1]);
  });
});
