import { recordingOf } from '@on.auto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { CallAnswered } from '../calls/call-facts.ts';
import type { AnsweredOnce, CalledOnce } from '../one-call/called-once.ts';
import { ConversationCallEventSchema, conversationCallStreamOf } from './conversation-call-events.ts';
import {
  conversationCallDecider,
  readingFailedOf,
  repliesReadOf,
  tellingEndedOf,
  tellingStartedOf,
  type ConversationCall,
} from './conversation-calls.ts';

const recorded = { by: 'playbook:alpha', at: '2026-10-08T09:00:05.000Z' };

const reference = { server: 'chat', tool: 'thread_replies' };

const started = { ...reference, arguments_bytes: 40, arguments_sha256: 'a'.repeat(64) };

const answeredFact: CallAnswered = {
  is_error: false,
  result_bytes: 61,
  result_sha256: 'b'.repeat(64),
  duration_ms: 7,
  jsonrpc_id: 2,
};

const theAnswer = {
  result_bytes: 61,
  result_sha256: 'b'.repeat(64),
  duration_ms: 7,
  jsonrpc_id: 2,
};

const answeredAs = { kind: 'answered', retryAfterMs: null, annotations: { readOnlyHint: true } } as const;

const answered: AnsweredOnce = {
  ...answeredAs,
  outcome: 'result',
  answer: { content: [] },
  answered: answeredFact,
  detail: '',
};

const answeredWithAnError: AnsweredOnce = {
  ...answeredAs,
  outcome: 'tool_error',
  answered: { ...answeredFact, is_error: true },
  detail: 'No such thread',
};

function failedAs(because: 'arguments_refused' | 'server_failure' | 'too_large'): AnsweredOnce {
  return {
    ...answeredAs,
    outcome: because,
    failed: { because, detail: 'Refused', duration_ms: 3, jsonrpc_id: 4 },
    detail: 'Refused',
  };
}

const notOffered: CalledOnce = {
  kind: 'unopened',
  refused: 'tool_not_offered',
  because: 'tool_not_allowed',
  detail: 'Not allowed',
};

const ofTheRequest = { definitionType: 'interaction', definitionName: 'approve-report', definitionVersion: 2 };

const telling = { callId: 'call-2', runId: 'run-1', definition: ofTheRequest };

const inTheRun = { ...recorded, runId: 'run-1', ...ofTheRequest };

const recordedCall = recordingOf(ConversationCallEventSchema);

const place = { callId: 'call-1', start: started, conversation: 'C0123/1699.1', since: '1699.3' };

const ofThePlace = {
  call_id: 'call-1',
  server: 'chat',
  tool: 'thread_replies',
  conversation: 'C0123/1699.1',
  since: '1699.3',
  arguments_bytes: 40,
  arguments_sha256: 'a'.repeat(64),
};

function decided(call: ConversationCall, ...history: readonly ConversationCall[]) {
  const state = history.reduce(
    (kept, each) => conversationCallDecider.evolve(kept, recordedCall(each.event, each.context)),
    conversationCallDecider.initialState,
  );
  return conversationCallDecider.decide(call, state);
}

describe('a telling the playbook makes in a conversation', () => {
  it('records its start with the call it sends, in the run it serves and with the definition of its request', () => {
    expect(tellingStartedOf(telling, started, recorded)).toEqual({
      event: { type: 'telling_started', data: { call_id: 'call-2', ...started } },
      context: inTheRun,
    });
  });

  it('succeeds when the tool answered with a result, and fails when it answered with an error', () => {
    expect(tellingEndedOf(telling, answered, recorded)).toEqual({
      event: { type: 'telling_succeeded', data: { call_id: 'call-2', ...theAnswer } },
      context: inTheRun,
    });
    expect(tellingEndedOf(telling, answeredWithAnError, recorded).event).toEqual({
      type: 'telling_failed',
      data: { call_id: 'call-2', ...theAnswer, because: 'tool_error', detail: 'No such thread' },
    });
  });

  it('fails with no answer when its server refused the arguments or failed', () => {
    expect([
      tellingEndedOf(telling, failedAs('arguments_refused'), recorded).event,
      tellingEndedOf(telling, failedAs('server_failure'), recorded).event,
    ]).toEqual([
      {
        type: 'telling_failed',
        data: { call_id: 'call-2', because: 'arguments_refused', detail: 'Refused', duration_ms: 3, jsonrpc_id: 4 },
      },
      {
        type: 'telling_failed',
        data: { call_id: 'call-2', because: 'server_failure', detail: 'Refused', duration_ms: 3, jsonrpc_id: 4 },
      },
    ]);
  });

  it('fails with no answer when the server no longer offers the tool, or its client could not be opened', () => {
    expect([
      tellingEndedOf(telling, notOffered, recorded).event,
      tellingEndedOf(
        telling,
        { kind: 'unopened', refused: 'tool_server_failed', because: 'unreachable', detail: '' },
        recorded,
      ).event,
    ]).toEqual([
      { type: 'telling_failed', data: { call_id: 'call-2', because: 'tool_not_offered', detail: 'Not allowed' } },
      { type: 'telling_failed', data: { call_id: 'call-2', because: 'server_failure' } },
    ]);
  });
});

