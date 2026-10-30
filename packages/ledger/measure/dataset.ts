import { randomBytes } from 'node:crypto';

interface Row {
  readonly stream: string;
  readonly position: number;
  readonly type: string;
  readonly data: string;
  readonly metadata: string;
}

interface Fact {
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly context: Readonly<Record<string, unknown>>;
}

const largeEvery = 200;

export const longRunId = 'long-running';

export const longRun = `playbook/o1/big/run-logs/${longRunId}`;

const statuses: readonly (readonly [number, number, string])[] = [
  [largeEvery, 13, 'succeeded'],
  [100, 7, 'failed'],
  [20, 5, 'rejected'],
  [25, 3, 'deferred'],
  [33, 1, 'running'],
];

function statusOf(run: number): string {
  return statuses.find(([every, at]) => run % every === at)?.[2] ?? 'succeeded';
}

function text(characters: number): string {
  return randomBytes(characters / 2).toString('hex');
}

export function timeOf(second: number): string {
  return new Date(Date.UTC(2026, 0, 1) + second * 1000).toISOString();
}

export function runIdOf(run: number): string {
  return String(run).padStart(8, '0');
}

export function datasetRunStream(run: number): string {
  return `playbook/o1/big/runs/${runIdOf(run)}`;
}

function metadataOf(context: Readonly<Record<string, unknown>>, correlation: string | undefined): string {
  return JSON.stringify(correlation === undefined ? context : { correlationId: correlation, ...context });
}

function row(stream: string, position: number, { type, data, context }: Fact, correlation?: string): Row {
  return { stream, position, type, data: JSON.stringify(data), metadata: metadataOf(context, correlation) };
}

function definitionOf(run: number, at: string): Readonly<Record<string, unknown>> {
  return {
    at,
    by: 'user-1',
    runId: runIdOf(run),
    definitionType: 'reasoning',
    definitionName: `definition-${run % 50}`,
    definitionVersion: 1,
  };
}

function finishOf(run: number, at: string): readonly Row[] {
  const status = statusOf(run);
  const facts: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
    failed: {},
    rejected: { rejection: { reason: 'unavailable', detail: 'try again later' } },
    deferred: { record: {} },
    succeeded: { output: { text: text(run % largeEvery === 13 ? 1_048_576 : 640) }, record: {} },
  };
  const finished = { type: `run_${status}`, data: facts[status] ?? {}, context: definitionOf(run, at) };
  return run < 0 || status === 'running' ? [] : [row(datasetRunStream(run), 2, finished, runIdOf(run))];
}

function inputsOf(t: number, at: string): readonly Row[] {
  return Array.from({ length: t % 10 === 0 ? 20 : 0 }, (_, index) =>
    row(
      `playbook/o1/big/run-logs/${runIdOf(t)}`,
      index + 1,
      { type: 'input_applied', data: { type: 'input_applied', patch: text(2048) }, context: { at, by: 'user-1' } },
      runIdOf(t),
    ),
  );
}

export function tick(t: number): readonly Row[] {
  const at = timeOf(t);
  const input = { text: text(t % largeEvery === 13 ? 262_144 : 320) };
  const others = Array.from({ length: 7 }, (_, index) =>
    row(`playbook/o2/other-${t % 99}/runs/${t}-${index}`, 1, {
      type: 'run_started',
      data: { input: text(512) },
      context: { at, by: 'user-2' },
    }),
  );
  const started = row(
    datasetRunStream(t),
    1,
    { type: 'run_started', data: { input }, context: definitionOf(t, at) },
    runIdOf(t),
  );
  const longStart =
    t === 0
      ? [
          {
            ...started,
            stream: `playbook/o1/big/runs/${longRunId}`,
            metadata: metadataOf({ at, by: 'user-1' }, longRunId),
          },
        ]
      : [];
  return [
    started,
    ...finishOf(t - 1, at),
    ...inputsOf(t, at),
    ...others,
    ...longStart,
    row(
      longRun,
      t + 1,
      { type: 'input_applied', data: { type: 'input_applied' }, context: { at, by: 'user-1' } },
      longRunId,
    ),
  ];
}

const laterContext = '{"at":"2026-06-01T00:00:00.000Z","by":"user-3"}';

export const othersInSQLite = `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1000000)
  INSERT INTO emt_messages (stream_id, stream_position, partition, message_data, message_metadata,
    message_schema_version, message_type, message_id)
  SELECT 'playbook/o3/other-' || (i % 50) || '/runs/' || i, 1, 'emt:default', '{"input":null}', '${laterContext}',
    '1', 'run_started', 'later-' || i FROM n`;

export const othersInPostgreSQL = `INSERT INTO emt_messages (stream_id, stream_position, message_data, message_metadata,
    message_schema_version, message_type, message_id, transaction_id)
  SELECT 'playbook/o3/other-' || (i % 50) || '/runs/' || i, 1, jsonb_build_object('json', '{"input":null}'),
    '${laterContext}', '1', 'run_started', 'later-' || i, pg_current_xact_id()
  FROM generate_series(1, 1000000) AS i`;
