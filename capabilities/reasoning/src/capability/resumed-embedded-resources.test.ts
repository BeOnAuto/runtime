import type { RecordedCall } from '@on.auto/definitions';
import { serveFakeMcp, type FakeTool } from '@on.auto/tool-servers/served-fakes';
import { reportingAccess } from '@on.auto/tool-servers/testing';
import { Effect, Schema, Struct } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { ModelRequest } from '../model/model-request.ts';
import { textResult, toolCallsResult } from '../testing/model-results.ts';
import { reasoningOf, type Reasoning } from '../testing/reasoning-runs.ts';
import { attemptOf, graphKey, upToTheFirst, withGraphTools } from '../testing/resumed-attempts.ts';
import { answers } from '../testing/scripted-language-model.ts';

const notes = `# Notes\n\n${'Ship on Friday. '.repeat(64)}`;

const readsAFile: FakeTool = {
  name: 'read_file',
  description: 'Reads a file, answering a line about it and the file as an embedded resource.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  annotations: { readOnlyHint: true },
  answer: () => ({
    content: [
      { type: 'text', text: 'Read notes.md at 3f2a1c.' },
      { type: 'resource', resource: { uri: 'file:///notes.md', mimeType: 'text/markdown', text: notes } },
    ],
  }),
};

const counted = {
  input: { total: 100, uncached: 100, cache_read: null, cache_write: null },
  output: { total: 0, text: 0, reasoning: null },
  total: 100,
};

const asking = answers(toolCallsResult([['graph__read_file', {}]], { usage: counted, request_bytes: 1000 }));

const answering = answers(textResult('Ship on Friday.'));

const aSmallWindow: Reasoning['reading'] = { mostInputTokens: 2_000_000, contextWindowOf: () => Effect.succeed(160) };

const shownInFormatOne = 'Read notes.md at 3f2a1c.\n[resource content, not shown]';

async function toolsWithFiles() {
  const fake = await serveFakeMcp({ bearer: graphKey, tools: [readsAFile] });
  onTestFinished(() => fake.close());
  const reporting = reportingAccess(
    { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
    { environment: { GRAPH_API_KEY: graphKey } },
  );
  onTestFinished(() => reporting.access.close());
  return reporting;
}

const isToolResult = Schema.is(
  Schema.Struct({ type: Schema.Literal('tool-result'), output: Schema.Struct({ value: Schema.String }) }),
);

const isMessageOfParts = Schema.is(Schema.Struct({ content: Schema.Array(Schema.Unknown) }));

function toolTextsIn(request: ModelRequest | undefined): readonly string[] {
  return (request?.conversation ?? []).flatMap((message) =>
    isMessageOfParts(message) ? message.content.flatMap((part) => (isToolResult(part) ? [part.output.value] : [])) : [],
  );
}

function answeredIn(calls: readonly RecordedCall[]) {
  return calls.flatMap((call) => (call.type === 'tool_call_answered' ? [call.data] : []));
}

function recordedBefore(calls: readonly RecordedCall[], shownBytes?: number): readonly RecordedCall[] {
  return calls.map((call) => {
    if (call.type !== 'tool_call_answered') {
      return call;
    }
    const data = Struct.omit(call.data, ['shown_format', 'shown_bytes']);
    return { ...call, data: shownBytes === undefined ? data : { ...data, shown_bytes: shownBytes } };
  });
}

async function firstAttempt(given: Pick<Reasoning, 'reading'>) {
  const { access: tools, content } = await toolsWithFiles();
  const first = reasoningOf({ tools, content, ...given }, asking, answering);
  await first.running(withGraphTools);
  const calls = upToTheFirst(first.journal.calls(), 'tool_call_answered');
  const goOn = async (recorded: readonly RecordedCall[]) => {
    const again = reasoningOf({ tools, content, ...given, attempt: attemptOf(recorded) }, answering);
    await again.running(withGraphTools);
    return again.requests();
  };
  return { first, calls, goOn };
}

describe('a run that goes on from a tool call whose answer carried a file', () => {
  it('shows the model the file again exactly as its first attempt did, read whole', async () => {
    const { first, calls, goOn } = await firstAttempt({});
    const [answered] = answeredIn(calls);

    const requests = await goOn(calls);

    expect([answered?.shown_format, answered?.shown_bytes]).toEqual([2, undefined]);
    expect(toolTextsIn(first.requests()[1])).toEqual([`Read notes.md at 3f2a1c.\n${notes}`]);
    expect(requests).toEqual([first.requests()[1]]);
  });

  it('shows the model the file again exactly as its first attempt did, cut where its call recorded the cut', async () => {
    const { first, calls, goOn } = await firstAttempt({ reading: aSmallWindow });
    const [answered] = answeredIn(calls);
    const [shown] = toolTextsIn(first.requests()[1]);

    const requests = await goOn(calls);

    expect([answered?.shown_format, typeof answered?.shown_bytes]).toEqual([2, 'number']);
    expect(shown?.startsWith('Read notes.md at 3f2a1c.\n# Notes')).toBe(true);
    expect(shown).toContain(`[The answer was cut to ${String(answered?.shown_bytes)} of its`);
    expect(requests).toEqual([first.requests()[1]]);
  });

  it('shows the model the text of format 1 for a call recorded before calls named their format, whole or cut', async () => {
    const { calls, goOn } = await firstAttempt({});

    const whole = await goOn(recordedBefore(calls));
    const cut = await goOn(recordedBefore(calls, 10));

    expect([toolTextsIn(whole[0]), toolTextsIn(cut[0])]).toEqual([
      [shownInFormatOne],
      [
        'Read notes\n[The answer was cut to 10 of its 54 bytes, to fit what the model may still read; ask for fewer rows, fields or depth to see the rest.]',
      ],
    ]);
  });
});
