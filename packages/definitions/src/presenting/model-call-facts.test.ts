import {
  PublicEventSchema,
  mostPublicEventDataBytes,
  presentationOf,
  type Context,
  type RecordedEvent,
} from '@on.auto/operations';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeDefinitionPresenters } from '../index.ts';
import { modelCallAnswered, modelCallSent } from '../journal-testing/model-calls.ts';
import type { RunEvent } from '../runs/run-events.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { testRunId } from '../testing/run-facts.ts';

const { present } = presentationOf(makeDefinitionPresenters([echo]));

const ofReasoning: Context = {
  runId: testRunId,
  by: 'acme-admin',
  at: '2026-10-01T09:00:01.000Z',
  definitionType: 'echo',
  definitionName: 'greet',
  definitionVersion: 2,
};

const awkward = '\u0000'.repeat(64 * 1024);

const largestCount = Number.MAX_SAFE_INTEGER;

const largestUsage = {
  input: { total: largestCount, uncached: largestCount, cache_read: largestCount, cache_write: largestCount },
  output: { total: largestCount, text: largestCount, reasoning: largestCount },
  total: largestCount,
};

const largestAsked = Array.from({ length: 1000 }, () => ({
  call_id: awkward,
  tool: awkward,
  server: awkward,
  arguments_sha256: awkward,
}));

const largestModelCalls: readonly RunEvent[] = [
  {
    type: 'model_call_started',
    data: {
      number: largestCount,
      model: awkward,
      messages_bytes: largestCount,
      messages_sha256: awkward,
      tools_offered: largestCount,
    },
  },
  {
    type: 'model_call_answered',
    data: {
      number: largestCount,
      finish_reason: 'content_filter',
      raw_finish_reason: awkward,
      usage: largestUsage,
      cost_usd: Number.MAX_VALUE,
      response_id: awkward,
      duration_ms: largestCount,
      request_bytes: largestCount,
      response_bytes: largestCount,
      response_sha256: awkward,
      resolved_model: awkward,
      answered_model: awkward,
      warnings: Array.from({ length: 20 }, () => ({
        type: 'compatibility' as const,
        feature: awkward,
        detail: awkward,
      })),
      tool_calls: largestAsked,
    },
  },
  {
    type: 'model_call_failed',
    data: {
      number: largestCount,
      because: 'provider_not_configured',
      provider: awkward,
      detail: awkward,
      duration_ms: largestCount,
      usage: largestUsage,
      cost_usd: Number.MAX_VALUE,
      finish_reason: 'content_filter',
      retry_after_ms: largestCount,
      provider_message: awkward,
      issues: Array.from({ length: 5 }, () => ({ pointer: awkward, detail: awkward })),
    },
  },
];

const keptMessages = { ['c'.repeat(64)]: '{"messages":[{"role":"user","content":[{"type":"text","text":"Hi"}]}]}' };

const keptResponse = { ['d'.repeat(64)]: '[{"role":"assistant","content":[{"type":"text","text":"Hello"}]}]' };

function recorded({ type, data }: RunEvent): RecordedEvent {
  return {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
    causationId: null,
    correlationId: testRunId,
    stream: `runs/${testRunId}`,
    version: 1,
    globalPosition: 11,
    type,
    data,
    context: ofReasoning,
    recordedAt: '2026-10-01T09:00:02.000Z',
  };
}

function presentedWith(event: RunEvent, content: Readonly<Record<string, string>>) {
  return present(recorded(event), {
    streamPrefix: 'playbook/acme/alpha/',
    content: (sha) => content[sha],
    view: 'page',
  });
}

function presented(event: RunEvent) {
  return presentedWith(event, {}).at(0);
}

