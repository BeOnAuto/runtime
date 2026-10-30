import { answers, textResult } from '@on.auto/reasoning/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha } from '../testing/servers/reasoning-server.ts';
import { runIdIn, servingWorkflows, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';
import { spansIn, type ExportedSpan } from '../testing/telemetry/otlp-exports.ts';
import { receivingOtlp } from '../testing/telemetry/otlp-receiver.ts';
import { until } from '../testing/waiting/until.ts';

const summary = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Summarize: {{ input.text }}'].join('\n');

const asking = workflowSource(
  'asking',
  "do:\n  - ask: { call: run_definition, with: { type: reasoning, name: summary, input: { text: 'long' } } }\n",
);

const runPath = 'POST /v1/orgs/:org/playbooks/:playbook/definitions/:type/:name/run';

function childOf(spans: readonly ExportedSpan[], name: string, parent?: ExportedSpan): ExportedSpan | undefined {
  return spans.find((span) => span.name === name && span.parentSpanId === parent?.spanId);
}

function linkedTraces(spans: readonly ExportedSpan[], name: string): readonly string[] {
  return spans.filter((span) => span.name === name).flatMap(({ links }) => links.map(({ traceId }) => traceId));
}

function followedTheRun(spans: readonly ExportedSpan[]): boolean {
  const request = childOf(spans, runPath);
  return request !== undefined && linkedTraces(spans, 'follow run_succeeded').includes(request.traceId);
}

async function spansOfARun(): Promise<readonly ExportedSpan[]> {
  const receiver = await receivingOtlp();
  onTestFinished(receiver.close);
  const server = await servingWorkflows([answers(textResult('Short.'))], {
    OTEL_EXPORTER_OTLP_ENDPOINT: receiver.endpoint,
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
  });
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'asking', source: asking } });
  const started = await server.call('POST', `${alpha}/definitions/workflow/asking/run`, { body: { input: {} } });
  await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);
  await until(() => spansIn(receiver.received()), followedTheRun);
  await server.stop();
  return spansIn(receiver.received());
}

describe('a run of a workflow that calls a function, with telemetry on', () => {
  it('is one trace: the input that started it, the call beneath it, the function beneath the call', async () => {
    const spans = await spansOfARun();
    const request = childOf(spans, runPath);
    const operation = childOf(spans, 'run_definition', request);
    const started = childOf(spans, 'started', operation);
    const call = childOf(spans, 'call run_definition', started);
    const nested = childOf(spans, 'run_definition', call);
    const answered = childOf(spans, 'call_answered', call);
    const settled = childOf(spans, 'settle', answered);

    expect([operation, started, call, nested, answered, settled].map((span) => span?.traceId)).toEqual(
      Array.from({ length: 6 }, () => request?.traceId),
    );
    expect(linkedTraces(spans, 'follow run_succeeded')).toContain(request?.traceId);
  });
});
