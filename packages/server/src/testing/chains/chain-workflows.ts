import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { movedClock, type MovedClock } from '@on.auto/workflow-host/testing';
import { Schema } from 'effect';

import { alpha, servingReasoning, type ReasoningServer } from '../servers/reasoning-server.ts';
import { workflowSource } from '../servers/workflow-server.ts';
import { until } from '../waiting/until.ts';
import type { Opened } from './chain-ledger.ts';

const opsKey = createApiKey({ id: 'ops-key', org: 'acme', permissions: allPermissions, playbooks: '*' });

const aMinuteAndASecond = 61_000;

export interface Labelled {
  readonly labels: ReadonlyMap<string, string>;
  readonly at: number;
}

export type Labels = ReadonlyMap<string, string>;

const keptLabel = "output: { as: '${ $input }' }";

function measured(label: string): readonly string[] {
  return [
    `  - nest: { call: run_definition, with: { type: workflow, name: measure, input: { label: '${label}' } }, ${keptLabel} }`,
  ];
}

function told(type: string, label: string): readonly string[] {
  return [
    `  - tell: { emit: { event: { with: { type: ${type}, source: https://example.com/runs, data: { label: '${label}' } } } }, ${keptLabel} }`,
  ];
}

const labelKept = "  - keep: { set: { label: '${ $data.label }' } }";

function source(name: string, lines: readonly string[]): readonly [string, string] {
  return [name, workflowSource(name, [...lines, ''].join('\n'))];
}

const fromTheEvent = "  - start: { set: { label: '${ $data[0].data.label }' } }";

const definitions: readonly (readonly [string, string])[] = [
  source('measure', ['do:', labelKept]),
  source('parent', [
    'do:',
    ...measured('${ $data.label }'),
    ...told('com.example.ping', '${ $data.label }'),
    labelKept,
  ]),
  source('tick', [
    'schedule:',
    "  cron: '* * * * *'",
    'do:',
    '  - start: { set: { label: schedule } }',
    ...measured('${ $data.label }'),
    ...told('com.example.ping', '${ $data.label }'),
    labelKept,
  ]),
  source('yearly', [
    'schedule:',
    "  cron: '0 3 1 1 *'",
    'do:',
    ...measured('${ $data.label }'),
    ...told('com.example.ping', '${ $data.label }'),
    labelKept,
  ]),
  source('pulse', [
    'schedule:',
    '  every: PT1M',
    'do:',
    '  - start: { set: { label: schedule } }',
    ...measured('${ $data.label }'),
    ...told('com.example.ping', '${ $data.label }'),
    labelKept,
  ]),
  source('on-ping', [
    'schedule:',
    '  on: { one: { with: { type: com.example.ping } } }',
    'do:',
    fromTheEvent,
    ...measured('${ $data.label }'),
    ...told('com.example.pong', '${ $data.label }'),
    labelKept,
  ]),
  source('on-pong', [
    'schedule:',
    '  on: { one: { with: { type: com.example.pong } } }',
    'do:',
    fromTheEvent,
    labelKept,
  ]),
  source('after-parent', [
    'schedule:',
    '  on: { one: { with: { type: run_succeeded, subject: workflow/parent } } }',
    'do:',
    "  - keep: { set: { label: '${ $data[0].data.output.label }' } }",
  ]),
];

export const expectedRuns = { person: 15, machine: 15, schedule: 10 };

const ListedRuns = Schema.Struct({
  runs: Schema.Array(Schema.Struct({ run_id: Schema.String, status: Schema.String, name: Schema.String })),
});

const SettledRun = Schema.Struct({ output: Schema.Struct({ label: Schema.String }) });

type ListedRun = (typeof ListedRuns.Type)['runs'][number];

export function countOf(labels: Labels, label: string): number {
  return [...labels.values()].filter((one) => one === label).length;
}

function serving(opened: Opened, clock: MovedClock, environment: Readonly<Record<string, string>> = {}) {
  return servingReasoning([], { ...opened.environment, ...environment }, undefined, { clock, ledger: opened.ledger });
}

function asked(key: string | undefined) {
  return key === undefined ? {} : { key };
}

