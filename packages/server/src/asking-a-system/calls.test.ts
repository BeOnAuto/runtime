import { threadReplies } from '@on.auto/tool-servers/testing';
import { describe, expect, it } from 'vitest';

import { chatKey } from '../testing/interaction-servers/chat-deliveries.ts';
import {
  askingASystem,
  systemRunId,
  threadInput,
  type HistoryEvent,
} from '../testing/interaction-servers/system-calls.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';

const aNumber: unknown = expect.any(Number);

const aTime: unknown = expect.any(String);

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const scrubbedChannel: unknown = expect.stringMatching(/^\[redacted\] x{5000}$/u);

const record = { server: 'chat', tool: 'thread', read: '/messages' };

function keysOf(event: HistoryEvent | undefined): readonly string[] {
  return Object.keys(event?.data ?? {});
}

describe('an interaction function that asks a system, over HTTP', () => {
  it('calls the tool once and answers at once with what it read, as get_run answers the run', async () => {
    const server = await askingASystem();
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
    expect(read.body).toEqual(ran.body);
    expect(server.fake.received()).toEqual([
      {
        tool: 'thread',
        arguments: { channel: 'C0123', ts: '1728379900.000050', limit: 100, inclusive: false },
        meta: { 'auto.on/run_id': systemRunId },
      },
    ]);
  });
});

describe('the history of a run that asks a system', () => {
  it('records the call on the run, its start under the id of the run, in the words of the history, with what it sent and what it read', async () => {
    const server = await askingASystem();
    await server.define('thread-replies');
    await server.runCall('thread-replies');

    const history = await server.history(systemRunId);

    expect(history.map(({ type, summary }) => [type, summary])).toEqual([
      ['run_started', 'A run of the interaction function “thread-replies” started.'],
      ['tool_call_started', 'A run made tool call 1, to the thread tool of chat.'],
      ['tool_call_answered', 'Tool call 1 answered.'],
      ['run_succeeded', 'A run finished.'],
    ]);
    expect(history[1]?.data).toMatchObject({
      call_id: systemRunId,
      server: 'chat',
      tool: 'thread',
      arguments_sha256: aDigest,
      arguments: { channel: 'C0123', ts: '1728379900.000050', limit: 100, inclusive: false },
    });
    expect(history[2]?.data).toMatchObject({ is_error: false, duration_ms: aNumber, result_sha256: aDigest });
    expect(keysOf(history[2])).toContain('answer');
  });

  it('keeps the arguments scrubbed, shows their size past 2 KiB, and reads them whole as one event', async () => {
    const server = await askingASystem();
    await server.define('thread-replies');
    await server.runCall('thread-replies', { ...threadInput, channel: `${chatKey} ${'x'.repeat(5000)}` });

    const [, started] = await server.history(systemRunId);
    const whole = await server.call('GET', `${alpha}/events/${String(started?.id)}`);

    expect(keysOf(started)).not.toContain('arguments');
    expect(started?.data['arguments_bytes']).toBeGreaterThan(5000);
    expect(whole.body).toMatchObject({ data: { arguments: { channel: scrubbedChannel } } });
  });
});
