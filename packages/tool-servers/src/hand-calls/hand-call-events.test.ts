import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { describe } from 'vitest';

import { HandCallEventSchema } from './hand-call-events.ts';

const acted = { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' };

const ofTheCall = { call_id: 'call-1' };

const baseline: readonly (typeof HandCallEventSchema.Type)[] = [
  {
    type: 'tool_call_started',
    data: {
      ...ofTheCall,
      server: 'crm',
      connection_id: 'connection-1',
      tool: 'find_contact',
      arguments_bytes: 24,
      arguments_sha256: 'a1b2c3',
      read_only: true,
    },
    context: acted,
  },
  {
    type: 'tool_call_answered',
    data: {
      is_error: false,
      result_bytes: 512,
      result_sha256: 'd4e5f6',
      shown_bytes: 256,
      duration_ms: 140,
      jsonrpc_id: 7,
      server_request_id: 'request-1',
    },
    context: acted,
  },
  {
    type: 'tool_call_failed',
    data: {
      because: 'timed_out',
      detail: 'The server did not answer within 30 s',
      duration_ms: 30_000,
      jsonrpc_id: 'request-2',
      server_request_id: null,
      rate_limited: true,
    },
    context: acted,
  },
];

describe('the facts of the tool calls a person makes by hand', () => {
  recordedFactsBehaviour({
    schema: HandCallEventSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.46.0': baseline },
  });
});
