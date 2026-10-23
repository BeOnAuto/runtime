import type { S3Client, ServiceOutputTypes } from '@aws-sdk/client-s3';
import type { ContentStore } from '@on.auto/operations';
import { Schema } from 'effect';

import { storageClientOf, type StorageWaits } from '../client/storage-client.ts';
import { objectContentOn } from '../content/object-content.ts';
import type { ContentLocation } from '../location/content-location.ts';
import { bucketOnS3 } from '../s3/s3-bucket.ts';
import { answersOf, found, shelvesOf } from './fake-shelves.ts';

type Interceptor = (asked: () => Promise<ServiceOutputTypes>) => Promise<ServiceOutputTypes>;

export interface FakeBucket {
  readonly client: () => S3Client;
  readonly keys: () => readonly string[];
  readonly asked: () => readonly string[];
  readonly openUploads: () => readonly string[];
  readonly intercepting: (command: string, interceptor: Interceptor) => void;
}

export interface FakeBucketOptions {
  readonly name?: string;
  readonly pageSize?: number;
  readonly honoursConditionalCopy?: boolean;
}

export interface FakeContentStore extends ContentStore {
  readonly bucket: FakeBucket;
  readonly client: () => S3Client;
}

const handled = Schema.decodeUnknownSync(Schema.Struct({ commandName: Schema.String }));

const handledWith = Schema.decodeUnknownSync(Schema.Struct({ input: Schema.Unknown }));

const answeredAsAsked: Interceptor = (asked) => asked();

function clientAnswering(answerOf: (command: string, input: unknown) => Promise<ServiceOutputTypes>): S3Client {
  const client = storageClientOf(
    { endpoint: 'http://fake-bucket.invalid', region: 'us-east-1', proxy: { enabled: false, environment: {} } },
    { accessKeyId: 'fake', secretAccessKey: 'fake' },
  );
  client.middlewareStack.add(
    (_next: unknown, context: unknown) => async (args: unknown) => ({
      output: await answerOf(handled(context).commandName, handledWith(args).input),
      response: {},
    }),
    { step: 'initialize', name: 'fakeBucket', priority: 'low' },
  );
  return client;
}

export function fakeBucket({
  name = 'content',
  pageSize = 1000,
  honoursConditionalCopy = true,
}: FakeBucketOptions = {}): FakeBucket {
  const shelves = shelvesOf(name, pageSize);
  const answers = answersOf(shelves, honoursConditionalCopy);
  const asked: string[] = [];
  const interceptors = new Map<string, readonly Interceptor[]>();
  const answerOf = (command: string, input: unknown): Promise<ServiceOutputTypes> => {
    asked.push(command.replace(/Command$/u, ''));
    const [interceptor = answeredAsAsked, ...later] = interceptors.get(command) ?? [];
    interceptors.set(command, later);
    return interceptor(() => Promise.resolve().then(() => found(answers.get(command), 'NotImplemented')(input)));
  };
  return {
    client: () => clientAnswering(answerOf),
    keys: shelves.keys,
    asked: () => [...asked],
    openUploads: shelves.openKeys,
    intercepting: (command, interceptor) => {
      interceptors.set(command, [...(interceptors.get(command) ?? []), interceptor]);
    },
  };
}

export interface FakeContentOptions extends FakeBucketOptions {
  readonly waits?: StorageWaits;
}

export function fakeContentStore(
  location: ContentLocation,
  { waits, ...options }: FakeContentOptions = {},
): FakeContentStore {
  const bucket = fakeBucket({ name: location.bucket, ...options });
  const client = bucket.client();
  const answering = () => client;
  return {
    bucket,
    client: answering,
    ...objectContentOn(bucketOnS3({ client: answering, name: location.bucket }, waits), location),
  };
}
