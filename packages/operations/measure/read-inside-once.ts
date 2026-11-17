import { argv, exit } from 'node:process';

import { Effect, Result } from 'effect';

import { readInside, type AssetHolding, type HeldAsset } from '../src/index.ts';

const [, , mebibytesGiven = '0', content = 'text'] = argv;

const bytes = Math.round(Number(mebibytesGiven) * 1_048_576);

const piece = 65_536;

const encoder = new TextEncoder();

const row = encoder.encode('{"row":1234567,"city":"Lyon","note":"a line of text in a row of rows"},');

function rowsOf(size: number): Uint8Array {
  const rows = new Uint8Array(size);
  for (let at = 0; at < size; at += row.byteLength) {
    rows.set(row.subarray(0, Math.min(row.byteLength, size - at)), at);
  }
  return rows;
}

function generated(total: number, json: boolean): ReadableStream<Uint8Array> {
  const filler = json ? rowsOf(piece - (piece % row.byteLength)) : encoder.encode('a'.repeat(piece));
  const opening = encoder.encode('[');
  const closing = encoder.encode('{}]');
  const inner = json ? total - opening.byteLength - closing.byteLength : total;
  let written = 0;
  return new ReadableStream<Uint8Array>({
    start: (controller: Readonly<ReadableStreamDefaultController<Uint8Array>>) => {
      if (json) {
        controller.enqueue(opening);
      }
    },
    pull: (controller: Readonly<ReadableStreamDefaultController<Uint8Array>>) => {
      const left = inner - written;
      if (left <= 0) {
        if (json) {
          controller.enqueue(closing);
        }
        controller.close();
        return;
      }
      const size = json ? Math.min(filler.byteLength, left - (left % row.byteLength)) : Math.min(piece, left);
      if (size === 0) {
        controller.enqueue(encoder.encode(' '.repeat(left)));
        written = inner;
        return;
      }
      controller.enqueue(filler.subarray(0, size));
      written += size;
    },
  });
}

const json = content === 'json';

const held: HeldAsset = {
  id: '019a5b12-0000-7000-8000-000000000001',
  mediaType: json ? 'application/json' : 'text/plain',
  bytes,
  sha256: 'a'.repeat(64),
  content: json ? 'json' : 'text',
  opened: () => Effect.succeed(generated(bytes, json)),
};

const holding: AssetHolding = { held: () => Effect.succeed(held) };

const reference = {
  id: held.id,
  media_type: held.mediaType,
  bytes,
  sha256: held.sha256,
  address: null,
  address_until: null,
};

const read = await Effect.runPromise(
  Effect.result(
    readInside({ kept: reference }, () => true, {
      holding,
      playbook: { org: 'acme', playbook: 'alpha' },
      bound: { most: bytes, unit: 'bytes', reader: 'a reader holds', remedy: 'give it less' },
    }),
  ),
);

exit(Result.isSuccess(read) ? 0 : 1);
