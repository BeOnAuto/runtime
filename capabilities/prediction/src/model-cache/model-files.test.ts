import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { contentOfText, type StreamedContent } from '@on.auto/operations';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { scratchDirectory } from '../testing/scratch.ts';
import { fileCache, modelFileName, mostCachedBytes, rowsFileName, type ContentSource } from './model-files.ts';

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  return contentOfText(text, 'application/octet-stream').stream;
}

function sourceOf(text: string, heard: (asked: string) => void = () => {}): ContentSource {
  return () =>
    Effect.sync((): StreamedContent => {
      heard(text);
      return contentOfText(text, 'application/octet-stream');
    });
}

function noSource(heard: (asked: string) => void = () => {}): ContentSource {
  return () =>
    Effect.andThen(
      Effect.sync(() => {
        heard('nothing');
      }),
      Effect.undefined,
    );
}

const name = modelFileName('scripted');

function cacheIn(directory: string, mostBytes = 1024) {
  return fileCache({ directory, mostBytes });
}

function keptIn(directory: string, text: string, kept = name): string {
  return join(directory, digestOf(text), kept);
}

function cachedName(text: string, kept = name) {
  return { sha256: digestOf(text), name: kept };
}

function leftBehind(directory: string, folder: string, text: string, kept = name): string {
  mkdirSync(join(directory, folder), { recursive: true });
  const path = join(directory, folder, kept);
  writeFileSync(path, text);
  return path;
}

describe('the file cache of the model processes', () => {
  it('keeps a file it receives alone in a folder named by its digest, written whole before the folder is renamed in place', async () => {
    const directory = join(scratchDirectory(), 'models');
    const kept = await Effect.runPromise(cacheIn(directory).received(streamOf('a model'), name));

    expect(kept).toEqual({ sha256: digestOf('a model'), bytes: 7, path: keptIn(directory, 'a model') });
    expect([readdirSync(directory), readdirSync(join(directory, digestOf('a model')))]).toEqual([
      [digestOf('a model')],
      [name],
    ]);
    expect([statSync(directory).mode % 0o1000, statSync(join(directory, digestOf('a model'))).mode % 0o1000]).toEqual([
      0o700, 0o700,
    ]);
  });

  it('keeps the same bytes received twice once', async () => {
    const directory = scratchDirectory();
    const cache = cacheIn(directory);

    const both = await Promise.all([
      Effect.runPromise(cache.received(streamOf('twice'), name)),
      Effect.runPromise(cache.received(streamOf('twice'), name)),
    ]);

    expect([both.map(({ path }) => path), readdirSync(directory)]).toEqual([
      [keptIn(directory, 'twice'), keptIn(directory, 'twice')],
      [digestOf('twice')],
    ]);
  });
});

describe('the file cache of the model processes, under the name of each file', () => {
  it('keeps the same bytes under another name beside them, in the folder of their digest', async () => {
    const directory = scratchDirectory();
    const cache = cacheIn(directory);

    const named = await Effect.runPromise(cache.received(streamOf('both'), name));
    const renamed = await Effect.runPromise(cache.received(streamOf('both'), rowsFileName));

    expect([named.path, renamed.path]).toEqual([keptIn(directory, 'both'), keptIn(directory, 'both', rowsFileName)]);
    expect(readdirSync(join(directory, digestOf('both'))).toSorted()).toEqual([name, rowsFileName].toSorted());
  });

  it('finds a file it holds without asking its source, and fetches one it does not from the source, or finds none', async () => {
    const directory = scratchDirectory();
    const cache = cacheIn(directory);
    const asked: string[] = [];
    const heard = (text: string) => {
      asked.push(text);
    };
    await Effect.runPromise(cache.received(streamOf('held'), name));

    const held = await Effect.runPromise(cache.pathOf(cachedName('held'), sourceOf('never', heard)));
    const fetched = await Effect.runPromise(cache.pathOf(cachedName('fetched'), sourceOf('fetched', heard)));
    const missing = await Effect.runPromise(cache.pathOf(cachedName('missing'), noSource(heard)));

    expect([held, fetched, missing]).toEqual([keptIn(directory, 'held'), keptIn(directory, 'fetched'), undefined]);
    expect(asked).toEqual(['fetched', 'nothing']);
  });
});