describe('the presenter of the start of a model call', () => {
  it('presents its start with the tools it offered, and the messages it sent where the run keeps them', () => {
    const offering = { type: 'model_call_started', data: { number: 2, ...modelCallSent(3) } } as const;
    const offeringNone = { type: 'model_call_started', data: { number: 1, ...modelCallSent(0) } } as const;

    expect(presentedWith(offering, keptMessages).at(0)).toMatchObject({
      type: 'model_call_started',
      summary: 'A run made model call 2, offering 3 tools.',
      data: {
        number: 2,
        model: 'anthropic/claude-sonnet-4-5',
        messages_bytes: 182,
        messages_sha256: 'c'.repeat(64),
        tools_offered: 3,
        messages: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] },
      },
    });
    expect(presented(offeringNone)).toMatchObject({ summary: 'A run made model call 1, with no tools offered.' });
    expect(presented(offeringNone)?.data).not.toHaveProperty('messages');
    expect(
      presentedWith(
        { type: 'model_call_started', data: { number: 1, ...modelCallSent(1) } },
        { ['c'.repeat(64)]: '{' },
      ).at(0)?.data,
    ).not.toHaveProperty('messages');
  });
});

describe('the presenter of the answer of a model call', () => {
  it('presents its answer with the tool calls it asked for, its cost, and the response where the run keeps it', () => {
    const unkeptCall = { model: 'anthropic/claude-sonnet-4-5', messages_bytes: 182, tools_offered: 1 };
    const answer = modelCallAnswered(2);

    expect(
      presentedWith({ type: 'model_call_answered', data: { number: 1, ...answer } }, keptResponse).at(0),
    ).toMatchObject({
      type: 'model_call_answered',
      summary: 'Model call 1 was answered, asking for 2 tool calls.',
      data: {
        number: 1,
        finish_reason: 'tool_calls',
        cost_usd: 0.00042,
        usage: answer.usage,
        tool_calls: answer.tool_calls,
        response: [{ role: 'assistant', content: [{ type: 'text', text: 'Hello' }] }],
      },
    });
    expect(
      presented({
        type: 'model_call_answered',
        data: { number: 1, ...modelCallAnswered(0), raw_finish_reason: null, response_id: null },
      }),
    ).toMatchObject({ summary: 'Model call 1 was answered.', data: { raw_finish_reason: null, response_id: null } });
    expect(presented({ type: 'model_call_started', data: { number: 1, ...unkeptCall } })?.data).not.toHaveProperty(
      'messages_sha256',
    );
  });

  it('presents the warnings of the provider, each with what it names and says', () => {
    const warnings = [
      { type: 'unsupported' as const, feature: 'temperature', detail: 'ignored' },
      { type: 'other' as const, feature: null, detail: null },
    ];

    expect(
      presented({ type: 'model_call_answered', data: { number: 1, ...modelCallAnswered(0), warnings } })?.data,
    ).toMatchObject({ warnings, resolved_model: 'anthropic/claude-sonnet-4-5' });
  });
});

describe('the presenter of a model call that failed', () => {
  it.each([
    ['timed_out', 'Model call 4 took too long, so it was given up.'],
    ['rate_limited', 'Model call 4 was refused by the provider, which asked to slow down.'],
    ['interrupted', 'Model call 4 was not answered before the attempt that made it ended, so it is made again.'],
    [
      'output_invalid',
      'Model call 4 was answered with an answer that does not match the output the definition asks for.',
    ],
  ] as const)('presents a failure, %s, in words', (because, summary) => {
    expect(
      presented({
        type: 'model_call_failed',
        data: { number: 4, because, provider: 'anthropic', duration_ms: 12, detail: 'x'.repeat(2000) },
      }),
    ).toMatchObject({
      type: 'model_call_failed',
      summary,
      data: { because, duration_ms: 12, detail: 'x'.repeat(1024) },
    });
    expect(
      presented({
        type: 'model_call_failed',
        data: { number: 4, because, provider: 'anthropic', detail: 'Short', duration_ms: 12 },
      })?.data,
    ).toEqual({ number: 4, because, provider: 'anthropic', detail: 'Short', duration_ms: 12 });
  });
});

const decodePublicEvent = Schema.decodeUnknownResult(PublicEventSchema);

const utf8 = new TextEncoder();

describe('the largest record of a model call', () => {
  it.each(largestModelCalls.map((event) => [event.type, event] as const))(
    'of a run, %s, presents within the bound of public data',
    (_type, event) => {
      const [shown] = presentedWith(event, { ['d'.repeat(64)]: awkward });

      expect(utf8.encode(JSON.stringify(shown?.data)).byteLength).toBeLessThanOrEqual(mostPublicEventDataBytes);
      expect(Result.isSuccess(decodePublicEvent(shown))).toBe(true);
    },
  );
});
