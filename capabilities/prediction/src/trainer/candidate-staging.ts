import { open, type FileHandle } from 'node:fs/promises';

import type { Conflict } from '@on.auto/operations';
import { Effect } from 'effect';

import type { BuildState } from '../builds/build-state.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';
import { buildEnded } from './waiting-builds.ts';

const chunkBytes = 1_048_576;

function chunksOf(path: string): ReadableStream<Uint8Array> {
  const reading: { file?: Promise<FileHandle> } = {};
  return new ReadableStream<Uint8Array>(
    {
      pull: async (controller) => {
        reading.file ??= open(path);
        const file = await reading.file;
        const { bytesRead, buffer } = await file.read({ buffer: new Uint8Array(chunkBytes) });
        if (bytesRead > 0) {
          controller.enqueue(buffer.subarray(0, bytesRead));
          return;
        }
        await file.close();
        controller.close();
      },
      cancel: async () => {
        await (await reading.file)?.close();
      },
    },
    { highWaterMark: 0 },
  );
}

export function staged(
  ports: Pick<PredictionPorts, 'ledger'>,
  { address }: Pick<BuildState, 'address'>,
  path: string,
  sha256: string,
): Effect.Effect<void, Conflict> {
  const { org, playbook, id } = address;
  const stream = chunksOf(path);
  return ports.ledger.content
    .stage({ org, playbook }, id, { stream, mediaType: 'application/octet-stream', expected: { sha256 } })
    .pipe(
      Effect.asVoid,
      Effect.catchTags({ staging_ended: () => Effect.fail(buildEnded), content_refused: Effect.die }),
    );
}

export function stagedUnlessItIs(
  ports: Pick<PredictionPorts, 'ledger'>,
  build: Pick<BuildState, 'address'>,
  path: string,
  sha256: string,
): Effect.Effect<void, Conflict> {
  const { org, playbook, id } = build.address;
  return Effect.flatMap(ports.ledger.content.staged({ org, playbook }, id, sha256), (found) =>
    found === undefined ? staged(ports, build, path, sha256) : Effect.promise(() => found.stream.cancel()),
  );
}
