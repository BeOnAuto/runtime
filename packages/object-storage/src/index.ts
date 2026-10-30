export type { Bucket, ObjectBody, ObjectHead, ObjectRead, UnfinishedPut } from './bucket/bucket.ts';
export {
  storageClientOf,
  type StorageCredentials,
  type StorageEndpoint,
  type StorageWaits,
} from './client/storage-client.ts';
export { objectContentOn } from './content/object-content.ts';
export type { S3Bucket } from './s3/bucket-requests.ts';
export { objectStoreReached, ObjectStoreUnreachable } from './s3/object-store-reached.ts';
export { bucketOnS3 } from './s3/s3-bucket.ts';
