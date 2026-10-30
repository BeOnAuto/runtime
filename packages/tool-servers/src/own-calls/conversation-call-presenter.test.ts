import type { Context, KeptContent } from '@on.auto/operations';
import { nothingKept } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import type { ConversationCallEvent } from './conversation-call-events.ts';
import { conversationCallPresenter } from './conversation-call-presenter.ts';

const at = '2026-10-08T09:00:05.000Z';

const thePlace = {
  call_id: 'call-1',
  server: 'chat',
  tool: 'thread_replies',
  conversation: 'C0123/1699.1',
  since: null,
  arguments_bytes: 61,
  arguments_sha256: 'a'.repeat(64),
};

const answered = {
  result_bytes: 120,
  result_sha256: 'b'.repeat(64),
  duration_ms: 7,
  jsonrpc_id: 'rpc-2',
  server_request_id: 'req-9',
};

const kept: Readonly<Record<string, string>> = {
  ['a'.repeat(64)]: '{"ts":"1699.1"}',
  ['b'.repeat(64)]: '{"content":[{"type":"text","text":"{\\"messages\\":[]}"}]}',
};

const keptContent: KeptContent = (sha256) => kept[sha256];

const acted = { at, by: 'playbook:alpha' };

const inTheRun = {
  ...acted,
  runId: 'run-1',
  definitionType: 'interaction',
  definitionName: 'approve-report',
  definitionVersion: 1,
};

function contextOf({ type }: ConversationCallEvent): Context {
  return type.startsWith('telling_') ? inTheRun : acted;
}

function shown(event: ConversationCallEvent, content: KeptContent = keptContent, context = contextOf(event)) {
  const [fact] = conversationCallPresenter.present(
    {
      id: 'event-1',
      causationId: 'cause-1',
      correlationId: null,
      stream: 'conversation-calls/call-1',
      version: 1,
      globalPosition: 9,
      type: event.type,
      data: event.data,
      context,
      recordedAt: at,
    },
    content,
  );
  return fact;
}

describe('a read the playbook made in a conversation, as the playbook events show it', () => {
  it('says what it found through which tool, with the arguments and the answer it kept', () => {
    expect(
      shown({
        type: 'replies_read',
        data: { ...thePlace, ...answered, since: '1699.3', replies: 2, taken: 1, refused: 1 },
      }),
    ).toEqual({
      type: 'replies_read',
      summary:
        'The playbook looked for new replies in the conversation “C0123/1699.1” through the thread replies tool of chat and found 2, took 1 as an answer and refused 1.',
      data: {
        ...thePlace,
        ...answered,
        since: '1699.3',
        replies: 2,
        taken: 1,
        refused: 1,
        arguments: { ts: '1699.1' },
        result: { content: [{ type: 'text', text: '{"messages":[]}' }] },
        answer: { messages: [] },
      },
    });
  });

  it('shows no content the read did not keep, even when another read kept the same, since its fact names no digest', () => {
    const { arguments_sha256: _arguments, ...unkeptPlace } = thePlace;
    const { result_sha256: _result, ...unkeptAnswer } = answered;
    const read = shown(
      {
        type: 'replies_read',
        data: { ...unkeptPlace, ...unkeptAnswer, replies: 0, taken: 0, refused: 0 },
      },
      keptContent,
    );

    expect(read?.data).not.toHaveProperty('arguments');
    expect(read?.data).not.toHaveProperty('answer');
  });
});

