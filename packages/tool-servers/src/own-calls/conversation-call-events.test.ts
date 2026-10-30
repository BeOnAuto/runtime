import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { describe } from 'vitest';

import { ConversationCallEventSchema } from './conversation-call-events.ts';

const acted = { at: '2026-10-29T10:00:00.000Z', by: 'runtime' };

const onTheRun = {
  ...acted,
  runId: '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  definitionType: 'interaction',
  definitionName: 'confirm-order',
  definitionVersion: 2,
};

const ofTheCall = { call_id: 'call-1' };

const theConversation = {
  server: 'chat',
  connection_id: 'connection-1',
  tool: 'read_replies',
  conversation: 'thread-1',
  since: '2026-10-29T09:00:00.000Z',
};

const baseline: readonly (typeof ConversationCallEventSchema.Type)[] = [
  {
    type: 'telling_started',
    data: {
      ...ofTheCall,
      server: 'chat',
      connection_id: 'connection-1',
      tool: 'post_message',
      arguments_bytes: 80,
      arguments_sha256: 'a1b2c3',
    },
    context: onTheRun,
  },
  {
    type: 'telling_succeeded',
    data: {
      ...ofTheCall,
      result_bytes: 64,
      result_sha256: 'd4e5f6',
      duration_ms: 90,
      jsonrpc_id: 3,
      server_request_id: 'request-1',
    },
    context: onTheRun,
  },
  {
    type: 'telling_failed',
    data: {
      ...ofTheCall,
      detail: 'The server failed the call',
      duration_ms: 120,
      jsonrpc_id: 4,
      server_request_id: null,
      because: 'server_failure',
      result_bytes: 32,
      result_sha256: 'a7b8c9',
    },
    context: onTheRun,
  },
  {
    type: 'replies_read',
    data: {
      ...ofTheCall,
      ...theConversation,
      arguments_bytes: 40,
      arguments_sha256: 'b1c2d3',
      result_bytes: 900,
      result_sha256: 'e4f5a6',
      duration_ms: 70,
      jsonrpc_id: 5,
      server_request_id: 'request-2',
      replies: 3,
      taken: 1,
      refused: 1,
    },
    context: acted,
  },
  {
    type: 'reading_failed',
    data: {
      ...ofTheCall,
      ...theConversation,
      arguments_bytes: 40,
      arguments_sha256: 'b1c2d3',
      detail: 'The server asked the runtime to wait',
      duration_ms: 50,
      jsonrpc_id: 6,
      server_request_id: 'request-3',
      because: 'server_failure',
      retry_after_ms: 60_000,
      result_bytes: 16,
      result_sha256: 'c7d8e9',
    },
    context: acted,
  },
];

describe('the facts of the calls the runtime makes to tell a conversation and read its replies', () => {
  recordedFactsBehaviour({
    schema: ConversationCallEventSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.46.0': baseline },
  });
});
