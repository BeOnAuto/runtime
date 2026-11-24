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

export const placeNamed: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_place_named',
    data: {
      connection: 'connection-1',
      connected_at: recordedAt,
      event_type: 'com.example.chat.post',
      subject: 'C0123',
      name: 'support',
    },
    context: { at: recordedAt, by: 'runtime' },
  },
];

export const identifiedInItsAccount: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_identified',
    data: {
      connection: 'connection-1',
      connected_at: recordedAt,
      user: { id: '7001', name: 'sam' },
      account: { id: 'T0042' },
    },
    context: { at: recordedAt, by: 'runtime' },
  },
];

export const playbooksSet: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_playbooks_set',
    data: { connection: 'connection-1', playbooks: ['sales', 'support'] },
    context: { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' },
  },
];

export const signingSecrets: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_signing_secret_set',
    data: { connection: 'connection-1', secret_id: 'secret-6', previous_until: '2026-10-30T10:00:00.000Z' },
    context: { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' },
  },
  {
    type: 'connection_signing_secret_removed',
    data: { connection: 'connection-1', which: 'previous' },
    context: { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' },
  },
];
