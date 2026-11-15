import { describe, expect, it } from 'vitest';

import type { Bucket, UnfinishedPut } from '../bucket/bucket.ts';
import { objectKeysOf } from '../location/object-keys.ts';
import { sweptUploads } from './upload-sweep.ts';

const keys = objectKeysOf({ bucket: 'content', prefix: 'playbooks' });

const theFirstFreshUploadItLists = 1;

const askedOfNoSweep = () => Promise.reject(new Error('A sweep asks the bucket for its listings and deletes alone'));

const noUnfinishedPuts: AsyncIterable<UnfinishedPut> = {
  [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }),
};

interface StoreOptions {
  readonly pageSize?: number;
  readonly deletesAllowed?: number;
}

interface Paging {
  readonly pageAfter: (prefix: string, after: string) => readonly string[];
  readonly listedOne: (key: string) => void;
}

interface UploadsStored {
  readonly bucket: Bucket;
  readonly kept: () => readonly string[];
  readonly listed: () => number;
  readonly heldAtEachDelete: () => readonly number[];
}

function uploadIdAt(milliseconds: number): string {
  const time = milliseconds.toString(16).padStart(12, '0');
  return `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-000000000001`;
}

function uploadsBegunAt(times: readonly number[]): readonly string[] {
  return times.map((at) => keys.upload(uploadIdAt(at)));
}

function timesFrom(first: number, count: number): readonly number[] {
  return Array.from({ length: count }, (_, at) => first + at);
}

async function* listedAfter(paging: Paging, prefix: string, after: string): AsyncGenerator<string> {
  const page = await Promise.resolve(paging.pageAfter(prefix, after));
  const last = page.at(-1);
  if (last === undefined) {
    return;
  }
  for (const key of page) {
    paging.listedOne(key);
    yield key;
  }
  yield* listedAfter(paging, prefix, last);
}

function uploadsStoredAs(
  uploads: readonly string[],
  { pageSize = 1000, deletesAllowed = Number.POSITIVE_INFINITY }: StoreOptions = {},
): UploadsStored {
  const stored = new Set(uploads);
  const listedNotDeleted = new Set<string>();
  const heldAtEachDelete: number[] = [];
  let listed = 0;
  const paging: Paging = {
    pageAfter: (prefix, after) =>
      [...stored]
        .filter((key) => key.startsWith(prefix) && key > after)
        .toSorted()
        .slice(0, pageSize),
    listedOne: (key) => {
      listed += 1;
      listedNotDeleted.add(key);
    },
  };
  const deleted = (gone: readonly string[]): Promise<void> => {
    if (heldAtEachDelete.length === deletesAllowed) {
      return Promise.reject(new Error('The store refused the delete'));
    }
    heldAtEachDelete.push(listedNotDeleted.size);
    for (const key of gone) {
      stored.delete(key);
      listedNotDeleted.delete(key);
    }
    return Promise.resolve();
  };
  return {
    bucket: {
      put: askedOfNoSweep,
      get: askedOfNoSweep,
      getPart: askedOfNoSweep,
      head: askedOfNoSweep,
      delete: deleted,
      list: (prefix) => listedAfter(paging, prefix, ''),
      unfinished: () => noUnfinishedPuts,
    },
    kept: () => [...stored].toSorted(),
    listed: () => listed,
    heldAtEachDelete: () => [...heldAtEachDelete],
  };
}

describe('the sweep of uploads, a page at a time', () => {
  it('deletes each page of a thousand keys as it lists it, holding no more than a page of the keys it listed', async () => {
    const fresh = uploadsBegunAt([5000, 6000]);
    const store = uploadsStoredAs([...uploadsBegunAt(timesFrom(1, 2500)), ...fresh]);

    await sweptUploads(store.bucket, keys.uploads, 4000);

    expect(store.heldAtEachDelete()).toEqual([1000, 1000, 500 + theFirstFreshUploadItLists]);
    expect(store.kept()).toEqual(fresh);
  });

  it('lists no further than the first upload begun after its time', async () => {
    const store = uploadsStoredAs(uploadsBegunAt([1, 2, 5000, 6000, 7000]));

    await sweptUploads(store.bucket, keys.uploads, 4000);

    expect(store.listed()).toBe(3);
    expect(store.kept()).toEqual(uploadsBegunAt([5000, 6000, 7000]));
  });

  it('deletes a page that fills exactly with nothing after it, and no empty page', async () => {
    const fresh = uploadsBegunAt([5000]);
    const store = uploadsStoredAs([...uploadsBegunAt(timesFrom(1, 1000)), ...fresh]);

    await sweptUploads(store.bucket, keys.uploads, 4000);

    expect(store.heldAtEachDelete()).toEqual([1000]);
    expect(store.kept()).toEqual(fresh);
  });

  it('asks for no delete where no upload began before its time', async () => {
    const fresh = uploadsBegunAt([5000, 6000]);
    const store = uploadsStoredAs(fresh);

    await expect(sweptUploads(store.bucket, keys.uploads, 4000)).resolves.toBeUndefined();

    expect(store.heldAtEachDelete()).toEqual([]);
    expect(store.kept()).toEqual(fresh);
  });

  it('fails with the store’s own failure where it refuses a page, the pages before it staying deleted', async () => {
    const stale = uploadsBegunAt(timesFrom(1, 2500));
    const store = uploadsStoredAs(stale, { deletesAllowed: 1 });

    await expect(sweptUploads(store.bucket, keys.uploads, 4000)).rejects.toThrow('The store refused the delete');

    expect(store.kept()).toEqual(stale.slice(1000));
  });
});
