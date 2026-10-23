import { describe, expect, it } from 'vitest';

import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { logTelemetry } from './logging.ts';

describe('logTelemetry', () => {
  it('says nothing when telemetry is off', async () => {
    expect(await linesLoggedBy(logTelemetry())).toEqual([]);
  });

  it('names where each signal goes by its origin alone, and whether content is recorded', async () => {
    const telemetry = readSettingsOf({
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://collector.example.com:4318/v1/traces?token=secret',
      TELEMETRY_CONTENT: 'true',
    }).telemetry;
    const lines = await linesLoggedBy(logTelemetry(telemetry));

    expect(lines.map((line): unknown => JSON.parse(line))).toMatchObject([
      {
        message: 'Telemetry is on, exported over OTLP',
        level: 'INFO',
        annotations: {
          service: 'auto-runtime',
          traces: 'https://collector.example.com:4318 over http/protobuf',
          metrics: 'off',
          logs: 'off',
          content: 'recorded',
        },
      },
    ]);
    expect(lines.join('\n')).not.toContain('secret');
  });

  it('says content is left out unless TELEMETRY_CONTENT asks for it', async () => {
    const [line] = await linesLoggedBy(
      logTelemetry(readSettingsOf({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' }).telemetry),
    );

    expect(line).toContain('"content":"left out"');
  });
});
