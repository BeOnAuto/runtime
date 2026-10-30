import { Readable } from 'node:stream';

import { S3ServiceException, type ServiceOutputTypes } from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/core/serde';
import { Schema } from 'effect';

interface FakeObject {
  readonly body: Readonly<Uint8Array>;
  readonly mediaType: string | undefined;
}

interface OpenUpload {
  readonly key: string;
  readonly mediaType: string | undefined;
  readonly parts: readonly (readonly [number, Readonly<Uint8Array>])[];
}

export interface Shelves {
  readonly objectAt: (key: string, name: string) => FakeObject;
  readonly keptFirst: (key: string, object: FakeObject, honoured: boolean, ifNoneMatch?: string) => void;
  readonly dropped: (key: string) => void;
  readonly keys: () => readonly string[];
  readonly uploadAt: (uploadId: string) => OpenUpload;
  readonly opened: (uploadId: string, upload: OpenUpload) => void;
  readonly closed: (uploadId: string) => void;
  readonly uploadIds: () => readonly string[];
  readonly openKeys: () => readonly string[];
  readonly buckets: Set<string>;
  readonly pageSize: number;
}

type Answer = (input: unknown) => ServiceOutputTypes;

const answered = { httpStatusCode: 200 };

const streamedPieceBytes = 65_536;

const keyed = Schema.decodeUnknownSync(Schema.Struct({ Key: Schema.String }));

const put = Schema.decodeUnknownSync(
  Schema.Struct({
    Key: Schema.String,
    Body: Schema.optional(Schema.Uint8Array),
    ContentType: Schema.optional(Schema.String),
    IfNoneMatch: Schema.optional(Schema.String),
  }),
);

const copy = Schema.decodeUnknownSync(
  Schema.Struct({ Key: Schema.String, CopySource: Schema.String, IfNoneMatch: Schema.optional(Schema.String) }),
);

const deleted = Schema.decodeUnknownSync(
  Schema.Struct({ Delete: Schema.Struct({ Objects: Schema.Array(Schema.Struct({ Key: Schema.String })) }) }),
);

const listed = Schema.decodeUnknownSync(
  Schema.Struct({ Prefix: Schema.String, ContinuationToken: Schema.optional(Schema.String) }),
);

const created = Schema.decodeUnknownSync(
  Schema.Struct({ Key: Schema.String, ContentType: Schema.optional(Schema.String) }),
);

const part = Schema.decodeUnknownSync(
  Schema.Struct({ UploadId: Schema.String, PartNumber: Schema.Number, Body: Schema.Uint8Array }),
);

const ofUpload = Schema.decodeUnknownSync(Schema.Struct({ UploadId: Schema.String }));

const listedUploads = Schema.decodeUnknownSync(
  Schema.Struct({
    Prefix: Schema.optional(Schema.String),
    KeyMarker: Schema.optional(Schema.String),
    UploadIdMarker: Schema.optional(Schema.String),
  }),
);

const ofBucket = Schema.decodeUnknownSync(Schema.Struct({ Bucket: Schema.String }));

function* piecesOf(body: Readonly<Uint8Array>): Generator<Buffer> {
  for (let start = 0; start < body.byteLength; start += streamedPieceBytes) {
    yield Buffer.from(body.subarray(start, start + streamedPieceBytes));
  }
}

function failure(name: string, httpStatusCode = 404): S3ServiceException {
  return new S3ServiceException({ name, $fault: 'client', $metadata: { httpStatusCode }, message: name });
}

export function found<A>(value: A | undefined, name: string): A {
  if (value === undefined) {
    throw failure(name);
  }
  return value;
}

function joined(parts: readonly Readonly<Uint8Array>[]): Uint8Array {
  const whole = new Uint8Array(parts.reduce((total, piece) => total + piece.byteLength, 0));
  parts.reduce((offset, piece) => {
    whole.set(piece, offset);
    return offset + piece.byteLength;
  }, 0);
  return whole;
}

