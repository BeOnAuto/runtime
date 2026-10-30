import {
  factReaderOf,
  type ProjectedMessage,
  type RunOutcome,
  type RunOutcomeMapping,
  type RunOutcomeStatus,
} from '@on.auto/operations';
import { Predicate, Schema } from 'effect';

import { RunFailedSchema, RunRejectedSchema, RunStartedSchema, RunSucceededSchema } from '../runs/run-events.ts';

const RunOutcomeFactSchema = Schema.Union([RunStartedSchema, RunSucceededSchema, RunFailedSchema, RunRejectedSchema]);

type RunOutcomeFact = typeof RunOutcomeFactSchema.Type;

type Started = Extract<RunOutcomeFact, { readonly type: 'run_started' }>;

type Finished = Exclude<RunOutcomeFact, Started>;

const readRunFact = factReaderOf(RunOutcomeFactSchema);

function isATime(at: string): boolean {
  return Number.isFinite(Date.parse(at));
}

function recordOf(fact: Finished): unknown {
  return fact.type === 'run_failed' ? undefined : fact.data.record;
}

const statusOf: Readonly<Record<Finished['type'], RunOutcomeStatus>> = {
  run_succeeded: 'succeeded',
  run_failed: 'failed',
  run_rejected: 'rejected',
};

const noTokens = { inputTokens: null, outputTokens: null, cachedTokens: null };

function dayOf(at: string): string {
  return new Date(Date.parse(at)).toISOString().slice(0, 10);
}

function countAt(record: unknown, path: readonly string[]): number | null {
  const found = path.reduce<unknown>(
    (value, key) => (Predicate.isObject(value) && Predicate.hasProperty(value, key) ? value[key] : undefined),
    record,
  );
  return typeof found === 'number' && Number.isSafeInteger(found) && found >= 0 ? found : null;
}

type Tokens = Pick<RunOutcome, 'inputTokens' | 'outputTokens' | 'cachedTokens'>;

function sumOf(kept: number | null, spent: number | null): number | null {
  if (kept === null || spent === null) {
    return kept ?? spent;
  }
  return kept + spent;
}

function tokensAfter(kept: Tokens, record: unknown): Tokens {
  return {
    inputTokens: sumOf(kept.inputTokens, countAt(record, ['usage', 'input', 'total'])),
    outputTokens: sumOf(kept.outputTokens, countAt(record, ['usage', 'output', 'total'])),
    cachedTokens: sumOf(kept.cachedTokens, countAt(record, ['usage', 'input', 'cache_read'])),
  };
}

function durationBetween(startedAt: string, finishedAt: string): number | null {
  const duration = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isSafeInteger(duration) ? Math.max(0, duration) : null;
}

type Attempt = Pick<RunOutcome, 'lastStartedAt' | 'status' | 'durationMs'>;

function started(row: RunOutcome | undefined, { context }: Started): RunOutcome {
  const { at, definitionType: type, definitionName: name } = context;
  const again: Attempt = { lastStartedAt: at, status: 'started', durationMs: null };
  return row === undefined
    ? { startedDay: dayOf(at), startedAt: at, definitionType: type, name, ...again, ...noTokens }
    : { ...row, ...again };
}

function finished(row: RunOutcome | undefined, fact: Finished): RunOutcome {
  const { at } = fact.context;
  const record = recordOf(fact);
  const status = statusOf[fact.type];
  if (row === undefined) {
    const notStarted = { startedDay: dayOf(at), startedAt: at, lastStartedAt: at, definitionType: '', name: '' };
    return { ...notStarted, status, durationMs: null, ...tokensAfter(noTokens, record) };
  }
  const durationMs = status === 'rejected' ? null : durationBetween(row.lastStartedAt, at);
  return { ...row, status, durationMs, ...tokensAfter(row, record) };
}

function afterTheFact(row: RunOutcome | undefined, fact: RunOutcomeFact): RunOutcome {
  return fact.type === 'run_started' ? started(row, fact) : finished(row, fact);
}

export const runOutcomeMapping: RunOutcomeMapping = {
  types: ['run_started', 'run_succeeded', 'run_failed', 'run_rejected'],
  rowAfter: (row, message: ProjectedMessage) => {
    const fact = readRunFact(message);
    return fact === undefined || !isATime(fact.context.at) ? undefined : afterTheFact(row, fact);
  },
};
