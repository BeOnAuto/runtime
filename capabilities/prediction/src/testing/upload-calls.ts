import { admittingMeter } from '@on.auto/definitions/testing';
import {
  allPermissions,
  contentOfBytes,
  contentOfText,
  makeDispatcher,
  settle,
  type RecordedContent,
  type Settled,
  type StreamedContent,
  type Succeeded,
} from '@on.auto/operations';
import {
  memoryLedger,
  memoryPlaybookRegistry,
  memoryRecordedContent,
  recordingReporter,
} from '@on.auto/operations/testing';
import { Effect, Layer } from 'effect';

import { uploadDataset } from '../upload/upload-dataset.ts';

export interface Uploading {
  readonly content: RecordedContent;
  readonly upload: (body: string | Readonly<Uint8Array>, sha256: string) => Promise<Settled<Succeeded>>;
  readonly uploadStream: (body: StreamedContent, sha256: string) => Promise<Settled<Succeeded>>;
}

export function chunked(chunks: readonly (readonly number[])[]): StreamedContent {
  const left = [...chunks];
  const stream = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      const next = left.shift();
      if (next === undefined) {
        controller.close();
      } else {
        controller.enqueue(new Uint8Array(next));
      }
    },
  });
  return { stream, bytes: chunks.flat().length, mediaType: 'text/csv' };
}

export function failingAfter(text: string): StreamedContent {
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(new TextEncoder().encode(text));
    },
    pull: (controller) => {
      controller.error(new Error('The client went away'));
    },
  });
  return { stream, bytes: 1000, mediaType: 'text/csv' };
}

const acmeAdmin = {
  id: 'acme-admin',
  name: 'acme-admin',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
} as const;

export function uploading(content: RecordedContent = memoryRecordedContent()): Uploading {
  const operation = uploadDataset(content);
  const services = Layer.mergeAll(
    memoryLedger().layer,
    memoryPlaybookRegistry([{ org: 'acme', playbook: 'alpha' }]),
    recordingReporter().layer,
    admittingMeter,
  );
  const dispatcher = makeDispatcher([]);
  const uploadStream = (body: StreamedContent, sha256: string) =>
    Effect.runPromise(
      settle(
        dispatcher.dispatchToPlaybook(operation.registration, {
          caller: acmeAdmin,
          org: 'acme',
          playbook: 'alpha',
          input: { sha256 },
          encoding: 'json',
          body,
        }),
      ).pipe(Effect.provide(services)),
    );
  return {
    content,
    upload: (body, sha256) =>
      uploadStream(
        typeof body === 'string' ? contentOfText(body, 'text/csv') : contentOfBytes(body, 'text/csv'),
        sha256,
      ),
    uploadStream,
  };
}
