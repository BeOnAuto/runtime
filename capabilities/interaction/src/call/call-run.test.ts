import { onTheStandingClock } from '@on.auto/definitions/testing';
import { threadReplies } from '@on.auto/tool-servers/testing';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeInteractionFunctionAdapter } from '../capability/interaction-function.ts';
import { callRunId, callRuns } from '../testing/call-runs.ts';
import { callDocument, noTools } from '../testing/index.ts';

const aNumber: unknown = expect.any(Number);

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const answeredInFull: unknown = expect.objectContaining({ is_error: false, duration_ms: aNumber });

const asSystem = makeInteractionFunctionAdapter({
  tools: noTools,
  openRequests: () => Effect.succeed(0),
  mostOpenRequests: 10,
});

describe('a run of an interaction function that asks a system', () => {
  it('calls the tool once and ends at once with the value at read as its output, recording the call on the run', async () => {
    const { fake, journal, run } = await callRuns();

    expect(await run(callDocument())).toEqual(
      Exit.succeed({ output: threadReplies, record: { server: 'chat', tool: 'thread', read: '/messages' } }),
    );
    expect(fake.received()).toEqual([
      {
        tool: 'thread',
        arguments: { channel: 'C0123', ts: '1728379900.000050', limit: 100, inclusive: false },
        meta: { 'auto.on/run_id': callRunId },
      },
    ]);
    expect(journal.recorded()).toEqual([
      {
        type: 'tool_call_started',
        number: 1,
        data: {
          call_id: callRunId,
          server: 'chat',
          tool: 'thread',
          arguments_bytes: aNumber,
          arguments_sha256: aDigest,
          read_only: true,
        },
      },
      { type: 'tool_call_answered', number: 1, data: answeredInFull },
    ]);
  });
});

describe('a run of an interaction function that asks a system with its input', () => {
  it('sends a value written alone in one {{ }} as the value it reads, and answers with the whole answer without read', async () => {
    const { fake, run } = await callRuns();
    const echoing = callDocument({
      tool: 'echo',
      read: null,
      with: [
        "    limit: '{{ input.limit }}'",
        "    filters: '{{ input.filters }}'",
        "    note: 'For {{ input.channel }}'",
      ],
      input: ['input:', '  schema: { type: object }'],
      output: ['output:', '  schema: { type: object }'],
    });
    const input = { limit: 15, filters: { open: true }, channel: 'C0123' };
    const sent = { limit: 15, filters: { open: true }, note: 'For C0123' };

    expect(await run(echoing, input)).toEqual(Exit.succeed({ output: sent, record: { server: 'chat', tool: 'echo' } }));
    expect(fake.received()).toMatchObject([{ tool: 'echo', arguments: sent }]);
  });
});

describe('what a run that asks a system answers with', () => {
  it('answers with a text that is not JSON as that text', async () => {
    const { run } = await callRuns();
    const searching = callDocument({
      tool: 'search',
      read: null,
      with: ["    query: '{{ input.channel }}'"],
      output: ['output:', '  schema: { type: string }'],
    });

    expect(await run(searching)).toMatchObject({ value: { output: 'Found 2 rows for C0123.' } });
  });
});

describe('an interaction function that asks a system, as the playbook runs it', () => {
  it('calls tools, finishes within its call, and runs at most 70 seconds', () => {
    const prepared = Effect.runSync(onTheStandingClock(asSystem.prepare(callDocument())));

    expect([prepared.callsTools, prepared.finishesLaterFor({}), prepared.longestRunMs]).toEqual([true, false, 70_000]);
  });

  it('says what the tool answered, the records of a list in parentheses, or how many items there are', () => {
    const record = { server: 'chat', tool: 'thread_replies', read: '/messages' };
    const many = Array.from({ length: 14 }, (_, index) => ({ user: `member-${index}`, text: 'x'.repeat(40) }));

    expect([
      asSystem.describeOutput(threadReplies, record),
      asSystem.describeOutput(many, record),
      asSystem.describeOutput({ text: 'x'.repeat(400) }, record),
      asSystem.describeOutput({}, record),
    ]).toEqual([
      'It asked the thread replies tool of chat; its answer: (user: “member-17”, text: “Shipped the fix to staging.”, and ts: “1728380000.000100”) and (user: “member-42”, text: “Thanks, closing the ticket.”, and ts: “1728380100.000200”).',
      'It asked the thread replies tool of chat, whose answer of 14 items is too long to repeat here; the whole of it is in the details below.',
      'It asked the thread replies tool of chat, whose answer is too long to repeat here; the whole of it is in the details below.',
      'It asked the thread replies tool of chat; its answer: nothing.',
    ]);
  });
});
