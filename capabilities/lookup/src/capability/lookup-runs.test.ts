import { deniedText, patientTiming, threadReplies } from '@on.auto/tool-servers/testing';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { lookupDocument, lookupRunId, lookupRuns } from '../testing/index.ts';

const aNumber: unknown = expect.any(Number);

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const anyOutput = ['output:', '  schema: {}'];

const answeredInFull: unknown = expect.objectContaining({ is_error: false });

function reading(tool: string, written: readonly string[] = []): string {
  return lookupDocument({ tool, read: null, with: written, output: anyOutput });
}

function rejectedWith(fields: Readonly<Record<string, unknown>>) {
  return Exit.fail(expect.objectContaining(fields));
}

describe('a run of a lookup function', () => {
  it('calls its tool once and ends at once with the value at read, recording the call on the run', async () => {
    const { fake, journal, run } = await lookupRuns();

    expect(await run(lookupDocument())).toEqual(
      Exit.succeed({ output: threadReplies, record: { server: 'chat', tool: 'thread', read: '/messages' } }),
    );
    expect(fake.received()).toEqual([
      {
        tool: 'thread',
        arguments: { channel: 'C0123', ts: '1728379900.000050', limit: 100, inclusive: false },
        meta: { 'auto.on/run_id': lookupRunId },
      },
    ]);
    expect(journal.recorded()).toEqual([
      {
        type: 'tool_call_started',
        number: 1,
        data: {
          call_id: lookupRunId,
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

  it('checks what it read against its output schema', async () => {
    const { run } = await lookupRuns();

    expect(await run(lookupDocument({ output: ['output:', '  schema: { type: string }'] }))).toEqual(
      rejectedWith({
        kind: 'unworkable',
        detail: expect.stringMatching(
          /^What the thread tool of chat answered at \/messages does not match the output schema: /u,
        ),
      }),
    );
  });
});

describe('a run of a lookup function whose tool is no longer marked reads', () => {
  it('is unavailable, sends nothing and records no call, whether its server marks it acts now or leaves it unmarked', async () => {
    const { fake, journal, run } = await lookupRuns({ server: { hints: { thread: { readOnlyHint: false } } } });
    const acting = await run(lookupDocument());
    fake.annotateTool('thread', {});
    const unmarked = await run(lookupDocument());

    expect([acting, unmarked]).toEqual([
      rejectedWith({
        _tag: 'unavailable',
        kind: 'tool_not_read_only',
        detail: 'The thread tool of chat is marked acts, and the call needs one marked reads, so it was not sent',
      }),
      rejectedWith({
        _tag: 'unavailable',
        kind: 'tool_not_read_only',
        detail:
          'The thread tool of chat carries no mark, which counts as acts, and the call needs one marked reads, so it was not sent',
      }),
    ]);
    expect([fake.received(), journal.recorded()]).toEqual([[], []]);
  });
});

describe('a run of a lookup function that could not finish', () => {
  it('is unfinished and safe to try again, after a tool error, a server failure or a call past its bound', async () => {
    const { run } = await lookupRuns();
    const hurried = await lookupRuns({ timing: { ...patientTiming, callMs: 300 } });

    expect([
      await run(reading('denied')),
      await run(reading('broken')),
      await hurried.run(reading('sleep', ['    ms: 5000'])),
    ]).toEqual([
      rejectedWith({
        _tag: 'unavailable',
        kind: 'tools_unfinished',
        because: 'tool_error',
        detail: `The denied tool of chat answered an error: ${deniedText}`,
      }),
      rejectedWith({ _tag: 'unavailable', kind: 'tools_unfinished', because: 'server_failed' }),
      rejectedWith({
        _tag: 'unavailable',
        kind: 'tools_unfinished',
        because: 'server_failed',
        detail: expect.stringContaining('did not answer within 300 ms'),
      }),
    ]);
  });

  it('is unavailable, sending nothing, when its server does not serve the playbook or cannot be reached', async () => {
    const elsewhere = await lookupRuns({ entry: { org: 'globex' } });
    const { fake, run } = await lookupRuns();
    await fake.close();

    expect([await elsewhere.run(lookupDocument()), await run(lookupDocument())]).toEqual([
      rejectedWith({ kind: 'tool_not_offered', because: 'tool_server_not_configured' }),
      rejectedWith({ kind: 'tool_server_failed', because: 'unreachable' }),
    ]);
  });
});
