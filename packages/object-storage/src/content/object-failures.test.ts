import { S3ServiceException } from '@aws-sdk/client-s3';
import { mostContentChunkBytes, sha256Of, textToKeep } from '@on.auto/operations';
import { alpha, generated, generatedStream, octets, refusalOf } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { uploadPartBytes } from '../s3/s3-bucket.ts';
import { fakeContentStore } from '../testing/fake-bucket.ts';

const location = { bucket: 'content', prefix: 'playbooks' };

const forbidden = new S3ServiceException({
  name: 'AccessDenied',
  $fault: 'client',
  $metadata: { httpStatusCode: 403 },
  message: 'Access Denied',
});

function failingAfter(bytes: number): ReadableStream<Uint8Array> {
  const source = generatedStream(bytes, 7).getReader();
  return new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      const { done, value } = await source.read();
      if (done) {
        controller.error(new Error('The connection dropped'));
        return;
      }
      controller.enqueue(value);
    },
  });
}

describe('a put on object storage that is refused', () => {
  it('deletes the upload of a content refused for its digest, and writes nothing of a refused content of one chunk', async () => {
    const store = fakeContentStore(location);
    const large = await generated(2_500_000);

    const refused = await Promise.all([
      refusalOf(store.content.put(alpha, { ...large.content(), expected: { sha256: sha256Of('another') } })),
      refusalOf(store.content.put(alpha, { ...textToKeep('small', octets), expected: { bytes: 6 } })),
    ]);

    expect(refused).toEqual([
      expect.objectContaining({ because: 'not_its_digest' }),
      expect.objectContaining({ because: 'not_its_size' }),
    ]);
    expect(store.bucket.asked().toSorted()).toEqual(['DeleteObjects', 'HeadObject', 'PutObject']);
    expect(store.bucket.keys()).toEqual([]);
  });

  it('aborts the multipart upload of a stream that fails part way, and keeps nothing', async () => {
    const store = fakeContentStore(location);

    const refused = await refusalOf(
      store.content.put(alpha, { stream: failingAfter(uploadPartBytes + mostContentChunkBytes), mediaType: octets }),
    );

    expect(refused).toMatchObject({ because: 'stream_failed' });
    expect(store.bucket.asked()).toContain('AbortMultipartUpload');
    expect([store.bucket.keys(), store.bucket.openUploads()]).toEqual([[], []]);
  });
});

describe('a put on object storage that its store fails', () => {
  it('fails as a defect when the store fails a part, aborting its upload and keeping nothing', async () => {
    const store = fakeContentStore(location);
    store.bucket.intercepting('UploadPartCommand', () => Promise.reject(new Error('The store went away')));

    const put = Effect.runPromise(store.content.put(alpha, (await generated(3 * uploadPartBytes)).content()));

    await expect(put).rejects.toThrow('The store went away');
    expect([store.bucket.keys(), store.bucket.openUploads()]).toEqual([[], []]);
  });

  it('fails as a defect when the store fails the write of an upload or its copy, deleting the upload', async () => {
    const writing = fakeContentStore(location);
    const copying = fakeContentStore(location);
    writing.bucket.intercepting('PutObjectCommand', () => Promise.reject(new Error('The store refused the upload')));
    copying.bucket.intercepting('CopyObjectCommand', () => Promise.reject(forbidden));
    const { content } = await generated(2_500_000);

    const puts = [
      Effect.runPromise(writing.content.put(alpha, content())),
      Effect.runPromise(copying.content.put(alpha, content())),
    ];

    await expect(puts[0]).rejects.toThrow('The store refused the upload');
    await expect(puts[1]).rejects.toThrow('Access Denied');
    expect([writing.bucket.keys(), copying.bucket.keys()]).toEqual([[], []]);
  });

  it('fails as a defect when the store refuses a read or cannot be reached, rather than answering nothing', async () => {
    const refusing = fakeContentStore(location);
    const unreachable = fakeContentStore(location);
    refusing.bucket.intercepting('GetObjectCommand', () => Promise.reject(forbidden));
    unreachable.bucket.intercepting('HeadObjectCommand', () => Promise.reject(new TypeError('fetch failed')));

    const reads = [
      Effect.runPromise(refusing.content.get(alpha, sha256Of('a'))),
      Effect.runPromise(unreachable.content.put(alpha, textToKeep('a', octets))),
    ];

    await expect(reads[0]).rejects.toThrow('Access Denied');
    await expect(reads[1]).rejects.toThrow('fetch failed');
  });
});
