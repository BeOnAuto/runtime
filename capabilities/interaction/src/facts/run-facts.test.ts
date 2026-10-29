import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { describe } from 'vitest';

import { InteractionRunFactSchema } from './run-facts.ts';

const onTheRun = {
  at: '2026-10-29T10:00:00.000Z',
  by: 'key_7f3a',
  runId: '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  definitionType: 'interaction',
  definitionName: 'confirm-order',
  definitionVersion: 2,
};

const numbered = { number: 1 };

const baseline: readonly (typeof InteractionRunFactSchema.Type)[] = [
  {
    type: 'delivery_started',
    data: {
      ...numbered,
      target: 'the buyer',
      server: 'chat',
      connection_id: 'connection-1',
      tool: 'post_message',
      arguments_bytes: 80,
      arguments_sha256: 'a1b2c3',
    },
    context: onTheRun,
  },
  {
    type: 'delivery_succeeded',
    data: {
      ...numbered,
      result_bytes: 64,
      result_sha256: 'd4e5f6',
      duration_ms: 90,
      jsonrpc_id: 3,
      server_request_id: 'request-1',
      delivered_as: { conversation: 'thread-1', id: 'message-1' },
      replies_in: { server: 'chat', tool: 'read_replies', key: 'thread-1' },
      detail: 'Posted to the thread',
    },
    context: onTheRun,
  },
  {
    type: 'delivery_failed',
    data: {
      ...numbered,
      because: 'timed_out',
      detail: 'The server did not answer within 30 s',
      retry_after_ms: 60_000,
      result_bytes: 0,
      result_sha256: 'a7b8c9',
      duration_ms: 30_000,
      jsonrpc_id: 4,
      server_request_id: null,
    },
    context: onTheRun,
  },
  {
    type: 'delivery_refused',
    data: { ...numbered, because: 'too_large', detail: 'The message is larger than 4 KiB', duration_ms: 2 },
    context: onTheRun,
  },
  {
    type: 'reply_refused',
    data: {
      server: 'chat',
      tool: 'read_replies',
      reply: { id: 'reply-1', sender: 'sender-1' },
      because: 'invalid',
      issues: [{ detail: 'Expected yes or no', pointer: '/answer' }],
      told: true,
    },
    context: onTheRun,
  },
];

describe('the facts an interaction function records on its run', () => {
  recordedFactsBehaviour({
    schema: InteractionRunFactSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.46.0': baseline },
  });
});
