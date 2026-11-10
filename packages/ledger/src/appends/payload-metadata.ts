import type { Dialect } from '../connection/ledger-connection.ts';

const recordedOnSqlite: readonly string[] = [
  '{"streamName":"playbook/acme/alpha/writings/w1","messageId":"…","streamPosition":"1","correlationId":null,"causationId":null,"traceId":"…","spanId":"…","at":"2026-11-01T09:00:00.000Z","by":"noter","payloadBytes":7096}',
  '{"streamName":"playbook/acme/alpha/writings/w1","messageId":"…","streamPosition":"2","correlationId":null,"causationId":null,"traceId":"…","spanId":"…","at":"2026-11-01T09:00:00.000Z","by":"noter"}',
  '{"streamName":"playbook/acme/alpha/writings/w1","messageId":"…","streamPosition":"3","correlationId":null,"causationId":null,"traceId":"…","spanId":"…","at":"2026-11-01T09:00:00.000Z","by":"noter"}',
  '{"streamName":"playbook/acme/alpha/writings/w1","messageId":"…","streamPosition":"4","correlationId":null,"causationId":null,"traceId":"…","spanId":"…","at":"2026-11-01T09:00:00.000Z","by":"noter"}',
];

const recordedOnPostgresql: readonly string[] = [
  '{"at": "2026-11-01T09:00:00.000Z", "by": "noter", "spanId": "…", "traceId": "…", "causationId": null, "payloadBytes": 7096, "correlationId": null}',
  '{"at": "2026-11-01T09:00:00.000Z", "by": "noter", "spanId": "…", "traceId": "…", "causationId": null, "correlationId": null}',
  '{"at": "2026-11-01T09:00:00.000Z", "by": "noter", "spanId": "…", "traceId": "…", "causationId": null, "correlationId": null}',
  '{"at": "2026-11-01T09:00:00.000Z", "by": "noter", "spanId": "…", "traceId": "…", "causationId": null, "correlationId": null}',
];

export function recordedPayloadMetadataOf(dialect: Dialect): readonly string[] {
  return dialect === 'sqlite' ? recordedOnSqlite : recordedOnPostgresql;
}