describe('a telling whose tool answered past the cap of its transport', () => {
  it('fails too large with no answer, since the server answered and failed nothing', () => {
    expect(tellingEndedOf(telling, failedAs('too_large'), recorded).event).toEqual({
      type: 'telling_failed',
      data: { call_id: 'call-2', because: 'too_large', detail: 'Refused', duration_ms: 3, jsonrpc_id: 4 },
    });
  });
});

describe('a read the playbook makes in a conversation', () => {
  it('is one fact, with the call and what the read found, in no run', () => {
    expect(repliesReadOf({ ...place, answered: answeredFact, replies: 2, taken: 1, refused: 1 }, recorded)).toEqual({
      event: {
        type: 'replies_read',
        data: { ...ofThePlace, ...theAnswer, replies: 2, taken: 1, refused: 1 },
      },
      context: recorded,
    });
  });

  it('fails with the answer it could not read, and the wait a 429 asked for', () => {
    expect(
      readingFailedOf(
        { ...place, because: 'unreadable', end: answered, detail: 'Not a list', retryAfterMs: 60_000 },
        recorded,
      ),
    ).toEqual({
      event: {
        type: 'reading_failed',
        data: { ...ofThePlace, ...theAnswer, because: 'unreadable', detail: 'Not a list', retry_after_ms: 60_000 },
      },
      context: recorded,
    });
  });
});

describe('a read and a telling through a connection', () => {
  it("record the connection's id beside the server's name, so its history stays plain once the name is reused", () => {
    const throughAConnection = { ...started, connection_id: '0199e7c1-5b3a-7d2e-9f40-6a1b2c3d4e5f' };

    const read = repliesReadOf(
      { ...place, start: throughAConnection, answered: answeredFact, replies: 0, taken: 0, refused: 0 },
      recorded,
    );

    expect([read.event.data, tellingStartedOf(telling, throughAConnection, recorded).event.data]).toMatchObject([
      { server: 'chat', connection_id: '0199e7c1-5b3a-7d2e-9f40-6a1b2c3d4e5f', tool: 'thread_replies' },
      { server: 'chat', connection_id: '0199e7c1-5b3a-7d2e-9f40-6a1b2c3d4e5f', tool: 'thread_replies' },
    ]);
    expect(recordedCall(read.event, recorded).data).toMatchObject({
      connection_id: '0199e7c1-5b3a-7d2e-9f40-6a1b2c3d4e5f',
    });
  });
});

describe('a read of a server that keeps no content', () => {
  it('records the size of its arguments and no digest', () => {
    const { arguments_sha256: _digest, ...unkept } = started;

    expect(
      readingFailedOf({ ...place, start: unkept, because: 'timed_out', retryAfterMs: null }, recorded).event.data,
    ).toEqual({
      call_id: 'call-1',
      server: 'chat',
      tool: 'thread_replies',
      conversation: 'C0123/1699.1',
      since: '1699.3',
      arguments_bytes: 40,
      because: 'timed_out',
    });
  });
});

describe('a read the playbook could not make in a conversation', () => {
  it('fails with what its server said when the call failed, and with nothing more when the tool is not offered', () => {
    expect([
      readingFailedOf(
        { ...place, because: 'server_failure', end: failedAs('server_failure'), retryAfterMs: null },
        recorded,
      ).event,
      readingFailedOf({ ...place, because: 'tool_not_offered', end: notOffered, retryAfterMs: null }, recorded).event,
    ]).toEqual([
      {
        type: 'reading_failed',
        data: { ...ofThePlace, because: 'server_failure', detail: 'Refused', duration_ms: 3, jsonrpc_id: 4 },
      },
      { type: 'reading_failed', data: { ...ofThePlace, because: 'tool_not_offered' } },
    ]);
  });

  it('names the tool alone when it could not be sent, with the reason in its detail', () => {
    expect(
      readingFailedOf(
        {
          ...place,
          start: reference,
          since: null,
          because: 'not_sent',
          detail: 'The arguments of the read take 18015 bytes, more than the 16384 a call may send',
          retryAfterMs: null,
        },
        recorded,
      ).event,
    ).toEqual({
      type: 'reading_failed',
      data: {
        call_id: 'call-1',
        server: 'chat',
        tool: 'thread_replies',
        conversation: 'C0123/1699.1',
        since: null,
        because: 'not_sent',
        detail: 'The arguments of the read take 18015 bytes, more than the 16384 a call may send',
      },
    });
  });
});

describe('the turns of a call in a conversation', () => {
  const start = tellingStartedOf(telling, started, recorded);
  const ending = tellingEndedOf(telling, answered, recorded);
  const read = repliesReadOf({ ...place, answered: answeredFact, replies: 0, taken: 0, refused: 0 }, recorded);
  const unread = readingFailedOf({ ...place, because: 'timed_out', retryAfterMs: null }, recorded);

  it('take the start of a telling and then its end, or a read, once each', () => {
    expect([decided(start), decided(ending, start), decided(read), decided(unread)]).toEqual([
      Result.succeed([start.event]),
      Result.succeed([ending.event]),
      Result.succeed([read.event]),
      Result.succeed([unread.event]),
    ]);
    expect(conversationCallDecider.context(ending, 'telling_started')).toEqual(inTheRun);
  });

  it('refuse anything out of turn', () => {
    expect([decided(ending), decided(read, read), decided(start, start), decided(ending, start, ending)]).toMatchObject(
      [Result.fail({}), Result.fail({}), Result.fail({}), Result.fail({})],
    );
    expect(conversationCallStreamOf('call-1')).toBe('conversation-calls/call-1');
  });
});
