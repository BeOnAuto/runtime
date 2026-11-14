import type { Context } from '@on.auto/operations';
import type { FollowedRecord } from '@on.auto/workflow-host';
import { Effect, Struct } from 'effect';

import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import type { ChainReads } from '../chain-origins/chain-origins.ts';
import { opened } from '../conditions/condition-samples.ts';
import { bookOf, controls, experiments, finished, monday, type Book } from './assessor-ledger.ts';
import type { AssessorPorts } from './run-planner.ts';

export const measuring = [
  {
    goal: 'paying-customers',
    purpose: 'Measures what each experiment brought in.',
    each: '/results',
    per_id: '/issue',
    measures: '/customers',
  },
];

export const results = (...customers: readonly number[]) => ({
  output: { results: customers.map((count, index) => ({ issue: `MAR-${String(41 + index)}`, customers: count })) },
});

export const experimentId = (issue: string) => assessmentIdOf({ goal: 'paying-customers', per: issue });

const readOfNothing = () => Effect.die(new Error('A run on a schedule needs no read of who began it'));

export const noReads: ChainReads<never> = { firstFactOf: readOfNothing, recordOf: readOfNothing };

export const byHand: Partial<Context> = { by: 'person:owner' };

interface Built {
  readonly book: Book;
  readonly ports: AssessorPorts<unknown>;
}

export async function built(chains: ChainReads<unknown> = noReads, now = () => monday + 60_000): Promise<Built> {
  const book = bookOf();
  await book.goalsSaved([experiments, controls]);
  await book.workflowSaved('measure', 1, measuring);
  return {
    book,
    ports: {
      ledger: book.ledger,
      chainsOf: () => chains,
      callers: { serviceCallers: new Set() },
      filters: opened().sandbox,
      now,
    },
  };
}

export function lacking(id: string, key: 'definitionName' | 'definitionVersion' | 'runId'): FollowedRecord {
  const followed = finished({ id });
  return { ...followed, record: { ...followed.record, context: Struct.omit(followed.record.context, [key]) } };
}

export function calledBy(followed: FollowedRecord, top: string): FollowedRecord {
  return { ...followed, record: { ...followed.record, correlationId: top } };
}
