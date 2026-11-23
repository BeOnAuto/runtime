import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { watchedUnlessGone } from './development-process.ts';

const log = '/data/ledger.db-wal';

function onChange(): void {}

function failingWith(code: string): Error {
  return Object.assign(new Error(`${code}: watch of the file failed`), { code });
}

function aWatchThatFails(failure: () => Error): () => never {
  return () => {
    throw failure();
  };
}

describe('the watch of a ledger log, which SQLite removes at a checkpoint or a close', () => {
  it('is the watch the platform made, for the path and the listener it was given', () => {
    const calls: unknown[][] = [];
    const watched = { close: onChange };

    const result = watchedUnlessGone(log, onChange, (path, listener) => {
      calls.push([path, listener]);
      return watched;
    });

    expect(result).toBe(watched);
    expect(calls).toEqual([[log, onChange]]);
  });

  it('is no watch where the platform says the file is gone, as when it was removed after it was last seen', () => {
    expect(
      watchedUnlessGone(
        log,
        onChange,
        aWatchThatFails(() => failingWith('ENOENT')),
      ),
    ).toBeUndefined();
  });

  it.each([
    ['another code', () => failingWith('EACCES')],
    ['no code', () => new Error('The watch failed')],
  ])('fails as the platform failed, where it fails with %s', (_, failure) => {
    expect(() => watchedUnlessGone(log, onChange, aWatchThatFails(failure))).toThrow(failure().message);
  });

  it('asks node itself by default, which says a file that is not there is gone', () => {
    const notThere = join(tmpdir(), `auto-runtime-${randomUUID()}`, 'ledger.db-wal');

    expect(watchedUnlessGone(notThere, onChange)).toBeUndefined();
  });
});
