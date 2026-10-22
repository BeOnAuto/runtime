import type { Environment } from '@on.auto/config';
import type { AppendObserver } from '@on.auto/ledger';
import { describe, expect, it, onTestFinished } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { logsIn, metricNamesIn } from '../testing/telemetry/otlp-exports.ts';
import { receivingOtlp, type OtlpReceiver } from '../testing/telemetry/otlp-receiver.ts';
import { startTelemetry, type Telemetry } from './start-telemetry.ts';

const stream = 'playbook/acme/alpha/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const runContext = {
  at: '2026-10-13T09:00:00.000Z',
  by: 'playbook:alpha',
  runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  definitionType: 'reasoning',
  definitionName: 'triage',
  definitionVersion: 2,
  depth: 1,
  trigger: { kind: 'event' as const, reference: 'on-ticket' },
};

interface Observed {
  readonly receiver: OtlpReceiver;
  readonly telemetry: Telemetry;
  readonly observer: AppendObserver;
}

async function observed(environment: Environment = {}): Promise<Observed> {
  const receiver = await receivingOtlp();
  onTestFinished(receiver.close);
  const telemetry = startTelemetry(
    readSettingsOf({
      OTEL_EXPORTER_OTLP_ENDPOINT: receiver.endpoint,
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      ...environment,
    }).telemetry,
  );
  if (telemetry.appended === undefined) {
    throw new TypeError('Telemetry is on, so it observes appends');
  }
  return { receiver, telemetry, observer: telemetry.appended };
}

function attributeNamesOf(attributes: Readonly<Record<string, unknown>> | undefined): readonly string[] {
  return Object.keys(attributes ?? {}).toSorted();
}

describe('an event appended to the ledger', () => {
  it('is a log record named for its type, saying where it was kept, for whom and why, without its data', async () => {
    const { receiver, telemetry, observer } = await observed();
    observer.appended(stream, [{ type: 'run_started', data: { input: { ticket: 'T-1' } } }], {
      expectedVersion: 0,
      context: runContext,
      lineage: { causationId: 'cause-1', correlationId: 'run-0' },
    });
    await telemetry.shutdown();
    const [log] = logsIn(receiver.received());

    expect(log).toMatchObject({
      scope: '@on.auto/ledger',
      eventName: 'run_started',
      severityText: 'INFO',
      body: 'run_started',
      attributes: {
        'auto.on.type': 'run_started',
        'auto.on.stream': stream,
        'auto.on.position': 1,
        'auto.on.by': 'playbook:alpha',
        'auto.on.run_id': runContext.runId,
        'auto.on.definition.type': 'reasoning',
        'auto.on.definition.name': 'triage',
        'auto.on.definition.version': 2,
        'auto.on.depth': 1,
        'auto.on.trigger.kind': 'event',
        'auto.on.correlation_id': 'run-0',
        'auto.on.causation_id': 'cause-1',
        'auto.on.data_bytes': 26,
      },
    });
    expect(log?.attributes['auto.on.message_id']).toMatch(/^[0-9a-f-]{36}$/u);
  });
});

describe('an event appended without a run or a chain', () => {
  it('leaves out what its append did not record, and counts a run that ended by how it ended', async () => {
    const { receiver, telemetry, observer } = await observed();
    observer.appended(stream, [{ type: 'run_rejected', data: {} }], {
      expectedVersion: 4,
      context: { at: '2026-10-13T09:00:00.000Z', by: 'tester' },
    });
    await telemetry.shutdown();
    const [log] = logsIn(receiver.received());

    expect(attributeNamesOf(log?.attributes)).toEqual([
      'auto.on.by',
      'auto.on.data_bytes',
      'auto.on.message_id',
      'auto.on.position',
      'auto.on.stream',
      'auto.on.type',
    ]);
    expect(log?.attributes['auto.on.position']).toBe(5);
    expect(metricNamesIn(receiver.received())).toContain('auto.on.runs.ended');
  });
});

describe('an event appended while TELEMETRY_CONTENT asks for content', () => {
  it('carries its data in auto.on.data, cut to 2048 characters', async () => {
    const { receiver, telemetry, observer } = await observed({ TELEMETRY_CONTENT: 'true' });
    observer.appended(stream, [{ type: 'run_started', data: { input: 'x'.repeat(3000) } }], {
      expectedVersion: 0,
      context: runContext,
    });
    await telemetry.shutdown();
    const [log] = logsIn(receiver.received());

    expect(log?.attributes['auto.on.data']).toBe(JSON.stringify({ input: 'x'.repeat(3000) }).slice(0, 2048));
  });
});