async function listedRuns(server: ReasoningServer, key: string | undefined): Promise<readonly ListedRun[]> {
  const listed = await server.call('GET', `${alpha}/runs?type=workflow&limit=100`, asked(key));
  return Schema.decodeUnknownSync(ListedRuns)(listed.body).runs;
}

async function labelsOf(server: ReasoningServer, runs: readonly ListedRun[], key: string | undefined): Promise<Labels> {
  const labelled = await Promise.all(
    runs.map(async ({ run_id: run }) => {
      const answered = await server.call('GET', `${alpha}/runs/${run}`, asked(key));
      const label: readonly [string, string] = [run, Schema.decodeUnknownSync(SettledRun)(answered.body).output.label];
      return label;
    }),
  );
  return new Map(labelled);
}

interface Settling {
  readonly key?: string;
  readonly whenRead?: (runs: readonly ListedRun[]) => void;
}

interface Seen {
  readonly runs: readonly ListedRun[];
  readonly labels: Labels;
}

function startedIn(runs: readonly ListedRun[]): number {
  return runs.filter(({ status }) => status === 'started').length;
}

async function settledLabels(
  server: ReasoningServer,
  holds: (seen: Seen) => boolean,
  settling: Settling = {},
): Promise<Labels> {
  const seen = await until(
    async (): Promise<Seen> => {
      const runs = await listedRuns(server, settling.key);
      settling.whenRead?.(runs);
      const ended = runs.filter(({ status }) => status !== 'started');
      return { runs, labels: await labelsOf(server, ended, settling.key) };
    },
    (read) => read.labels.size === read.runs.length && holds(read),
  );
  return seen.labels;
}

async function definedIn(server: ReasoningServer): Promise<void> {
  await definitions.reduce<Promise<unknown>>(
    (before, [name, text]) =>
      before.then(() => server.call('POST', `${alpha}/definitions/workflow`, { body: { name, source: text } })),
    Promise.resolve(),
  );
}

function startedBy(server: ReasoningServer, label: string, key?: string) {
  const options = asked(key);
  return Promise.all([
    server.call('POST', `${alpha}/definitions/workflow/measure/run`, { ...options, body: { input: { label } } }),
    server.call('POST', `${alpha}/definitions/workflow/parent/run`, { ...options, body: { input: { label } } }),
    server.call('POST', `${alpha}/definitions/workflow/yearly/run`, { ...options, body: { input: { label } } }),
    server.call('POST', `${alpha}/events`, {
      ...options,
      body: { event: { source: 'https://example.com/started', type: 'com.example.ping', data: { label } } },
    }),
  ]);
}

function movedUntilAnInterval(clock: MovedClock): (runs: readonly ListedRun[]) => void {
  return (runs) => {
    const intervals = runs.filter(({ name }) => name === 'pulse').length;
    if (startedIn(runs) + intervals === 0) {
      clock.moveTo(clock.now() + aMinuteAndASecond);
    }
  };
}

export async function byAPersonAndASchedule(opened: Opened): Promise<Labelled> {
  const clock = movedClock(Date.now());
  const server = await serving(opened, clock);
  try {
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await definedIn(server);
    await startedBy(server, 'person');
    await settledLabels(server, ({ labels }) => countOf(labels, 'person') >= expectedRuns.person);
    const labels = await settledLabels(
      server,
      ({ runs, labels: found }) =>
        runs.some(({ name }) => name === 'pulse') && countOf(found, 'schedule') >= expectedRuns.schedule,
      {
        whenRead: movedUntilAnInterval(clock),
      },
    );
    return { labels, at: clock.now() };
  } finally {
    await server.stop();
  }
}

export async function byAKey(opened: Opened, at: number): Promise<Labels> {
  const server = await serving(opened, movedClock(at), { API_KEYS: JSON.stringify([opsKey.entry]) });
  const { key } = opsKey;
  try {
    await startedBy(server, 'machine', key);
    return await settledLabels(server, ({ labels }) => countOf(labels, 'machine') >= expectedRuns.machine, { key });
  } finally {
    await server.stop();
  }
}
