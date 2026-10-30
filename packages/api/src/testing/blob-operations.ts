import { contentOfText, defineHttpOperation, type StreamedBytes } from '@on.auto/operations';
import { Effect, Function, Schema } from 'effect';

const Nothing = Schema.Record(Schema.String, Schema.Never);

const Named = Schema.Struct({ name: Schema.String });

export const sourceFailure = 'The store failed at /var/lib/ledger/blobs, which no client may read';

const Labelled = Schema.Struct({ name: Schema.String, label: Schema.optionalKey(Schema.String) });

const keepBlob = defineHttpOperation('playbook', 'command', {
  name: 'keep_blob',
  title: 'Keep blob',
  description: 'Keeps a blob and answers it, or the label its query gives it.',
  route: { method: 'POST', path: '/blobs/{name}' },
  body: { kind: 'octet-stream', mostBytes: 1024 },
  inputSchema: Labelled,
  answer: { kind: 'stream', mediaType: 'application/octet-stream' },
  reasons: [],
  handle: ({ label }, body) =>
    Effect.succeed(label === undefined ? body : contentOfText(label, 'application/octet-stream')),
});

const keepRows = defineHttpOperation('playbook', 'command', {
  name: 'keep_rows',
  title: 'Keep rows',
  description: 'Keeps rows and answers them.',
  route: { method: 'PUT', path: '/rows/{name}' },
  body: { kind: 'csv', mostBytes: 1024 },
  inputSchema: Named,
  answer: { kind: 'stream', mediaType: 'text/csv' },
  reasons: [],
  handle: (_input, body) => Effect.succeed(body),
});

const readBlob = defineHttpOperation('playbook', 'query', {
  name: 'read_blob',
  title: 'Read blob',
  description: 'Reads a blob.',
  route: { method: 'GET', path: '/blobs/{name}' },
  body: { kind: 'none' },
  inputSchema: Named,
  answer: { kind: 'stream', mediaType: 'text/plain' },
  reasons: [],
  handle: ({ name }) => Effect.succeed(contentOfText(`blob ${name}`, 'application/octet-stream')),
});

const FailingAt = Schema.Struct({ when: Schema.Literals(['at-once', 'part-way', 'past-its-length']) });

const firstChunk = new TextEncoder().encode('first,');

function failing(when: (typeof FailingAt)['Type']['when']): StreamedBytes {
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      if (when !== 'at-once') {
        controller.enqueue(firstChunk);
      }
    },
    pull: (controller) => {
      controller.error(new Error(sourceFailure));
    },
  });
  return { stream, bytes: when === 'past-its-length' ? 3 : 100 };
}

const readFailingBlob = defineHttpOperation('playbook', 'query', {
  name: 'read_failing_blob',
  title: 'Read failing blob',
  description: 'Reads a blob whose store fails.',
  route: { method: 'GET', path: '/failing-blobs/{when}' },
  body: { kind: 'none' },
  inputSchema: FailingAt,
  answer: { kind: 'stream', mediaType: 'text/plain' },
  reasons: [],
  handle: ({ when }) => Effect.sync(() => failing(when)),
});

function blobReadOnce(name: string, path: `/${string}`, content: StreamedBytes) {
  return defineHttpOperation('playbook', 'query', {
    name,
    title: 'Read blob once',
    description: 'Reads a blob a test holds.',
    route: { method: 'GET', path },
    body: { kind: 'none' },
    inputSchema: Nothing,
    answer: { kind: 'stream', mediaType: 'text/plain' },
    reasons: [],
    handle: () => Effect.succeed(content),
  });
}

export const gatedBlobPath = '/v1/orgs/acme/playbooks/alpha/gated-blob';

export function gatedBlob(bytes: number, past: (controller: ReadableStreamDefaultController<Uint8Array>) => void) {
  const { promise: opened, resolve: open } = Promise.withResolvers<void>();
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(firstChunk);
    },
    pull: async (controller) => {
      await opened;
      past(controller);
    },
  });
  return { operation: blobReadOnce('read_gated_blob', '/gated-blob', { stream, bytes }), open };
}

export const silentBlobPath = '/v1/orgs/acme/playbooks/alpha/silent-blob';

export function silentBlob() {
  const { promise: pulled, resolve: pull } = Promise.withResolvers<void>();
  const { promise: cancelled, resolve: cancel } = Promise.withResolvers<boolean>();
  const stream = new ReadableStream<Uint8Array>(
    {
      pull: async () => {
        pull();
        await cancelled;
      },
      cancel: () => {
        cancel(true);
      },
    },
    { highWaterMark: 0 },
  );
  return { operation: blobReadOnce('read_silent_blob', '/silent-blob', { stream, bytes: 100 }), pulled, cancelled };
}

export function endlessBlob() {
  const { promise: cancelled, resolve } = Promise.withResolvers<boolean>();
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(firstChunk);
    },
    pull: () => cancelled.then(Function.constVoid),
    cancel: () => {
      resolve(true);
    },
  });
  return { operation: blobReadOnce('read_endless_blob', '/endless-blob', { stream, bytes: 1_000_000 }), cancelled };
}

const renameBlob = defineHttpOperation('playbook', 'command', {
  name: 'rename_blob',
  title: 'Rename blob',
  description: 'Renames a blob.',
  route: { method: 'POST', path: '/blobs/{name}/rename' },
  body: { kind: 'json' },
  inputSchema: Schema.Struct({ name: Schema.String, to: Schema.String }),
  answer: { kind: 'json', outputSchema: Schema.Struct({ renamed: Schema.String }) },
  reasons: [],
  handle: ({ to }) => Effect.succeed({ renamed: to }),
});

const clearBlobs = defineHttpOperation('playbook', 'command', {
  name: 'clear_blobs',
  title: 'Clear blobs',
  description: 'Clears the blobs.',
  route: { method: 'POST', path: '/blobs/clear' },
  body: { kind: 'none' },
  inputSchema: Nothing,
  answer: { kind: 'json', outputSchema: Schema.Struct({ cleared: Schema.Boolean }) },
  reasons: [],
  handle: () => Effect.succeed({ cleared: true }),
});

export const blobOperations = [keepBlob, keepRows, readBlob, readFailingBlob, renameBlob, clearBlobs];
