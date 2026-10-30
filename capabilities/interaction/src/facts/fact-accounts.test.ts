import { makeDefinitionPresenters } from '@on.auto/definitions';
import { presentationOf, type Context, type KeptContent, type RecordedEvent } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { askedRunId, interactionHarness } from '../testing/index.ts';
import type { InteractionFact } from './run-facts.ts';

const { present, storedTypesOf } = presentationOf(makeDefinitionPresenters([interactionHarness().capability]));

const ofAsking: Context = {
  runId: askedRunId,
  by: 'playbook:alpha',
  at: '2026-10-01T09:00:01.000Z',
  definitionType: 'interaction',
  definitionName: 'approve',
  definitionVersion: 1,
};

const kept: Readonly<Record<string, string>> = {
  ['a'.repeat(64)]: '{"channel":"C0123","text":"Approve?"}',
  ['b'.repeat(64)]: '{"content":[],"structuredContent":{"ts":"1699.1"}}',
};

const keptContent: KeptContent = (sha256) => kept[sha256];

function presented({ type, data }: InteractionFact) {
  const record: RecordedEvent = {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
    causationId: 'request-1',
    correlationId: askedRunId,
    stream: `runs/${askedRunId}`,
    version: 2,
    globalPosition: 9,
    type,
    data,
    context: ofAsking,
    recordedAt: '2026-10-01T09:00:02.000Z',
  };
  const showing = { streamPrefix: 'playbook/acme/alpha/', content: keptContent, view: 'whole' } as const;
  return present(record, showing).map(({ type: shown, summary, data: shownData }) => ({
    type: shown,
    summary,
    data: shownData,
  }));
}

describe('the facts of a delivery and of a reply, as the playbook shows them', () => {
  it('are named as they are recorded, as the interaction capability declares them', () => {
    expect(
      ['delivery_started', 'delivery_succeeded', 'delivery_failed', 'delivery_refused', 'reply_refused'].map((type) =>
        storedTypesOf(type),
      ),
    ).toEqual([
      ['delivery_started'],
      ['delivery_succeeded'],
      ['delivery_failed'],
      ['delivery_refused'],
      ['reply_refused'],
    ]);
  });
});

describe('the start of a delivery', () => {
  it('is its attempt, the tool it calls, its target and the arguments it kept', () => {
    const data = {
      number: 1,
      target: 'ada',
      server: 'chat',
      tool: 'post_message',
      arguments_bytes: 37,
      arguments_sha256: 'a'.repeat(64),
    };

    expect(presented({ type: 'delivery_started', data })).toEqual([
      {
        type: 'delivery_started',
        summary: 'Delivery attempt 1 of the request started, through the post message tool of chat.',
        data: { ...data, arguments: { channel: 'C0123', text: 'Approve?' } },
      },
    ]);
  });

  it('is its attempt, the tool and its target alone for an attempt that made no call', () => {
    expect(
      presented({
        type: 'delivery_started',
        data: { number: 2, target: 't'.repeat(300), server: 'chat', tool: 'post_message' },
      }),
    ).toMatchObject([{ data: { number: 2, target: 't'.repeat(256), server: 'chat', tool: 'post_message' } }]);
  });
});

describe('the end of a delivery', () => {
  it('is how the attempt failed, in words, with every fact of it and its detail cut', () => {
    expect(
      presented({
        type: 'delivery_failed',
        data: {
          number: 1,
          because: 'server_failure',
          retry_after_ms: 120_000,
          detail: 'x'.repeat(2000),
          jsonrpc_id: `rpc-${'7'.repeat(200)}`,
          server_request_id: null,
          duration_ms: 40,
        },
      }),
    ).toEqual([
      {
        type: 'delivery_failed',
        summary:
          'Delivery attempt 1 failed, because the tool server failed; another follows on the schedule, unless it was the last.',
        data: {
          number: 1,
          because: 'server_failure',
          retry_after_ms: 120_000,
          detail: 'x'.repeat(1024),
          jsonrpc_id: `rpc-${'7'.repeat(124)}`,
          server_request_id: null,
          duration_ms: 40,
        },
      },
    ]);
  });

  it('is how the attempt was refused, with its detail cut', () => {
    expect(
      presented({
        type: 'delivery_refused',
        data: { number: 1, because: 'unworkable', detail: 'y'.repeat(2000), duration_ms: 0 },
      }),
    ).toEqual([
      {
        type: 'delivery_refused',
        summary:
          'Delivery attempt 1 was refused, because its arguments cannot be rendered for this request, so it is not tried again.',
        data: { number: 1, because: 'unworkable', detail: 'y'.repeat(1024), duration_ms: 0 },
      },
    ]);
  });
});

describe('the end of a delivery that answered', () => {
  it('shows what the tool answered, what the message was delivered as and where replies are read', () => {
    expect(
      presented({
        type: 'delivery_succeeded',
        data: {
          number: 1,
          result_bytes: 52,
          result_sha256: 'b'.repeat(64),
          jsonrpc_id: 3,
          server_request_id: 'call-1',
          duration_ms: 5,
          delivered_as: { conversation: 'C0123', id: '1699.1' },
          replies_in: { server: 'chat', tool: 'thread_replies', key: `C0123/${'k'.repeat(300)}` },
        },
      }),
    ).toMatchObject([
      {
        type: 'delivery_succeeded',
        summary: 'Delivery attempt 1 was delivered.',
        data: {
          result_bytes: 52,
          delivered_as: { conversation: 'C0123', id: '1699.1' },
          replies_in: { server: 'chat', tool: 'thread_replies', key: `C0123/${'k'.repeat(250)}` },
          result: { content: [], structuredContent: { ts: '1699.1' } },
          answer: { ts: '1699.1' },
        },
      },
    ]);
  });

  it('shows the size of what the tool answered alone, of a server that keeps no content and kept no conversation', () => {
    expect(
      presented({
        type: 'delivery_succeeded',
        data: { number: 1, result_bytes: 52, jsonrpc_id: 3, duration_ms: 5 },
      })[0]?.data,
    ).toEqual({ number: 1, result_bytes: 52, jsonrpc_id: 3, duration_ms: 5 });
  });
});

const ofTheReply = { server: 'chat', tool: 'thread_replies', reply: { id: '1699.2', sender: 'ada' } };

describe('a reply the run refused', () => {
  it('says whether the party was told how to answer, with the issues of an answer that did not fit', () => {
    expect([
      ...presented({ type: 'reply_refused', data: { ...ofTheReply, because: 'not_an_answer', told: true } }),
      ...presented({
        type: 'reply_refused',
        data: {
          ...ofTheReply,
          because: 'invalid',
          issues: [{ pointer: '/answer/note', detail: 'Too long' }],
          told: false,
        },
      }),
    ]).toEqual([
      {
        type: 'reply_refused',
        summary: 'A reply from the party was not an answer the function takes, and the party was told how to answer.',
        data: { ...ofTheReply, because: 'not_an_answer', told: true },
      },
      {
        type: 'reply_refused',
        summary: 'A reply from the party was not an answer the function takes, and nobody was told.',
        data: {
          ...ofTheReply,
          because: 'invalid',
          told: false,
          issue_count: 1,
          issues: [{ pointer: '/answer/note', detail: 'Too long' }],
        },
      },
    ]);
  });
});
