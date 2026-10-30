import { recordingTracer } from '@on.auto/operations/testing';
import { failureReply } from '@on.auto/tool-servers/policy';
import { openFakeToolRun, type FakeToolRun } from '@on.auto/tool-servers/served-fakes';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { scriptedLanguageModel } from '../testing/scripted-language-model.ts';
import { performedInProcess, type ToolCallTelemetry } from './performed-in-process.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function searchRun(): Promise<FakeToolRun> {
  const run = await openFakeToolRun(['search']);
  closing.push(run.close);
  return run;
}

async function spansOfACall(telemetry?: ToolCallTelemetry) {
  const { tools } = await searchRun();
  const { languageModel } = scriptedLanguageModel();
  const recording = recordingTracer();
  const answer = await Effect.runPromise(
    performedInProcess(
      languageModel,
      telemetry,
    )(tools.offered)
      .toolCall({ callId: 'toolu_1', tool: 'graph__search', server: 'graph', input: { query: 'acme' } })
      .pipe(Effect.withTracer(recording.tracer)),
  );
  return { answer, spans: recording.spans() };
}

describe('a tool call made in this process within a room', () => {
  it('shows the model only as much of the answer as the room holds', async () => {
    const { tools } = await searchRun();
    const { languageModel } = scriptedLanguageModel();
    const answer = await Effect.runPromise(
      performedInProcess(languageModel)(tools.offered).toolCall({
        callId: 'toolu_1',
        tool: 'graph__search',
        server: 'graph',
        input: { query: 'acme' },
        room: 8,
      }),
    );

    expect(answer.reply.text).toBe(
      '\n[The answer was cut to 0 of its 22 bytes, to fit what the model may still read; ask for fewer rows, fields or depth to see the rest.]',
    );
    expect(answer.ended.data).toMatchObject({ shown_bytes: 0 });
  });
});

describe('a tool call made in this process', () => {
  it('is a span of its own, carrying the arguments and the result only where telemetry records content', async () => {
    const recorded = await spansOfACall({ recordContent: true });
    const unrecorded = await spansOfACall();

    expect(recorded.answer.reply).toEqual({ text: 'Found 2 rows for acme.', isError: false });
    expect(recorded.spans).toMatchObject([
      {
        name: 'execute_tool graph__search',
        attributes: {
          'gen_ai.operation.name': 'execute_tool',
          'gen_ai.tool.name': 'graph__search',
          'gen_ai.tool.call.id': 'toolu_1',
          'gen_ai.tool.call.arguments': '{"query":"acme"}',
          'gen_ai.tool.call.result': 'Found 2 rows for acme.',
        },
      },
    ]);
    expect(unrecorded.spans.map(({ attributes }) => Object.keys(attributes))).toEqual([
      ['gen_ai.operation.name', 'gen_ai.tool.name', 'gen_ai.tool.call.id', 'gen_ai.tool.type'],
    ]);
  });
});

describe('a tool call made in this process, of a tool it does not offer', () => {
  it('is answered as a failure at its server, sent nowhere, worded as the record of such a failure words it', async () => {
    const { languageModel } = scriptedLanguageModel();

    const answer = await Effect.runPromise(
      performedInProcess(languageModel)([]).toolCall({
        callId: 'toolu_1',
        tool: 'graph__search',
        server: 'graph',
        input: { query: 'acme' },
      }),
    );

    const failed = {
      because: 'server_failure' as const,
      detail: 'This process offers no tool graph__search, so the call was not sent',
      duration_ms: 0,
      jsonrpc_id: null,
    };

    expect(answer).toEqual({ ended: { type: 'tool_call_failed', data: failed }, reply: failureReply(failed, 'graph') });
  });
});
