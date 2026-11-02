import { threadReplies } from '@on.auto/tool-servers/testing';
import { describe, expect, it } from 'vitest';

import { askingASystem, systemRunId, type HistoryEvent } from '../testing/interaction-servers/system-calls.ts';
import { withoutStudioLink } from '../testing/servers/http-client.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';

const aTime: unknown = expect.any(String);

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const record = { server: 'chat', tool: 'thread', read: '/messages' };

const acting = { thread: { readOnlyHint: false } };

function keysOf(event: HistoryEvent | undefined): readonly string[] {
  return Object.keys(event?.data ?? {});
}

describe('an interaction function that calls a tool that acts, over HTTP', () => {
  it('calls the tool once and answers at once with what it answered, as get_run answers the run', async () => {
    const server = await askingASystem({ hints: acting });
    await server.define('thread-replies');

    const ran = await server.runCall('thread-replies');
    const read = await server.call('GET', `${alpha}/runs/${systemRunId}`);

    expect(ran).toMatchObject({
      status: 200,
      body: {
        run_id: systemRunId,
        type: 'interaction',
        name: 'thread-replies',
        status: 'succeeded',
        output: threadReplies,
        record,
        started_at: aTime,
        finished_at: aTime,
      },
    });
    expect(read.body).toEqual(withoutStudioLink(ran.body));
    expect(server.fake.received()).toEqual([
      {
        tool: 'thread',
        arguments: { channel: 'C0123', ts: '1728379900.000050', limit: 100, inclusive: false },
        meta: { 'auto.on/run_id': systemRunId },
      },
    ]);
  });

  it('is refused when it is saved naming a tool marked reads, which a lookup function calls', async () => {
    const server = await askingASystem();

    expect(await server.define('thread-replies')).toMatchObject({
      status: 422,
      body: {
        reason: 'invalid_input',
        errors: [
          {
            pointer: '/source',
            detail:
              'Line 4, /call: The thread tool of chat is marked reads, and a function that only reads what a system holds is a lookup function: save this one with type lookup, with the same call, input.schema and output.schema, and keep interaction functions for tools that act',
          },
        ],
      },
    });
  });
});

describe('the history of a run that calls a tool that acts', () => {
  it('records the call on the run, its start under the id of the run, in the words of the history, with what it sent and what it answered', async () => {
    const server = await askingASystem({ hints: acting });
    await server.define('thread-replies');
    await server.runCall('thread-replies');

    const history = await server.history(systemRunId);

    expect(history.map(({ type, summary }) => [type, summary])).toEqual([
      ['run_started', 'A run of the interaction function “thread-replies” started.'],
      ['tool_call_started', 'A run made tool call 1, to the thread tool of chat.'],
      ['tool_call_answered', 'Tool call 1 answered.'],
      ['run_succeeded', 'A run finished.'],
    ]);
    expect(history[1]?.data).toMatchObject({ call_id: systemRunId, server: 'chat', tool: 'thread' });
    expect(keysOf(history[1])).not.toContain('read_only');
    expect(history[2]?.data).toMatchObject({ is_error: false, result_sha256: aDigest });
  });
});
