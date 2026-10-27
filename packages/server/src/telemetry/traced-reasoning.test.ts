import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { alpha } from '../testing/servers/reasoning-server.ts';
import { promptText, servingTraced, type TracedServer } from '../testing/servers/traced-server.ts';
import { runIdIn } from '../testing/servers/workflow-server.ts';
import { logsIn, spansIn, type ExportedSpan } from '../testing/telemetry/otlp-exports.ts';

const contentAttributes = new Set([
  'gen_ai.input.messages',
  'gen_ai.output.messages',
  'gen_ai.system_instructions',
  'gen_ai.tool.call.arguments',
  'gen_ai.tool.call.result',
]);

const decodeMeta = Schema.decodeUnknownSync(Schema.Struct({ traceparent: Schema.String }));

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(Schema.Struct({ type: Schema.String, metadata: Schema.Struct({ trace_id: Schema.String }) })),
  }),
);

interface TracedRun {
  readonly traceId: string | null;
  readonly spans: readonly ExportedSpan[];
  readonly server: TracedServer;
  readonly history: readonly (readonly [string, string])[];
  readonly exported: string;
}

async function tracedRun(environment: Readonly<Record<string, string>> = {}): Promise<TracedRun> {
  const server = await servingTraced(environment);
  const ran = await server.call('POST', `${alpha}/definitions/reasoning/searching/run`, { body: { input: {} } });
  const history = await server.call('GET', `${alpha}/runs/${runIdIn(ran.body)}/history`);
  await server.stop();
  const received = server.receiver.received();
  return {
    traceId: ran.headers.get('x-trace-id'),
    spans: spansIn(received),
    server,
    history: decodeHistory(history.body).events.map(({ type, metadata }) => [type, metadata.trace_id] as const),
    exported: received.map(({ text }) => text).join('\n'),
  };
}

function named(spans: readonly ExportedSpan[], name: string): ExportedSpan | undefined {
  return spans.find((span) => span.name === name);
}

function namesIn(spans: readonly ExportedSpan[], traceId: string | null): ReadonlySet<string> {
  return new Set(spans.filter((span) => span.traceId === traceId).map(({ name }) => name));
}

function contentRecordedIn(spans: readonly ExportedSpan[]): readonly string[] {
  return [...new Set(spans.flatMap(({ attributes }) => Object.keys(attributes)))].filter((key) =>
    contentAttributes.has(key),
  );
}

describe('a run of a reasoning function that calls a tool, with telemetry on', () => {
  it('is one trace from the request through the call of the model to the call of the tool', async () => {
    const { traceId, spans, server } = await tracedRun();
    const tool = named(spans, 'execute_tool graph__search');
    const [received] = server.tools.received();

    expect(traceId).toMatch(/^[0-9a-f]{32}$/u);
    expect([...namesIn(spans, traceId)]).toEqual(
      expect.arrayContaining([
        'POST /v1/orgs/:org/playbooks/:playbook/definitions/:type/:name/run',
        'run_definition',
        'invoke_agent claude-sonnet-4-5',
        'chat claude-sonnet-4-5',
        'execute_tool graph__search',
        'eventStore.appendToStream',
      ]),
    );
    expect(spans.filter(({ parentSpanId }) => parentSpanId === tool?.spanId).map(({ name }) => name)).toEqual(['POST']);
    expect(decodeMeta(received?.meta).traceparent).toBe(`00-${String(traceId)}-${String(tool?.spanId)}-01`);
  });

  it('records nothing that was sent to the model or the tool, or answered, unless TELEMETRY_CONTENT asks for it', async () => {
    const left = await tracedRun();
    const recorded = await tracedRun({ TELEMETRY_CONTENT: 'true' });

    expect([contentRecordedIn(left.spans), left.exported.includes(promptText)]).toEqual([[], false]);
    expect(contentRecordedIn(recorded.spans)).toEqual(
      expect.arrayContaining(['gen_ai.input.messages', 'gen_ai.tool.call.arguments', 'gen_ai.tool.call.result']),
    );
    expect(recorded.exported).toContain(promptText);
  });
});

describe('the events of a run of a reasoning function that calls a tool, with telemetry on', () => {
  it('keep the trace of the run, as the log record of each does, and so do the meter’s events of its admission', async () => {
    const { traceId, history, server } = await tracedRun();
    const logged = logsIn(server.receiver.received()).filter((log) => log.traceId === traceId);

    expect(history).toEqual(
      [
        'run_started',
        'model_call_started',
        'model_call_answered',
        'tool_call_started',
        'tool_call_answered',
        'model_call_started',
        'model_call_answered',
        'run_succeeded',
      ].map((type) => [type, traceId]),
    );
    expect(logged.map(({ eventName, traceId: logTrace }) => [eventName, logTrace])).toEqual([
      ...['installation_identified', 'actions_counted', 'action_admitted'].map((type) => [type, traceId]),
      ...history.map(([type, trace]) => [type, trace]),
    ]);
  });
});