describe('a read the playbook could not make in a conversation, as the playbook events show it', () => {
  it('says why, with no answer where no call was answered and the wait a server asked for', () => {
    const notOffered = shown(
      { type: 'reading_failed', data: { ...thePlace, because: 'tool_not_offered' } },
      nothingKept,
    );
    const { arguments_bytes: _bytes, arguments_sha256: _digest, ...unsent } = thePlace;
    const notSent = shown({
      type: 'reading_failed',
      data: { ...unsent, because: 'not_sent', detail: 'The argument ts of the read cannot be rendered' },
    });
    const timedOut = shown({
      type: 'reading_failed',
      data: { ...thePlace, because: 'timed_out', duration_ms: 30_000, jsonrpc_id: 4, retry_after_ms: 60_000 },
    });
    const refused = shown({ type: 'reading_failed', data: { ...thePlace, because: 'arguments_refused' } });

    expect([notOffered?.summary, timedOut?.summary, refused?.summary]).toEqual([
      'The playbook could not read the replies of the conversation “C0123/1699.1” through the thread replies tool of chat: the tool server no longer offers the tool to this playbook.',
      'The playbook could not read the replies of the conversation “C0123/1699.1” through the thread replies tool of chat: the tool server did not answer within 30 seconds.',
      'The playbook could not read the replies of the conversation “C0123/1699.1” through the thread replies tool of chat: the tool server refused the arguments of the read.',
    ]);
    expect(notOffered?.data).toEqual({ ...thePlace, because: 'tool_not_offered' });
    expect(notSent).toMatchObject({
      summary:
        'The playbook could not read the replies of the conversation “C0123/1699.1” through the thread replies tool of chat: its arguments could not be rendered, so nothing was sent.',
      data: { detail: 'The argument ts of the read cannot be rendered' },
    });
    expect(notSent?.data).not.toHaveProperty('arguments_bytes');
    expect(timedOut?.data).toMatchObject({ because: 'timed_out', jsonrpc_id: 4, retry_after_ms: 60_000 });
  });
});

describe('a read whose answer was too large, as the playbook events show it', () => {
  it('names the bytes a read may take when the tool answered past them, and the cap of the transport when that cap stopped the answer', () => {
    const pastTheRead = shown({ type: 'reading_failed', data: { ...thePlace, ...answered, because: 'too_large' } });
    const pastTheCap = shown({
      type: 'reading_failed',
      data: {
        ...thePlace,
        because: 'too_large',
        detail: 'The tool server answered more than the 16,777,216 bytes one call over HTTP may take',
        duration_ms: 40,
        jsonrpc_id: 3,
      },
    });

    expect([pastTheRead?.summary, pastTheCap?.summary]).toEqual([
      'The playbook could not read the replies of the conversation “C0123/1699.1” through the thread replies tool of chat: the tool answered more than the 65,536 bytes a read may take.',
      'The playbook could not read the replies of the conversation “C0123/1699.1” through the thread replies tool of chat: the tool server answered more than its transport lets one call take, 16,777,216 bytes over HTTP and 4,194,304 from a stdio server, so its answer was not read.',
    ]);
    expect(pastTheCap?.data).toMatchObject({
      detail: 'The tool server answered more than the 16,777,216 bytes one call over HTTP may take',
    });
  });
});

describe('a telling the playbook made in a conversation, as the playbook events show it', () => {
  it('says through which tool it told the party how to answer, and what the tool did', () => {
    const started = shown({
      type: 'telling_started',
      data: {
        call_id: 'call-2',
        server: 'chat',
        tool: 'post_message',
        arguments_bytes: 80,
        arguments_sha256: 'c'.repeat(64),
      },
    });
    const succeeded = shown({ type: 'telling_succeeded', data: { call_id: 'call-2', ...answered } });
    const failed = shown({
      type: 'telling_failed',
      data: { call_id: 'call-3', because: 'tool_error', detail: 'No channel', ...answered },
    });
    const notOffered = shown({ type: 'telling_failed', data: { call_id: 'call-4', because: 'tool_not_offered' } });

    expect([started?.summary, succeeded?.summary, failed?.summary, notOffered?.summary]).toEqual([
      'The playbook told the party how to answer through the post message tool of chat.',
      'The tool that told the party answered.',
      'The tool that told the party answered with an error of its own.',
      'The tool that told the party was no longer offered by its server.',
    ]);
    expect([started?.data, succeeded?.data, failed?.data]).toMatchObject([
      { call_id: 'call-2', arguments_bytes: 80 },
      { ...answered, answer: { messages: [] } },
      { because: 'tool_error', detail: 'No channel', answer: { messages: [] } },
    ]);
  });

  it('says the tool answered more than a call may take, and fails on a telling recorded without its definition', () => {
    const tooLarge = shown({ type: 'telling_failed', data: { call_id: 'call-5', because: 'too_large' } });
    const telling = { type: 'telling_failed', data: { call_id: 'call-6', because: 'cancelled' } } as const;

    expect(tooLarge?.summary).toBe(
      'The tool that told the party answered more than one call may take, so its answer was not read.',
    );
    expect(() => shown(telling, keptContent, { ...acted, runId: 'run-1' })).toThrow('definitionType');
  });
});
