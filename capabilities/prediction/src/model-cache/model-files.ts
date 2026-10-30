import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { cacheFolderMode, notTheBytesOfItsDigest, type StreamedContent } from '@on.auto/operations';
import { Effect } from 'effect';

import { verifiedFilesIn, written, type WrittenFile } from './cached-files.ts';

export interface CachedFile extends WrittenFile {
  readonly path: string;
}

export type ContentSource = () => Effect.Effect<StreamedContent | undefined>;

export interface CachedName {
  readonly sha256: string;
  readonly name: string;
}

export interface FileCache {
  readonly ready: () => Effect.Effect<void>;
  readonly pathOf: (file: CachedName, source: ContentSource) => Effect.Effect<string | undefined>;
  readonly received: (stream: ReadableStream<Uint8Array>, name: string) => Effect.Effect<CachedFile>;
}

export interface NamedFileCache {
  readonly pathOf: (sha256: string, source: ContentSource) => Effect.Effect<string | undefined>;
  readonly received: (stream: ReadableStream<Uint8Array>) => Effect.Effect<CachedFile>;
}

export interface FileCacheSettings {
  readonly directory: string;
  readonly mostBytes: number;
}

export const mostCachedBytes = 1_073_741_824;

export const rowsFileName = 'rows.csv';

export function modelFileName(format: string): string {
  return `model.${format}`;
}

function evictedOf(used: ReadonlyMap<string, number>, mostBytes: number, keep: string): readonly string[] {
  let left = [...used.values()].reduce((sum, bytes) => sum + bytes, 0);
  const gone: string[] = [];
  for (const [path, bytes] of used) {
    if (left > mostBytes && path !== keep) {
      gone.push(path);
      left -= bytes;
    }
  }
  return gone;
}

async function present(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

interface Shelf {
  readonly ready: () => Promise<void>;
  readonly used: () => ReadonlyMap<string, number>;
  readonly touched: (path: string, bytes: number) => void;
  readonly gone: (paths: readonly string[]) => Promise<unknown>;
}

function shelfIn(directory: string): Shelf {
  const used = new Map<string, number>();
  const opening: { ready?: Promise<void> } = {};
  const touched = (path: string, bytes: number) => {
    used.delete(path);
    used.set(path, bytes);
  };
  const filled = async () => {
    for (const { path, bytes } of await verifiedFilesIn(directory)) {
      touched(path, bytes);
    }
  };
  return {
    ready: () => (opening.ready ??= filled()),
    used: () => used,
    touched,
    gone: (paths) => {
      for (const path of paths) {
        used.delete(path);
      }
      return Promise.all(paths.map((path) => rm(dirname(path), { recursive: true, force: true })));
    },
  };
}

function placed(partial: string, path: string, name: string): Promise<unknown> {
  return rename(partial, dirname(path)).catch(() => rename(join(partial, name), path).catch(() => null));
}

export function namedCache(cache: FileCache, name: string): NamedFileCache {
  return {
    pathOf: (sha256, source) => cache.pathOf({ sha256, name }, source),
    received: (stream) => cache.received(stream, name),
  };
}

export function fileCache({ directory, mostBytes }: FileCacheSettings): FileCache {
  const shelf = shelfIn(directory);
  const { ready } = shelf;
  const pathFor = ({ sha256, name }: CachedName) => join(directory, sha256, name);
  const kept = async (file: WrittenFile, partial: string, name: string): Promise<CachedFile> => {
    const path = pathFor({ sha256: file.sha256, name });
    await placed(partial, path, name);
    if (!(await present(path))) {
      throw new Error(`The file cache could not keep ${file.sha256} in ${directory}`);
    }
    shelf.touched(path, file.bytes);
    await shelf.gone(evictedOf(shelf.used(), mostBytes, path));
    return { ...file, path };
  };
  const receivedInto = async (stream: ReadableStream<Uint8Array>, name: string): Promise<CachedFile> => {
    await ready();
    await mkdir(directory, { recursive: true, mode: cacheFolderMode });
    const partial = join(directory, `.${randomUUID()}`);
    await mkdir(partial, { mode: cacheFolderMode });
    try {
      return await kept(await written(stream, join(partial, name)), partial, name);
    } finally {
      await rm(partial, { recursive: true, force: true });
    }
  };
  const fetched = async (file: CachedName, content: StreamedContent): Promise<string> => {
    const received = await receivedInto(content.stream, file.name);
    if (received.sha256 !== file.sha256) {
      await shelf.gone([received.path]);
      throw notTheBytesOfItsDigest(file.sha256);
    }
    return received.path;
  };
  return {
    ready: () => Effect.promise(ready),
    received: (stream, name) => Effect.promise(() => receivedInto(stream, name)),
    pathOf: (file, source) =>
      Effect.gen(function* () {
        yield* Effect.promise(ready);
        const path = pathFor(file);
        const bytes = shelf.used().get(path);
        if (bytes !== undefined && (yield* Effect.promise(() => present(path)))) {
          shelf.touched(path, bytes);
          return path;
        }
        const content = yield* source();
        return content === undefined ? undefined : yield* Effect.promise(() => fetched(file, content));
      }),
  };
}
