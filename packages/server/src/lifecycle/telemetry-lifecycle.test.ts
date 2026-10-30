import { Effect, Layer } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { servedBy } from '../server-options/server-options.ts';
import { optionsComposing, defaultServerOptions } from '../testing/entries/serving-options.ts';
import { logsIn, spansIn } from '../testing/telemetry/otlp-exports.ts';
import { receivingOtlp, type OtlpReceiver } from '../testing/telemetry/otlp-receiver.ts';
import { startServer } from './lifecycle.ts';

async function collector(): Promise<OtlpReceiver> {
  const receiver = await receivingOtlp();
  onTestFinished(receiver.close);
  return receiver;
}

function withTelemetryTo(receiver: OtlpReceiver): Readonly<Record<string, string>> {
  return {
    HOST: '127.0.0.1',
    PORT: '0',
    OTEL_EXPORTER_OTLP_ENDPOINT: receiver.endpoint,
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
  };
}

describe('a server with telemetry', () => {
  it('sends what it logs to the collector as well as to stderr, and flushes it as it stops', async () => {
    const receiver = await collector();
    const server = await startServer(withTelemetryTo(receiver), defaultServerOptions);
    await server.stop();

    const [warning, telemetryOn] = logsIn(receiver.received());

    expect(warning).toMatchObject({ severityText: 'Warn' });
    expect(warning?.body).toMatch(/^Local mode is on/u);
    expect(telemetryOn).toMatchObject({ severityText: 'Info', body: 'Telemetry is on, exported over OTLP' });
  });

  it('stops its telemetry when it cannot start, so a server started after it exports its own', async () => {
    const failed = await collector();
    const failing = optionsComposing(Layer.effectDiscard(Effect.die(new Error('no ledger'))), () => servedBy([]));
    await expect(startServer(withTelemetryTo(failed), failing)).rejects.toThrow('could not start');
    const receiver = await collector();
    const server = await startServer(withTelemetryTo(receiver), defaultServerOptions);
    await fetch(`http://127.0.0.1:${server.port}/nowhere`);
    await server.stop();

    expect(spansIn(receiver.received())).toHaveLength(1);
  });
});
