import { withMcpSession, type ToolResult } from '@on.auto/api/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { askingASystem, calling, systemRunId, type SystemServer } from '../testing/interaction-servers/system-calls.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';

const kibibytes = 5120;

const wholeText = '😀'.repeat(kibibytes * 256);

const unknownEvent = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7f';

const AnsweredSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  data: Schema.Struct({
    result_bytes: Schema.Int,
    result: Schema.Struct({ content: Schema.Tuple([Schema.Struct({ type: Schema.String, text: Schema.String })]) }),
    answer: Schema.String,
  }),
});

const decodeAnswered = Schema.decodeUnknownSync(AnsweredSchema);

const decodeShown = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Record(Schema.String, Schema.Json) }));

const wholeFields: ReadonlySet<string> = new Set(['result', 'answer']);

async function answeredInFull(): Promise<{ readonly server: SystemServer; readonly answered: string }> {
  const server = await askingASystem();
  await server.define('large', calling('large', [`    kib: ${kibibytes}`]));
  await server.runCall('large');
  const history = await server.history(systemRunId);
  const answered = history.find(({ type }) => type === 'tool_call_answered');
  return { server, answered: String(answered?.id) };
}

function readOverMcp(server: SystemServer, eventId: string): Promise<ToolResult> {
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
    (session) => session.callTool('get_event', { event_id: eventId }),
  );
}

describe('one event read whole by its id', () => {
  it('joins in a 5 MiB answer of a tool and the document read from it over HTTP, and gives the sizes of both past 64 KiB over MCP', async () => {
    const { server, answered } = await answeredInFull();

    const overHttp = await server.call('GET', `${alpha}/events/${answered}`);
    const overMcp = await readOverMcp(server, answered);
    const { data } = decodeAnswered(overHttp.body);

    expect(overHttp.status).toBe(200);
    expect([data.result.content[0].text === wholeText, data.answer === wholeText]).toEqual([true, true]);
    expect(data.result_bytes).toBeGreaterThan(kibibytes * 1024);
    expect(overMcp.structuredContent).toMatchObject({
      id: answered,
      type: 'tool_call_answered',
      data: { result_bytes: data.result_bytes, answer_bytes: kibibytes * 1024 + 2 },
    });
    expect(Object.keys(decodeShown(overMcp.structuredContent).data).filter((key) => wholeFields.has(key))).toEqual([]);
  });

  it('answers not_found for an id the playbook does not hold, a step its record does not have, and an event of another playbook', async () => {
    const server = await askingASystem();
    await server.define('thread-replies');
    await server.runCall('thread-replies');
    const [started] = await server.history(systemRunId);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'beta', name: 'Beta' } });

    const refused = [
      await server.call('GET', `${alpha}/events/${unknownEvent}`),
      await server.call('GET', `${alpha}/events/${String(started?.id)}_1`),
      await server.call('GET', `/v1/orgs/acme/playbooks/beta/events/${String(started?.id)}`),
    ];
    const malformed = await server.call('GET', `${alpha}/events/not-an-event`);

    expect(refused.map(({ status }) => status)).toEqual([404, 404, 404]);
    expect(refused.map(({ body }) => body)).toMatchObject([
      { reason: 'not_found' },
      { reason: 'not_found' },
      { reason: 'not_found' },
    ]);
    expect(malformed).toMatchObject({ status: 422, body: { reason: 'invalid_input' } });
  });
});
