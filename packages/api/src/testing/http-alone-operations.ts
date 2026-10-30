import { defineHttpOperation } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

const Nothing = Schema.Record(Schema.String, Schema.Never);

const readBlob = defineHttpOperation('playbook', 'query', {
  name: 'read_blob',
  title: 'Read blob',
  description: 'Reads a blob.',
  route: { method: 'GET', path: '/blobs/{name}' },
  body: { kind: 'none' },
  inputSchema: Schema.Struct({ name: Schema.String, label: Schema.optionalKey(Schema.String) }),
  outputSchema: Schema.Struct({ name: Schema.String, text: Schema.String }),
  reasons: [],
  handle: ({ name, label }) => Effect.succeed({ name, text: label ?? `blob ${name}` }),
});

const renameBlob = defineHttpOperation('playbook', 'command', {
  name: 'rename_blob',
  title: 'Rename blob',
  description: 'Renames a blob.',
  route: { method: 'POST', path: '/blobs/{name}/rename' },
  body: { kind: 'json' },
  inputSchema: Schema.Struct({ name: Schema.String, to: Schema.String }),
  outputSchema: Schema.Struct({ renamed: Schema.String }),
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
  outputSchema: Schema.Struct({ cleared: Schema.Boolean }),
  reasons: [],
  handle: () => Effect.succeed({ cleared: true }),
});

export const httpAloneOperations = [readBlob, renameBlob, clearBlobs];
