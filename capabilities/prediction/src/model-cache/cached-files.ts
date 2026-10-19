import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface Shelved {
  readonly path: string;
  readonly bytes: number;
  readonly modifiedMs: number;
}

export interface WrittenFile {
  readonly sha256: string;
  readonly bytes: number;
}

const digestName = /^[0-9a-f]{64}$/u;

export async function written(stream: ReadableStream<Uint8Array>, path: string): Promise<WrittenFile> {
  const hash = createHash('sha256');
  const counted = { bytes: 0 };
  const file = await open(path, 'w');
  try {
    await stream.pipeTo(
      new WritableStream<Uint8Array>({
        write: async (chunk: Readonly<Uint8Array>) => {
          hash.update(chunk);
          counted.bytes += chunk.byteLength;
          await file.write(chunk);
        },
      }),
    );
  } finally {
    await file.close();
  }
  return { sha256: hash.digest('hex'), bytes: counted.bytes };
}

function digestOfFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk: Readonly<Uint8Array> | string) => {
        hash.update(chunk);
      })
      .on('error', reject)
      .on('end', () => {
        resolve(hash.digest('hex'));
      });
  });
}

async function shelvedIfWhole(path: string, sha256: string): Promise<Shelved | undefined> {
  const found = await stat(path).catch(() => null);
  if (found === null || !found.isFile() || (await digestOfFile(path)) !== sha256) {
    return undefined;
  }
  return { path, bytes: found.size, modifiedMs: found.mtimeMs };
}

async function verifiedEntry(directory: string, fileName: string, name: string): Promise<readonly Shelved[]> {
  const folder = join(directory, name);
  const whole = digestName.test(name) ? await shelvedIfWhole(join(folder, fileName), name) : undefined;
  if (whole === undefined) {
    await rm(folder, { recursive: true, force: true });
    return [];
  }
  return [whole];
}

export async function verifiedFilesIn(directory: string, fileName: string): Promise<readonly Shelved[]> {
  const names = await readdir(directory).catch((): readonly string[] => []);
  const found = await Promise.all(names.map((name) => verifiedEntry(directory, fileName, name)));
  return found.flat().toSorted((one, other) => one.modifiedMs - other.modifiedMs);
}
