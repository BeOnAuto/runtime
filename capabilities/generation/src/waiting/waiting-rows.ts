import { runEventOf } from '@on.auto/definitions';
import { factReaderOf, type KeyedProjection, type ProjectedMessage, type ProjectedRow } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { generationType } from '../capability/generation-type.ts';
import { GenerationDeferredSchema, gatewayNameOf } from './generation-wait.ts';
import { firstPollWaitMs } from './poll-cadence.ts';

export const generationsWaitingName = 'generations_due';

const WaitingRowSchema = Schema.Struct({
  deferred_id: Schema.String,
  handle: Schema.String,
  gateway: Schema.String,
  deferred_at: Schema.Int,
  waits_until: Schema.Int,
  open: Schema.Boolean,
  polls: Schema.Int,
  progress: Schema.NullOr(Schema.Int),
  next_poll_at: Schema.NullOr(Schema.Int),
  poll_due_at: Schema.NullOr(Schema.Int),
  ending_due_at: Schema.NullOr(Schema.Int),
});

export type WaitingRow = typeof WaitingRowSchema.Type;

export const waitingRowFrom: (row: unknown) => WaitingRow = Schema.decodeUnknownSync(WaitingRowSchema);

const decodeRow = Schema.decodeUnknownOption(WaitingRowSchema);

const readDeferral = factReaderOf(GenerationDeferredSchema);

export interface Cadence {
  readonly polls: number;
  readonly progress: number | null;
  readonly next_poll_at: number | null;
  readonly ending_due_at: number | null;
}

export function advancedOf({ polls, progress, next_poll_at: next, ending_due_at: ending }: Cadence): ProjectedRow {
  return { polls, progress, next_poll_at: next, poll_due_at: next, ending_due_at: ending };
}

function deferred(message: ProjectedMessage): ProjectedRow | undefined {
  const fact = message.context.definitionType === generationType ? readDeferral(message) : undefined;
  if (fact === undefined) {
    return undefined;
  }
  const { record } = fact.data;
  const at = Date.parse(fact.context.at);
  const waitsUntil = Date.parse(record.waits_until);
  return {
    deferred_id: message.id,
    handle: record.handle,
    gateway: gatewayNameOf(record.model),
    deferred_at: at,
    waits_until: waitsUntil,
    open: true,
    ...advancedOf({ polls: 0, progress: null, next_poll_at: at + firstPollWaitMs, ending_due_at: waitsUntil }),
  };
}

const endings: ReadonlySet<string> = new Set(['run_succeeded', 'run_rejected', 'run_failed']);

function rowAfter(row: ProjectedRow | undefined, message: ProjectedMessage): ProjectedRow | undefined {
  const fact = runEventOf(message);
  if (fact?.type === 'run_deferred') {
    return deferred(message);
  }
  const kept = row === undefined ? undefined : Option.getOrUndefined(decodeRow(row));
  return kept?.open === true && fact !== undefined && endings.has(fact.type)
    ? { ...kept, open: false, next_poll_at: null, poll_due_at: null, ending_due_at: null }
    : undefined;
}

const setByTheDeferral = ['run_deferred'];

const setByTheDeferralAndTheEnd = ['run_deferred', ...endings];

export const generationsWaiting: KeyedProjection = {
  name: generationsWaitingName,
  version: 1,
  kinds: ['runs'],
  types: ['run_deferred', ...endings],
  columns: [
    { name: 'deferred_id', kind: 'text' },
    { name: 'handle', kind: 'text' },
    { name: 'gateway', kind: 'text' },
    { name: 'deferred_at', kind: 'integer' },
    { name: 'waits_until', kind: 'integer' },
    { name: 'open', kind: 'boolean' },
    { name: 'polls', kind: 'integer' },
    { name: 'progress', kind: 'integer' },
    { name: 'next_poll_at', kind: 'integer' },
    { name: 'poll_due_at', kind: 'integer' },
    { name: 'ending_due_at', kind: 'integer' },
  ],
  indexes: [
    { name: 'polls_due', columns: ['poll_due_at'], acrossPlaybooks: true, whereSet: 'poll_due_at' },
    { name: 'endings_due', columns: ['ending_due_at'], acrossPlaybooks: true, whereSet: 'ending_due_at' },
  ],
  advanced: [
    ...['polls', 'progress', 'next_poll_at'].map((column) => ({ column, setBy: setByTheDeferral })),
    ...['poll_due_at', 'ending_due_at'].map((column) => ({ column, setBy: setByTheDeferralAndTheEnd })),
  ],
  rowAfter,
};
