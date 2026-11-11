import { describe, expect, it } from 'vitest';

import type { AnsweredOnce } from '../one-call/called-once.ts';
import { tellingEndedOf, tellingStartedOf } from './conversation-calls.ts';

const recorded = { by: 'playbook:alpha', at: '2026-10-08T09:00:05.000Z' };

const telling = {
  callId: 'call-2',
  runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  definition: { definitionType: 'interaction', definitionName: 'approve-brief', definitionVersion: 1 },
};

const theAnswer = { result_bytes: 61, result_sha256: 'b'.repeat(64), duration_ms: 7, jsonrpc_id: 2 };

const answeredAs = { kind: 'answered', retryAfterMs: null, mark: 'acts' } as const;

const answered: AnsweredOnce = {
  ...answeredAs,
  outcome: 'result',
  answer: { content: [] },
  answered: { ...theAnswer, is_error: false },
  detail: '',
};

const answeredWithAnError: AnsweredOnce = {
  ...answeredAs,
  outcome: 'tool_error',
  answered: { ...theAnswer, is_error: true },
  detail: 'channel_not_found',
};

const toldAs = { conversation: 'C0123', id: '1699.3' };

describe('a telling the playbook makes about a reply or an ending', () => {
  it('records what it is about and its form beside the call it sends', () => {
    const started = { server: 'chat', tool: 'add_reaction', arguments_bytes: 40 };

    expect(tellingStartedOf({ ...telling, about: 'taken', form: 'mark' }, started, recorded).event).toEqual({
      type: 'telling_started',
      data: { call_id: 'call-2', ...started, about: 'taken', form: 'mark' },
    });
  });
});

describe('a telling whose answer names the message it posted', () => {
  it('records that message where the call succeeded, so the playbook knows it as its own, and not where it failed', () => {
    expect([
      tellingEndedOf(telling, answered, recorded, toldAs).event,
      tellingEndedOf(telling, answeredWithAnError, recorded, toldAs).event,
    ]).toEqual([
      { type: 'telling_succeeded', data: { call_id: 'call-2', ...theAnswer, told_as: toldAs } },
      {
        type: 'telling_failed',
        data: { call_id: 'call-2', ...theAnswer, because: 'tool_error', detail: 'channel_not_found' },
      },
    ]);
  });
});