function inByteOrder(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function pageOf<A>(sorted: readonly A[], after: (item: A) => boolean, size: number) {
  const rest = sorted.filter((item) => after(item));
  const page = rest.slice(0, size);
  return { page: page.length === 0 ? undefined : page, truncated: rest.length > size, last: page.at(-1) };
}

interface ListedUpload {
  readonly key: string;
  readonly uploadId: string;
}

function inUploadOrder(left: ListedUpload, right: ListedUpload): number {
  const byKey = inByteOrder(left.key, right.key);
  return byKey === 0 ? inByteOrder(left.uploadId, right.uploadId) : byKey;
}

function bucketAnswers({ buckets }: Shelves): Readonly<Record<string, Answer>> {
  return {
    HeadBucketCommand: (input) => {
      found(buckets.has(ofBucket(input).Bucket) ? buckets : undefined, 'NotFound');
      return { $metadata: answered };
    },
    CreateBucketCommand: (input) => {
      const { Bucket } = ofBucket(input);
      if (buckets.has(Bucket)) {
        throw failure('BucketAlreadyOwnedByYou', 409);
      }
      buckets.add(Bucket);
      return { $metadata: answered };
    },
  };
}

function objectAnswers(shelves: Shelves, honoursConditionalCopy: boolean): Readonly<Record<string, Answer>> {
  return {
    HeadObjectCommand: (input) => {
      const { body, mediaType } = shelves.objectAt(keyed(input).Key, 'NotFound');
      return { $metadata: answered, ContentLength: body.byteLength, ContentType: mediaType };
    },
    GetObjectCommand: (input) => {
      const { body, mediaType } = shelves.objectAt(keyed(input).Key, 'NoSuchKey');
      const stream = sdkStreamMixin(Readable.from(piecesOf(body)));
      return { $metadata: answered, Body: stream, ContentLength: body.byteLength, ContentType: mediaType };
    },
    PutObjectCommand: (input) => {
      const { Key, Body = new Uint8Array(), ContentType, IfNoneMatch } = put(input);
      shelves.keptFirst(Key, { body: Body, mediaType: ContentType }, true, IfNoneMatch);
      return { $metadata: answered };
    },
    CopyObjectCommand: (input) => {
      const { Key, CopySource, IfNoneMatch } = copy(input);
      const source = CopySource.split('/')
        .slice(1)
        .map((segment) => decodeURIComponent(segment))
        .join('/');
      shelves.keptFirst(Key, shelves.objectAt(source, 'NoSuchKey'), honoursConditionalCopy, IfNoneMatch);
      return { $metadata: answered };
    },
    DeleteObjectsCommand: (input) => {
      for (const { Key } of deleted(input).Delete.Objects) {
        shelves.dropped(Key);
      }
      return { $metadata: answered };
    },
    ListObjectsV2Command: (input) => {
      const { Prefix, ContinuationToken = '' } = listed(input);
      const keys = shelves.keys().filter((key) => key.startsWith(Prefix));
      const after = (key: string) => inByteOrder(key, ContinuationToken) > 0;
      const { page, truncated, last } = pageOf(keys, after, shelves.pageSize);
      const Contents = page?.map((key) => ({ Key: key }));
      return { $metadata: answered, Contents, IsTruncated: truncated, NextContinuationToken: last };
    },
  };
}

function uploadAnswers(shelves: Shelves): Readonly<Record<string, Answer>> {
  let made = 0;
  return {
    CreateMultipartUploadCommand: (input) => {
      const { Key, ContentType } = created(input);
      made += 1;
      const uploadId = `upload-${String(made).padStart(6, '0')}`;
      shelves.opened(uploadId, { key: Key, mediaType: ContentType, parts: [] });
      return { $metadata: answered, UploadId: uploadId };
    },
    UploadPartCommand: (input) => {
      const { UploadId, PartNumber, Body } = part(input);
      const upload = shelves.uploadAt(UploadId);
      shelves.opened(UploadId, { ...upload, parts: [...upload.parts, [PartNumber, Body]] });
      return { $metadata: answered, ETag: `"part-${String(PartNumber)}"` };
    },
    CompleteMultipartUploadCommand: (input) => {
      const { UploadId } = ofUpload(input);
      const { key, mediaType, parts } = shelves.uploadAt(UploadId);
      const ordered = parts.toSorted(([left], [right]) => left - right).map(([, piece]) => piece);
      shelves.keptFirst(key, { body: joined(ordered), mediaType }, false);
      shelves.closed(UploadId);
      return { $metadata: answered };
    },
    AbortMultipartUploadCommand: (input) => {
      shelves.closed(ofUpload(input).UploadId);
      return { $metadata: answered };
    },
    ListMultipartUploadsCommand: (input) => {
      const { Prefix = '', KeyMarker = '', UploadIdMarker = '' } = listedUploads(input);
      const open = shelves
        .uploadIds()
        .map((uploadId) => ({ key: shelves.uploadAt(uploadId).key, uploadId }))
        .filter(({ key }: ListedUpload) => key.startsWith(Prefix))
        .toSorted(inUploadOrder);
      const after = ({ key, uploadId }: ListedUpload) =>
        inUploadOrder({ key, uploadId }, { key: KeyMarker, uploadId: UploadIdMarker }) > 0;
      const { page, truncated, last } = pageOf(open, after, shelves.pageSize);
      const Uploads = page?.map(({ key, uploadId }: ListedUpload) => ({ Key: key, UploadId: uploadId }));
      return {
        $metadata: answered,
        Uploads,
        IsTruncated: truncated,
        NextKeyMarker: last?.key,
        NextUploadIdMarker: last?.uploadId,
      };
    },
  };
}

export function shelvesOf(bucket: string, pageSize: number): Shelves {
  const objects = new Map<string, FakeObject>();
  const uploads = new Map<string, OpenUpload>();
  return {
    objectAt: (key, name) => found(objects.get(key), name),
    keptFirst: (key, object, honoured, ifNoneMatch) => {
      if (honoured && ifNoneMatch === '*' && objects.has(key)) {
        throw failure('PreconditionFailed', 412);
      }
      objects.set(key, object);
    },
    dropped: (key) => {
      objects.delete(key);
    },
    keys: () => [...objects.keys()].toSorted(inByteOrder),
    uploadAt: (uploadId) => found(uploads.get(uploadId), 'NoSuchUpload'),
    opened: (uploadId, upload) => {
      uploads.set(uploadId, upload);
    },
    closed: (uploadId) => {
      uploads.delete(uploadId);
    },
    uploadIds: () => [...uploads.keys()],
    openKeys: () => [...uploads.values()].map(({ key }) => key),
    buckets: new Set([bucket]),
    pageSize,
  };
}

export function answersOf(shelves: Shelves, honoursConditionalCopy: boolean): ReadonlyMap<string, Answer> {
  return new Map(
    Object.entries({
      ...bucketAnswers(shelves),
      ...objectAnswers(shelves, honoursConditionalCopy),
      ...uploadAnswers(shelves),
    }),
  );
}
