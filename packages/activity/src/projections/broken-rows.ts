import type { RecordedRunEvent } from '@on.auto/definitions';
import type {
  DefinitionContext,
  KeyedProjection,
  ProjectedMessage,
  ProjectedRow,
  RunContext,
} from '@on.auto/operations';

import { brokenKeyOf } from '../positions/activity-addresses.ts';
import { activityFactOf, isTopLevel, lineOf, millisecondsOf, triggerOf, type ActivityFact } from './activity-facts.ts';

export const brokenName = 'activity_broken';

type BrokenStatus = 'failed' | 'rejected';

type RunRejected = Extract<RecordedRunEvent, { readonly type: 'run_rejected' }>;

const reasonsThatBreakNothing: ReadonlySet<string> = new Set(['cancelled', 'unanswered']);

interface Ending {
  readonly context: RunContext;
  readonly status: BrokenStatus;
  readonly detail: string | null;
}

function nameOfTheRow(message: ProjectedMessage): string | undefined {
  const fact = activityFactOf(message);
  return fact?.type === 'definition_renamed' ? fact.data.from : message.context.definitionName;
}

function keyOf(message: ProjectedMessage): string | undefined {
  const { definitionType } = message.context;
  const name = nameOfTheRow(message);
  return definitionType === undefined || name === undefined ? undefined : brokenKeyOf(definitionType, name);
}

function numberIn(row: ProjectedRow | undefined, column: string): number {
  const value = row?.[column];
  return typeof value === 'number' ? value : 0;
}

function definitionOf({ definitionType, definitionName }: DefinitionContext): ProjectedRow {
  return {
    open: false,
    at: null,
    status: null,
    definition_type: definitionType,
    definition_name: definitionName,
    version: null,
    current_version: null,
    run_id: null,
    detail: null,
    ended_by: null,
    trigger: null,
  };
}

function saved(row: ProjectedRow | undefined, context: DefinitionContext): ProjectedRow {
  return { ...(row ?? definitionOf(context)), open: false, current_version: context.definitionVersion };
}

function retired(row: ProjectedRow | undefined): ProjectedRow | undefined {
  return row === undefined ? undefined : { ...row, open: false };
}

function isBehind(row: ProjectedRow | undefined, version: number): boolean {
  const openOn = row?.['open'] === true ? numberIn(row, 'version') : 0;
  return version < Math.max(numberIn(row, 'current_version'), openOn);
}

function broke(row: ProjectedRow | undefined, { context, status, detail }: Ending): ProjectedRow | undefined {
  const version = context.definitionVersion;
  if (!isTopLevel(context) || isBehind(row, version)) {
    return undefined;
  }
  return {
    ...(row ?? definitionOf(context)),
    open: true,
    at: millisecondsOf(context.at),
    status,
    version,
    run_id: context.runId,
    detail,
    ended_by: context.by,
    trigger: triggerOf(context),
  };
}

function succeeded(row: ProjectedRow | undefined, { definitionVersion }: RunContext): ProjectedRow | undefined {
  return row?.['open'] === true && definitionVersion >= numberIn(row, 'version') ? { ...row, open: false } : undefined;
}

function detailOf(detail: string): string | null {
  const line = lineOf(detail);
  return line === '' ? null : line;
}

function rejected(row: ProjectedRow | undefined, fact: RunRejected): ProjectedRow | undefined {
  const { rejection } = fact.data;
  return reasonsThatBreakNothing.has(rejection.reason)
    ? undefined
    : broke(row, { context: fact.context, status: 'rejected', detail: detailOf(rejection.detail) });
}

function rowAfterRun(row: ProjectedRow | undefined, fact: ActivityFact): ProjectedRow | undefined {
  if (fact.type === 'run_failed') {
    return broke(row, { context: fact.context, status: 'failed', detail: null });
  }
  if (fact.type === 'run_rejected') {
    return rejected(row, fact);
  }
  return fact.type === 'run_succeeded' ? succeeded(row, fact.context) : undefined;
}

function rowAfterFact(row: ProjectedRow | undefined, fact: ActivityFact): ProjectedRow | undefined {
  if (fact.type === 'definition_created' || fact.type === 'definition_updated') {
    return saved(row, fact.context);
  }
  return fact.type === 'definition_retired' || fact.type === 'definition_renamed'
    ? retired(row)
    : rowAfterRun(row, fact);
}

export const brokenRows: KeyedProjection = {
  name: brokenName,
  version: 1,
  scopes: ['definition'],
  kinds: ['runs', 'definitions'],
  types: [
    'definition_created',
    'definition_updated',
    'definition_retired',
    'definition_renamed',
    'run_failed',
    'run_rejected',
    'run_succeeded',
  ],
  columns: [
    { name: 'open', kind: 'boolean' },
    { name: 'at', kind: 'integer' },
    { name: 'status', kind: 'text' },
    { name: 'definition_type', kind: 'text' },
    { name: 'definition_name', kind: 'text' },
    { name: 'version', kind: 'integer' },
    { name: 'current_version', kind: 'integer' },
    { name: 'run_id', kind: 'text' },
    { name: 'detail', kind: 'text' },
    { name: 'ended_by', kind: 'text' },
    { name: 'trigger', kind: 'text' },
  ],
  indexes: [{ name: 'open', columns: ['open', 'at', 'row_key'] }],
  keyOf,
  rowAfter: (row, message) => {
    const fact = activityFactOf(message);
    return fact === undefined ? undefined : rowAfterFact(row, fact);
  },
};
