import { goalsDocumentOf, type GoalsDocument } from '@on.auto/definitions/goals';
import { playbookLedgerOf } from '@on.auto/operations';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { opened } from '../conditions/condition-samples.ts';
import { goalsAssessedLeftOutOf } from './assessed-goals.ts';
import { noReads } from './assessor-fixtures.ts';
import { bookOf, controls, deliveredAll, experiments, finished, monday, sales } from './assessor-ledger.ts';
import { assessorOf } from './assessor.ts';

const documentOf = (goals: readonly unknown[]): GoalsDocument =>
  Result.getOrThrow(goalsDocumentOf(JSON.stringify(goals)));

describe('the goals that have been assessed', () => {
  it('are those left out of a new list that have an assessment, read from the assessments alone', async () => {
    const book = bookOf();
    await book.goalsSaved([experiments, controls]);
    await book.workflowSaved('measure', 1, [
      { goal: 'paying-customers', purpose: 'Measures each experiment.', per_id: '/issue', measures: '/customers' },
    ]);
    const assessor = assessorOf({
      ledger: book.ledger,
      chainsOf: () => noReads,
      callers: { serviceCallers: new Set() },
      filters: opened().sandbox,
      now: () => monday,
    });
    const assessedIn = (document: GoalsDocument) =>
      Effect.runPromise(Effect.provideContext(goalsAssessedLeftOutOf(document), playbookLedgerOf(book.ledger, sales)));

    const before = await assessedIn(documentOf([controls]));
    await deliveredAll(assessor, finished({ id: 'r1', data: { output: { issue: 'MAR-41', customers: 0 } } }));

    expect([...before]).toEqual([]);
    expect([...(await assessedIn(documentOf([controls])))]).toEqual(['paying-customers']);
    expect([...(await assessedIn(documentOf([experiments])))]).toEqual([]);
  });
});
