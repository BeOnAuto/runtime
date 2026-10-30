import { CreateBucketCommand, S3ServiceException } from '@aws-sdk/client-s3';
import { refusalOf, resultOf } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { fakeBucket } from '../testing/fake-bucket.ts';
import { bucketReady, testObjectStoreOf } from '../testing/test-object-store.ts';
import { objectStoreReached, ObjectStoreUnreachable } from './object-store-reached.ts';

const location = { bucket: 'content', prefix: 'playbooks' };

function refusedWith(name: string, httpStatusCode: number): S3ServiceException {
  return new S3ServiceException({ name, $fault: 'client', $metadata: { httpStatusCode }, message: 'UnknownError' });
}

function refused(): Error {
  return Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), { code: 'ECONNREFUSED' });
}

describe('the reach of the bucket of an object store', () => {
  it('is had when the store answers the bucket, and refused with the answer of the store otherwise', async () => {
    const bucket = fakeBucket();
    const client = bucket.client();
    bucket.intercepting('HeadBucketCommand', () => Promise.reject(refusedWith('AccessDenied', 403)));
    bucket.intercepting('HeadBucketCommand', () => Promise.reject(refused()));
    bucket.intercepting('HeadBucketCommand', () => Promise.reject(new Error('Region is missing')));

    const answers = [
      await refusalOf(objectStoreReached(() => client, location)),
      await refusalOf(objectStoreReached(() => client, location)),
      await refusalOf(objectStoreReached(() => client, location)),
      await refusalOf(objectStoreReached(() => client, { ...location, bucket: 'another' })),
    ];

    await expect(resultOf(objectStoreReached(() => client, location))).resolves.toBeUndefined();
    expect(answers).toEqual([
      new ObjectStoreUnreachable({ bucket: 'content', answer: 'AccessDenied (403)' }),
      new ObjectStoreUnreachable({ bucket: 'content', answer: 'Error: connect ECONNREFUSED 127.0.0.1:9' }),
      new ObjectStoreUnreachable({ bucket: 'content', answer: 'Error: Region is missing' }),
      new ObjectStoreUnreachable({ bucket: 'another', answer: 'NotFound (404)' }),
    ]);
  });
});

describe('the object store of the tests', () => {
  it('is read from a URL that names its endpoint, its credentials and its bucket, without reaching it', async () => {
    const store = testObjectStoreOf('http://content%2Dtest:a%2Fsecret@127.0.0.1:9000/content-test');

    expect([store.endpoint, store.accessKeyId, store.secretAccessKey, store.bucket.name]).toEqual([
      'http://127.0.0.1:9000',
      'content-test',
      'a/secret',
      'content-test',
    ]);
    expect(await store.bucket.client().config.credentials()).toMatchObject({
      accessKeyId: 'content-test',
      secretAccessKey: 'a/secret',
    });
  });

  it('has its bucket made when it is missing, and finds the bucket another made at the same moment', async () => {
    const bucket = fakeBucket();
    const client = () => bucket.client();
    bucket.intercepting('CreateBucketCommand', async (asked) => {
      await asked();
      throw refusedWith('BucketAlreadyOwnedByYou', 409);
    });

    await bucketReady({ client, name: 'raced' });
    await bucketReady({ client, name: 'missing' });
    await bucketReady({ client, name: 'missing' });

    expect(bucket.asked()).toEqual([
      'HeadBucket',
      'CreateBucket',
      'HeadBucket',
      'HeadBucket',
      'CreateBucket',
      'HeadBucket',
    ]);
    await expect(client().send(new CreateBucketCommand({ Bucket: 'missing' }))).rejects.toThrow(
      'BucketAlreadyOwnedByYou',
    );
  });
});
