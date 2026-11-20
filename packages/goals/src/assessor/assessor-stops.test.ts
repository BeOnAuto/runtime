import type { Context } from '@on.auto/operations';
import type { FollowedRecord } from '@on.auto/workflow-host';
import { describe, expect, it } from 'vitest';

import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { built, calledBy, experimentId, results, startedAs } from './assessor-fixtures.ts';
import { controls, deliveredAll, experiments, finished, onSchedule } from './assessor-ledger.ts';
import { goalIdentityOf } from './assessor-ledger.ts';
import { assessorOf } from './assessor.ts';
import { failedRunWords } from './run-observations.ts';

const measured = finished({ id: 'measured', data: results(0) });

const inItsChain: Partial<Context> = { by: 'playbook:sales' };

const failedAfter = (id: string, type: string, data: unknown, context = inItsChain) =>
  calledBy(finished({ id, type, data, context }), 'run-measured');

const longReason = `The lookup of the orders was refused: ${'the server answered with an error. '.repeat(8)}`;

async function measuredThen(...more: readonly FollowedRecord[]) {
  const { book, ports } = await built(startedAs(measured, ...more));
  const assessor = assessorOf(ports);
  await deliveredAll(assessor, measured);
  return { book, assessor };
}

describe('a failed run of a contributing workflow whose chain reaches an open item', () => {
  it('stops the item with its own reason, which stays open with no verdict, once however often it is delivered', async () => {
    const failed = failedAfter('failed', 'run_failed', { incident: 'incident-1' });
    const { book, assessor } = await measuredThen();

    const first = await deliveredAll(assessor, failed);
    const again = await deliveredAll(assessor, failed);
    const rows = await book.rows(assessmentsName);

    expect([first.keys, again.keys]).toEqual([[`s:${experimentId('MAR-41')}`], [`s:${experimentId('MAR-41')}`]]);
    expect(rows[experimentId('MAR-41')]).toMatchObject({ open: true, verdict: 'open', stopped_run: 'run-failed' });
    expect(await book.factsOf('paying-customers', `assessments/${experimentId('MAR-41')}`)).toEqual([
      'goal_assessment_opened',
      'goal_observed',
      'goal_stopped',
    ]);
    expect(rows[experimentId('MAR-41')]?.['state']).toContain(failedRunWords);
  });

  it('takes the words of a rejected run, at most two hundred characters', async () => {
    const rejected = failedAfter('rejected', 'run_rejected', { rejection: { reason: 'conflict', detail: longReason } });
    const { book, assessor } = await measuredThen();

    await deliveredAll(assessor, rejected);
    const state = String((await book.rows(assessmentsName))[experimentId('MAR-41')]?.['state']);

    expect(state).toContain(`"reason":"${longReason.slice(0, 200)}"`);
    expect(state).not.toContain(longReason.slice(0, 201));
  });
});

describe('a failed run that stops nothing', () => {
  it('is one whose chain reaches no item, one begun as a test, one of a function, or one of a workflow that contributes nothing', async () => {
    const alone = finished({ id: 'alone', type: 'run_failed', data: {}, context: { by: 'ops-key' } });
    const tried = finished({ id: 'tried', type: 'run_failed', data: {}, context: { by: 'local', test: true } });
    const ofAFunction = failedAfter('function', 'run_failed', {}, { ...inItsChain, definitionType: 'reasoning' });
    const elsewhere = failedAfter('elsewhere', 'run_failed', {}, { ...inItsChain, definitionName: 'tidy' });
    const { book, assessor } = await measuredThen(alone, tried);

    const delivered = await Promise.all(
      [alone, tried, ofAFunction, elsewhere].map((record) => deliveredAll(assessor, record)),
    );

    expect(delivered.map(({ keys, failed }) => [keys.length, failed.length])).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    expect((await book.rows(assessmentsName))[experimentId('MAR-41')]).toMatchObject({ stopped_at: null });
  });

  it('is one whose chain reaches only an item already judged', async () => {
    const passing = finished({ id: 'passing', data: results(1), context: onSchedule });
    const failed = failedAfter('failed', 'run_rejected', { rejection: { reason: 'conflict', detail: 'Refused.' } });
    const { book, assessor } = await measuredThen();
    await deliveredAll(assessor, passing);

    const delivered = await deliveredAll(assessor, failed);

    expect(delivered.keys).toEqual([]);
    expect((await book.rows(assessmentsName))[experimentId('MAR-41')]).toMatchObject({ verdict: 'passed' });
  });
});

const requests = {
  id: 'change-requests',
  statement: 'Every change request becomes a revision ready for review.',
  per: 'change request',
  window: { after: 'found', for: 'P1D' },
  success: { label: 'Ready', settles: 'on_crossing', target: { at_least: 1 }, passed: 'Ready', failed: 'Not ready' },
  milestones: [
    { id: 'found', label: 'Request found', by: 'auto' },
    { id: 'revised', label: 'Revision made', by: 'auto' },
  ],
  notify: { passed: 'quiet', failed: 'quiet' },
};

const requestId = (id: string) => assessmentIdOf({ definition: goalIdentityOf(requests.id), per: id });

describe('a failed run that follows the run that found an item', () => {
  it('stops every open item that run marked, since the chain names the run and not the item', async () => {
    const found = finished({
      id: 'found',
      workflow: 'find',
      data: { output: { requests: [{ id: 'letterhead' }, { id: 'banner' }] } },
    });
    const failed = calledBy(
      finished({ id: 'revise', type: 'run_failed', workflow: 'prepare', data: {}, context: inItsChain }),
      'run-found',
    );
    const { book, ports } = await built(startedAs(found));
    await book.goalsSaved([experiments, controls, requests]);
    await book.workflowSaved('find', 1, [
      { goal: requests.id, purpose: 'Finds the requests.', each: '/requests', per_id: '/id', marks: 'found' },
    ]);
    await book.workflowSaved('prepare', 1, [
      { goal: requests.id, purpose: 'Prepares the revision.', per_id: '/id', measures: '/ready', final: true },
    ]);
    const assessor = assessorOf(ports);
    await deliveredAll(assessor, found);

    const delivered = await deliveredAll(assessor, failed);
    const rows = await book.rows(assessmentsName);

    expect(delivered.keys).toEqual([`s:${requestId('banner')}`, `s:${requestId('letterhead')}`].toSorted());
    expect([rows[requestId('letterhead')]?.['stopped_run'], rows[requestId('banner')]?.['stopped_run']]).toEqual([
      'run-revise',
      'run-revise',
    ]);
  });
});