describe('the file cache of the model processes that cannot keep a file', () => {
  it('refuses bytes that are not those of the digest asked, and keeps none of them', async () => {
    const directory = scratchDirectory();
    const cache = cacheIn(directory);

    const refused = await Effect.runPromiseExit(cache.pathOf(cachedName('asked'), sourceOf('other')));

    expect(Exit.hasDies(refused)).toBe(true);
    expect(readdirSync(directory)).toEqual([]);
  });

  it('fails a file it could not keep in place, as when another entry stands where its folder goes', async () => {
    const directory = scratchDirectory();
    const cache = cacheIn(directory);
    await Effect.runPromise(cache.ready());
    writeFileSync(join(directory, digestOf('blocked')), 'a file where the folder goes');

    expect(Exit.hasDies(await Effect.runPromiseExit(cache.received(streamOf('blocked'), name)))).toBe(true);
  });

  it('fails a file it could not keep, as when its folder cannot be written', async () => {
    const directory = scratchDirectory();
    writeFileSync(join(directory, 'models'), 'a file where the folder goes');

    expect(
      Exit.hasDies(await Effect.runPromiseExit(cacheIn(join(directory, 'models')).received(streamOf('kept'), name))),
    ).toBe(true);
  });
});

describe('the bytes the file cache of the model processes holds', () => {
  it('evict the files used least recently past them, with their folders, never the one it has just kept', async () => {
    const directory = scratchDirectory();
    const cache = cacheIn(directory, 25);
    await Effect.runPromise(cache.received(streamOf('first file'), name));
    await Effect.runPromise(cache.received(streamOf('second file'), name));
    await Effect.runPromise(cache.pathOf(cachedName('first file'), noSource()));
    await Effect.runPromise(cache.received(streamOf('third file'), name));
    const alone = cacheIn(scratchDirectory(), 4);
    const large = await Effect.runPromise(alone.received(streamOf('larger than the cache'), name));

    expect(readdirSync(directory).toSorted()).toEqual([digestOf('first file'), digestOf('third file')].toSorted());
    expect(existsSync(large.path)).toBe(true);
  });
});

describe('the file cache of the model processes at start', () => {
  it('takes the files a server left whose bytes are their digest, the oldest first to go, and removes every other entry', async () => {
    const directory = scratchDirectory();
    const older = leftBehind(directory, digestOf('older'), 'older');
    leftBehind(directory, digestOf('newer'), 'newer');
    leftBehind(directory, digestOf('tampered'), 'not the bytes of its name');
    leftBehind(directory, '.left-by-a-crash', 'partial');
    const beside = leftBehind(directory, digestOf('newer'), 'not the bytes of its folder', rowsFileName);
    const dangling = join(directory, digestOf('newer'), 'dangling');
    symlinkSync(join(directory, 'nowhere'), dangling);
    mkdirSync(join(directory, digestOf('empty')));
    writeFileSync(join(directory, 'stray.scripted'), 'stray');
    writeFileSync(join(directory, digestOf('a file')), 'a file named as a folder of a digest');
    utimesSync(older, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'));
    const asked: string[] = [];
    const heard = (text: string) => {
      asked.push(text);
    };
    const cache = cacheIn(directory, 10);
    await Effect.runPromise(cache.ready());
    const verified = readdirSync(directory).toSorted();

    const found = await Effect.runPromise(cache.pathOf(cachedName('newer'), sourceOf('never', heard)));
    await Effect.runPromise(cache.received(streamOf('next'), name));
    rmSync(join(directory, digestOf('next')), { recursive: true });
    const again = await Effect.runPromise(cache.pathOf(cachedName('next'), sourceOf('next', heard)));

    expect(verified).toEqual([digestOf('newer'), digestOf('older')].toSorted());
    expect([found, again, asked]).toEqual([keptIn(directory, 'newer'), keptIn(directory, 'next'), ['next']]);
    expect([existsSync(older), existsSync(beside), readdirSync(join(directory, digestOf('newer')))]).toEqual([
      false,
      false,
      [name],
    ]);
  });
});

describe('the file cache of the model processes, from nothing', () => {
  it('finds nothing in a folder that is not there yet, and creates none until it keeps a file', async () => {
    const directory = join(scratchDirectory(), 'not-yet');
    await Effect.runPromise(cacheIn(directory).ready());

    expect(existsSync(directory)).toBe(false);
  });

  it('removes what it was writing when the stream fails, and holds a gibibyte by default', async () => {
    const directory = scratchDirectory();
    const failing = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.error(new Error('The client went away'));
      },
    });

    expect(Exit.hasDies(await Effect.runPromiseExit(cacheIn(directory).received(failing, name)))).toBe(true);
    expect([readdirSync(directory), mostCachedBytes]).toEqual([[], 1_073_741_824]);
  });
});
