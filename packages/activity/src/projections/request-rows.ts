import { isRequestRecord } from '@on.auto/definitions';
import type { KeyedProjection, ProjectedRow, RunContext } from '@on.auto/operations';
import type { Schema } from 'effect';

import {
  activityFactOf,
  definitionColumns,
  definitionColumnsOf,
  lineOf,
  millisecondsOf,
  triggerOf,
  type ActivityFact,
} from './activity-facts.ts';

export const requestsName = 'activity_requests';

export const anyMember = 'any_member';

export const mostAnswerSchemaBytes = 8192;

const utf8 = new TextEncoder();

const endings: ReadonlySet<string> = new Set(['request_answered', 'run_succeeded', 'run_rejected', 'run_failed']);

export function waitsOnOf(party: string): string {
  return party.includes('@') ? party.trim().toLowerCase() : anyMember;
}

function answerSchemaOf(schema: Schema.JsonObject): string | null {
  const text = JSON.stringify(schema);
  return utf8.encode(text).byteLength <= mostAnswerSchemaBytes ? text : null;
}

function runOf(context: RunContext, by: string): ProjectedRow {
  return {
    open: false,
    at: null,
    by,
    ...definitionColumnsOf(context),
    trigger: triggerOf(context),
    message: null,
    answer_schema: null,
    waits_on: null,
    expires_at: null,
  };
}

function requested(row: ProjectedRow | undefined, record: unknown, context: RunContext): ProjectedRow | undefined {
  if (!isRequestRecord(record) || record.answer_schema === undefined) {
    return undefined;
  }
  return {
    ...(row ?? runOf(context, context.by)),
    ...definitionColumnsOf(context),
    trigger: triggerOf(context),
    open: true,
    at: millisecondsOf(context.at),
    message: lineOf(record.message),
    answer_schema: answerSchemaOf(record.answer_schema),
    waits_on: waitsOnOf(record.to),
    expires_at: millisecondsOf(record.expires_at),
  };
}

function closed(row: ProjectedRow | undefined): ProjectedRow | undefined {
  return row?.['open'] === true ? { ...row, open: false } : undefined;
}

function rowAfterFact(row: ProjectedRow | undefined, fact: ActivityFact): ProjectedRow | undefined {
  if (fact.type === 'run_started') {
    return { ...runOf(fact.context, fact.data.started_by.id), ...row, by: fact.data.started_by.id };
  }
  if (fact.type === 'run_deferred') {
    return requested(row, fact.data.record, fact.context);
  }
  return endings.has(fact.type) ? closed(row) : undefined;
}

export const requestRows: KeyedProjection = {
  name: requestsName,
  version: 1,
  kinds: ['runs'],
  types: ['run_started', 'run_deferred', 'request_answered', 'run_succeeded', 'run_rejected', 'run_failed'],
  columns: [
    { name: 'open', kind: 'boolean' },
    { name: 'at', kind: 'integer' },
    { name: 'by', kind: 'text' },
    ...definitionColumns,
    { name: 'trigger', kind: 'text' },
    { name: 'message', kind: 'text' },
    { name: 'answer_schema', kind: 'text' },
    { name: 'waits_on', kind: 'text' },
    { name: 'expires_at', kind: 'integer' },
  ],
  indexes: [
    { name: 'open', columns: ['open', 'at', 'row_key'] },
    { name: 'open_waits_on', columns: ['open', 'waits_on', 'at', 'row_key'] },
  ],
  rowAfter: (row, message) => {
    const fact = activityFactOf(message);
    return fact === undefined ? undefined : rowAfterFact(row, fact);
  },
};
