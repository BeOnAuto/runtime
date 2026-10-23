import { S3ServiceException, type S3Client } from '@aws-sdk/client-s3';
import { Data, Effect } from 'effect';

import type { ContentLocation } from '../location/content-location.ts';
import { bucketReached } from './bucket-requests.ts';

export class ObjectStoreUnreachable extends Data.TaggedError('object_store_unreachable')<{
  readonly bucket: string;
  readonly answer: string;
}> {}

function answerOf(failure: unknown): string {
  if (failure instanceof S3ServiceException) {
    return `${failure.name} (${String(failure.$metadata.httpStatusCode)})`;
  }
  return String(failure);
}

export function objectStoreReached(
  client: () => S3Client,
  { bucket }: ContentLocation,
): Effect.Effect<void, ObjectStoreUnreachable> {
  return Effect.tryPromise({
    try: () => bucketReached({ client, name: bucket }),
    catch: (failure) => new ObjectStoreUnreachable({ bucket, answer: answerOf(failure) }),
  });
}
