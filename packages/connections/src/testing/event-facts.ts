import { RecordedEventsSchema } from '@on.auto/providers';
import { throughItsTools } from '@on.auto/providers/testing';
import { Schema } from 'effect';

import type { ConnectionEventSchema } from '../registry/connection-events.ts';

export const givenItsEvents: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_added',
    data: {
      connection: 'connection-1',
      name: 'tracker',
      server_type: 'mcp',
      provider: null,
      placeholders: null,
      entry: { url: 'https://mcp.tracker.example.com/mcp' },
      credential: {
        kind: 'secret',
        name: 'Authorization',
        in: 'header',
        scheme: 'Bearer',
        instructions: 'Make a key under [Settings, API keys](https://tracker.example.com/settings/keys).',
        key_page: 'https://tracker.example.com/settings/keys',
      },
      says: {},
      events: Schema.decodeUnknownSync(RecordedEventsSchema)({ destinations: [throughItsTools] }),
      added_by: { id: 'key_7f3a', name: 'key_7f3a' },
    },
    context: { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' },
  },
];

const recordedAt = '2026-10-29T10:00:00.000Z';

export const identifiedByTheRuntime: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_identified',
    data: { connection: 'connection-1', connected_at: recordedAt, user: { id: '7001', name: 'sam' } },
    context: { at: recordedAt, by: 'runtime' },
  },
];
