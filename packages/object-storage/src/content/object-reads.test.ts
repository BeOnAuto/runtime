import { CreateMultipartUploadCommand, ListBucketsCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { sha256Of, textOfContent, textToKeep } from '@on.auto/operations';
import { alpha, generated, octets, present, resultOf } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { objectKeysOf } from '../location/object-keys.ts';
import { bucketOnS3, uploadPartBytes } from '../s3/s3-bucket.ts';
import { fakeContentStore, type FakeContentStore } from '../testing/fake-bucket.ts';
import { openUploadsIn } from '../testing/test-object-store.ts';

const location = { bucket: 'content', prefix: 'playbooks' };

const keys = objectKeysOf(location);

function answeredWithout(store: FakeContentStore, command: string, field: 'Body' | 'ContentLength'): void {
  store.bucket.intercepting(command, async (asked) => ({ ...(await asked()), [field]: undefined }));
}

function stopped(): Promise<never> {
  return Promise.reject(new Error('The process stopped'));
}

function uploadIdAt(milliseconds: number): string {
  const time = milliseconds.toString(16).padStart(12, '0');
  return `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-000000000001`;
}

function objectWritten(store: FakeContentStore, key: string, body?: string): Promise<unknown> {
  const bytes = body === undefined ? {} : { Body: new TextEncoder().encode(body) };
  return store.client().send(new PutObjectCommand({ Bucket: location.bucket, Key: key, ...bytes }));
}

describe('a read on object storage', () => {
  it('answers nothing for a digest the playbook does not hold, and the default media type for an object kept without one', async () => {
    const store = fakeContentStore(location);
    await objectWritten(store, keys.kept(alpha, sha256Of('bare')), 'bare');

    const read = await present(store.content.get(alpha, sha256Of('bare')));

    expect(await resultOf(store.content.get(alpha, sha256Of('missing')))).toBeUndefined();
    expect([read.mediaType, await resultOf(textOfContent(read))]).toEqual([octets, 'bare']);
  });

  it('fails as a defect when the store answers an object without its body or its size', async () => {
    const store = fakeContentStore(location);
    const kept = await resultOf(store.content.put(alpha, textToKeep('kept', octets)));
    const key = keys.kept(alpha, kept.sha256);
    answeredWithout(store, 'GetObjectCommand', 'Body');
    answeredWithout(store, 'GetObjectCommand', 'ContentLength');
    answeredWithout(store, 'HeadObjectCommand', 'ContentLength');

    const bodiless = Effect.runPromise(store.content.get(alpha, kept.sha256));
    await expect(bodiless).rejects.toThrow(`The object store answered for ${key} without its body`);
    const sizeless = Effect.runPromise(store.content.get(alpha, kept.sha256));
    await expect(sizeless).rejects.toThrow(`The object store answered for ${key} without its size`);
    const headless = Effect.runPromise(store.content.put(alpha, textToKeep('kept', octets)));
    await expect(headless).rejects.toThrow(`The object store answered for ${key} without its size`);
  });
});

describe('the head of an object on object storage', () => {
  it('answers its size and media type, an object put over another without asking to keep the first, and the default media type for one kept without one', async () => {
    const store = fakeContentStore(location);
    const bucket = bucketOnS3({ client: store.client, name: location.bucket });
    await bucket.put('typed', { data: new TextEncoder().encode('first'), mediaType: 'text/plain' });
    await bucket.put('typed', { data: new TextEncoder().encode('typed'), mediaType: 'text/plain' });
    await objectWritten(store, 'bare', 'bare');

    expect([await bucket.head('typed'), await bucket.head('bare')]).toEqual([
      { bytes: 5, mediaType: 'text/plain' },
      { bytes: 4, mediaType: octets },
    ]);
  });
});

describe('the sweep of the uploads on object storage', () => {
  it('removes the uploads begun before its time a page at a time, and stops at the first begun after it', async () => {
    const store = fakeContentStore(location, { pageSize: 2 });
    const begun = [1, 2, 3, 5000, 6000].map((at) => keys.upload(uploadIdAt(at)));
    await Promise.all(begun.map((key) => objectWritten(store, key)));

    await store.sweepContent(4000);

    expect(store.bucket.keys()).toEqual(begun.slice(3));
    expect(store.bucket.asked().filter((asked) => asked === 'ListObjectsV2')).toHaveLength(2);
  });

  it('aborts the open multipart uploads begun before its time, a page at a time', async () => {
    const store = fakeContentStore(location, { pageSize: 2 });
    const { content } = await generated(2 * uploadPartBytes);
    [1, 2, 3].forEach(() => {
      store.bucket.intercepting('CompleteMultipartUploadCommand', stopped);
    });
    const puts = await Promise.all(
      [1, 2, 3].map(() =>
        Effect.runPromise(store.content.put(alpha, content())).then(
          () => 'kept',
          () => 'failed',
        ),
      ),
    );
    const open = store.bucket.openUploads();

    await store.sweepContent(Date.now() + 60_000);

    expect(puts).toEqual(['failed', 'failed', 'failed']);
    expect([open.length, store.bucket.openUploads()]).toEqual([3, []]);
  });
});

describe('the deletes of the sweep on object storage', () => {
  it('deletes what it removes a thousand objects at a time', async () => {
    const store = fakeContentStore(location, { pageSize: 600 });
    await Promise.all(Array.from({ length: 1001 }, (_, at) => objectWritten(store, keys.upload(uploadIdAt(at + 1)))));
    const before = store.bucket.asked().length;

    await store.sweepContent(4000);

    expect(
      store.bucket
        .asked()
        .slice(before)
        .filter((asked) => asked === 'DeleteObjects'),
    ).toHaveLength(2);
    expect(store.bucket.keys()).toEqual([]);
  });

  it('fails as a defect when the store keeps an object it was asked to delete', async () => {
    const store = fakeContentStore(location);
    const key = keys.upload(uploadIdAt(1));
    await objectWritten(store, key);
    store.bucket.intercepting('DeleteObjectsCommand', () =>
      Promise.resolve({ $metadata: {}, Errors: [{ Key: key, Code: 'AccessDenied' }] }),
    );

    await expect(store.sweepContent(4000)).rejects.toThrow(
      `The object store kept objects it was asked to delete: [{"Key":"${key}","Code":"AccessDenied"}]`,
    );
  });
});

describe('the fake bucket of these tests', () => {
  it('lists the open multipart uploads in the order of their keys and ids, a page at a time', async () => {
    const store = fakeContentStore(location, { pageSize: 1 });
    const begun = (key: string) =>
      store.client().send(new CreateMultipartUploadCommand({ Bucket: location.bucket, Key: key }));
    await begun('b');
    await begun('a');
    await begun('a');

    expect(await openUploadsIn({ client: store.client, name: location.bucket }, '')).toEqual(['a', 'a', 'b']);
  });

  it('answers no request it does not know', async () => {
    const store = fakeContentStore(location);

    await expect(store.client().send(new ListBucketsCommand({}))).rejects.toThrow('NotImplemented');
  });
});
