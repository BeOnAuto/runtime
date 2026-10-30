import { randomBytes } from 'node:crypto';

export interface OutcomeRow {
  readonly stream: string;
  readonly position: number;
  readonly type: string;
  readonly data: string;
  readonly metadata: string;
  readonly created: string;
}

interface Fact {
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
}

const daysInTheWindow = 30;

export const firstDay = '2026-09-07';

export const lastDay = '2026-10-06';

const dayInMilliseconds = 86_400_000;

const firstMoment = Date.parse(`${firstDay}T00:00:00Z`);

function text(bytes: number): string {
  return randomBytes(bytes / 2).toString('hex');
}

function statusOf(run: number): string {
  if (run % 20 === 0) {
    return 'run_rejected';
  }
  return run % 33 === 1 ? 'run_failed' : 'run_succeeded';
}

function usageOf(run: number) {
  return { input: { total: 1000 + (run % 500), cache_read: 600 }, output: { total: 200 + (run % 50) } };
}

function finishOf(run: number, recordBytes: number): Fact {
  const type = statusOf(run);
  if (type === 'run_failed') {
    return { type, data: {} };
  }
  if (type === 'run_rejected') {
    return {
      type,
      data: { rejection: { reason: 'unavailable', detail: 'The answer is not JSON' }, record: { usage: usageOf(run) } },
    };
  }
  return { type, data: { output: { text: text(640) }, record: { usage: usageOf(run), prompt: text(recordBytes) } } };
}

function runIdOf(run: number): string {
  return String(run).padStart(8, '0');
}

function contextOf(run: number, at: string): string {
  return JSON.stringify({
    correlationId: runIdOf(run),
    at,
    by: 'user-1',
    runId: runIdOf(run),
    definitionType: 'reasoning',
    definitionName: `fn-${run % 20}`,
    definitionVersion: 1,
  });
}

function rowsOfRun(stream: string, run: number): (position: number, fact: Fact, at: string) => OutcomeRow {
  return (position, { type, data }, at) => ({
    stream,
    position,
    type,
    data: JSON.stringify(data),
    metadata: contextOf(run, at),
    created: at,
  });
}

export function runOf(playbook: string, run: number, recordBytes: number): readonly OutcomeRow[] {
  const startedAt = firstMoment + (run % daysInTheWindow) * dayInMilliseconds + (run % 80_000) * 1000;
  const at = new Date(startedAt).toISOString();
  const finishedAt = new Date(startedAt + 100 + (run % 50) * 97).toISOString();
  const stream = `playbook/o1/${playbook}/runs/${runIdOf(run)}`;
  const row = rowsOfRun(stream, run);
  return [
    row(
      1,
      { type: 'run_started', data: { input: { text: text(320) }, started_by: { id: 'user-1', name: 'user-1' } } },
      at,
    ),
    row(2, finishOf(run, recordBytes), finishedAt),
  ];
}
