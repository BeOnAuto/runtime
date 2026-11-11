import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Schema } from 'effect';

import { hostDatabaseOpenedOn } from './src/ledger-testing/ledger-connections.ts';
import { keptOf } from './src/payload-testing/kept-payloads.ts';
import { runKeyOf } from './src/runs/run-address.ts';
import { hostRunPayloadsOf, sharedPayloadsWithin } from './src/runs/run-payloads.ts';
import { databaseSettingsOf } from './src/testing/host-processes.ts';

const HeldIn = Schema.Union([
  Schema.Struct({ store: Schema.Literal('sqlite'), file: Schema.String }),
  Schema.Struct({ store: Schema.Literal('postgresql'), connectionString: Schema.String }),
  Schema.Struct({ store: Schema.Literal('pieces'), size: Schema.Number }),
]);

const [heldInText = '', shape = 'ascii', countText = '200'] = process.argv.slice(2);

const heldIn = Schema.decodeUnknownSync(Schema.fromJsonString(HeldIn))(heldInText);

const count = Number(countText);

const runKey = runKeyOf({ org: 'acme', playbook: 'alpha', runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' });

const letter = shape === 'ascii' ? 'a' : '漢';

const texts = Array.from({ length: count }, (_, index) => keptOf({ text: `${index}:${letter.repeat(36_000)}` }));

type Content = Parameters<typeof hostRunPayloadsOf>[0]['content'];

const utf8 = new TextEncoder();

function inPieces(size: number): Content {
  const { content } = memoryLedger().service;
  return {
    ...content,
    get: (owner, sha256) =>
      Effect.map(content.get(owner, sha256), (read) => {
        const kept = texts.find((each) => each.sha256 === sha256)?.text ?? '';
        const bytes = utf8.encode(kept);
        const pieces = Array.from({ length: Math.ceil(bytes.byteLength / size) }, (_, index) =>
          bytes.slice(index * size, (index + 1) * size),
        );
        const stream = new ReadableStream<Uint8Array>({
          pull: (controller) => {
            const piece = pieces.shift();
            if (piece === undefined) {
              controller.close();
            } else {
              controller.enqueue(piece);
            }
          },
        });
        return read === undefined ? undefined : { ...read, stream };
      }),
  };
}

async function contentOf(): Promise<{ readonly content: Content; readonly close: () => Promise<void> }> {
  if (heldIn.store === 'pieces') {
    return { content: inPieces(heldIn.size), close: () => Promise.resolve() };
  }
  const database = await hostDatabaseOpenedOn(databaseSettingsOf(heldIn));
  return { content: database.content, close: database.close };
}

function heapUsed(): number {
  globalThis.gc?.();
  globalThis.gc?.();
  return process.memoryUsage().heapUsed;
}

const { content, close } = await contentOf();
const store = (cacheBytes: number) =>
  hostRunPayloadsOf({
    content,
    keepsPayloadsOutside: true,
    shared: sharedPayloadsWithin(cacheBytes),
    note: () => Effect.void,
  });
await Effect.runPromise(store(0).keep(runKey, texts));
const reading = store(0);
const before = heapUsed();
const held = await Effect.runPromise(
  Effect.forEach(texts, (kept) => Effect.map(reading.read(runKey, [kept]), (read) => read.get(kept.sha256))),
);
const after = heapUsed();
const characters = held.reduce((sum, read) => sum + (read?.kind === 'read' ? read.text.length : 0), 0);
const counted = shape === 'ascii' ? characters : 2 * characters;
process.stdout.write(`${JSON.stringify({ texts: held.length, characters, counted, heap: after - before })}\n`);
await close();
