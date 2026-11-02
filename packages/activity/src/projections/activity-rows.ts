import type { RecordedRunEvent } from '@on.auto/definitions';
import type {
  DefinitionContext,
  KeyedProjection,
  ProjectedMessage,
  ProjectedRow,
  ProjectedStream,
  RunContext,
} from '@on.auto/operations';

import { resultKeyOf, versionKeyOf } from '../positions/activity-addresses.ts';
import {
  activityFactOf,
  definitionColumns,
  definitionColumnsOf,
  isTopLevel,
  millisecondsOf,
  triggerOf,
  type ActivityFact,
} from './activity-facts.ts';

export const activityName = 'activity';

type RunStarted = Extract<RecordedRunEvent, { readonly type: 'run_started' }>;

function keyOf({ context }: ProjectedMessage, { kind, id }: ProjectedStream): string | undefined {
  if (kind === 'runs') {
    return resultKeyOf(id);
  }
  const { definitionType, definitionName, definitionVersion } = context;
  return definitionType === undefined || definitionName === undefined || definitionVersion === undefined
    ? undefined
    : versionKeyOf(definitionType, definitionName, definitionVersion);
}

function runOf(context: RunContext, by: string): ProjectedRow {
  return {
    listed: false,
    at: null,
    by,
    change: null,
    ...definitionColumnsOf(context),
    run_id: context.runId,
    trigger: triggerOf(context),
    output_shape: null,
  };
}

function started({ data, context }: RunStarted): ProjectedRow | undefined {
  return isTopLevel(context)
    ? { ...runOf(context, data.started_by.id), output_shape: data.output_shape ?? null }
    : undefined;
}

function succeeded(row: ProjectedRow | undefined, context: RunContext): ProjectedRow | undefined {
  return isTopLevel(context)
    ? { ...(row ?? runOf(context, context.by)), listed: true, at: millisecondsOf(context.at) }
    : undefined;
}

function saved(context: DefinitionContext, change: 'created' | 'updated', by: string): ProjectedRow {
  return {
    listed: true,
    at: millisecondsOf(context.at),
    by,
    change,
    ...definitionColumnsOf(context),
    run_id: null,
    trigger: null,
    output_shape: null,
  };
}

function rowAfterFact(row: ProjectedRow | undefined, fact: ActivityFact): ProjectedRow | undefined {
  if (fact.type === 'run_started') {
    return started(fact);
  }
  if (fact.type === 'run_succeeded') {
    return succeeded(row, fact.context);
  }
  if (fact.type === 'definition_created') {
    return saved(fact.context, 'created', fact.data.created_by.id);
  }
  return fact.type === 'definition_updated' ? saved(fact.context, 'updated', fact.context.by) : undefined;
}

export const activityRows: KeyedProjection = {
  name: activityName,
  version: 1,
  kinds: ['runs', 'definitions'],
  types: ['run_started', 'run_succeeded', 'definition_created', 'definition_updated'],
  columns: [
    { name: 'listed', kind: 'boolean' },
    { name: 'at', kind: 'integer' },
    { name: 'by', kind: 'text' },
    { name: 'change', kind: 'text' },
    ...definitionColumns,
    { name: 'run_id', kind: 'text' },
    { name: 'trigger', kind: 'text' },
    { name: 'output_shape', kind: 'text' },
  ],
  indexes: [
    { name: 'listed', columns: ['listed', 'at', 'row_key'] },
    { name: 'listed_by', columns: ['listed', 'by', 'at', 'row_key'] },
  ],
  keyOf,
  rowAfter: (row, message) => {
    const fact = activityFactOf(message);
    return fact === undefined ? undefined : rowAfterFact(row, fact);
  },
};
