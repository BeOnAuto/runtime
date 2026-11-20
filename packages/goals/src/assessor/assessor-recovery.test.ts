import {
  jsonPayloadText,
  mostInlinePayloadBytes,
  payloadChosen,
  payloadKept,
  payloadMembers,
} from '@on.auto/operations/payloads';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import { mostOutputBytes } from '../run-outputs/run-outputs.ts';
import { built, experimentId, results } from './assessor-fixtures.ts';
import { deliveredAll, finished, sales } from './assessor-ledger.ts';
import { assessorOf } from './assessor.ts';

const measured = { results: [{ issue: 'MAR-41', customers: 1, notes: 'n'.repeat(mostInlinePayloadBytes) }] };

async function keptOutput(content: Parameters<typeof payloadKept>[0]) {
  const chosen = payloadChosen(measured, jsonPayloadText(measured), true, mostInlinePayloadBytes);
  if (chosen.toKeep !== undefined) {
    await Effect.runPromise(payloadKept(content, sales, chosen.toKeep));
  }
  return payloadMembers('output', chosen.payload);
}

describe('an output kept outside the run fact', () => {
  it('is observed once it can be read, its delivery failing while the store cannot be reached', async () => {
    const { book, ports } = await built();
    const data = await keptOutput(book.ledger.content);
    const away = {
      ...book.ledger,
      content: { ...book.ledger.content, get: () => Effect.die(new Error('connect ECONNREFUSED')) },
    };
    const record = finished({ id: 'kept', data });

    const unreached = await deliveredAll(assessorOf({ ...ports, ledger: away }), record);
    const reached = await deliveredAll(assessorOf(ports), record);

    expect('output_sha256' in data).toBe(true);
    expect(unreached).toMatchObject({ keys: [], failed: ['!'] });
    expect(reached).toMatchObject({ keys: [`a:${experimentId('MAR-41')}`], failed: [] });
    expect(await book.rows(assessmentsName)).toMatchObject({ [experimentId('MAR-41')]: { verdict: 'passed' } });
  });

  it('is a refused observation, never a failure, when it is larger than an output may be', async () => {
    const { book, ports } = await built();
    const data = { output_sha256: 'a'.repeat(64), output_bytes: mostOutputBytes + 1 };

    const delivered = await deliveredAll(assessorOf(ports), finished({ id: 'large', data }));

    expect(delivered).toMatchObject({ keys: ['r:goal-of-paying-customers/measure'], failed: [] });
    expect(await book.factsOf('paying-customers', 'goal-refusals/measure')).toEqual(['goal_observation_refused']);
  });
});

describe('a host that stops between the deliveries of one run', () => {
  it('delivers the rest from where it was, and changes nothing with the deliveries it makes again', async () => {
    const { book, ports } = await built();
    const record = finished({ id: 'r1', data: results(1, 1, 1) });
    const before = assessorOf(ports);
    const first = await Effect.runPromise(before.batchOf(record, undefined, 1));
    await Effect.runPromise(Effect.forEach(first.deliveries, ({ deliver }) => deliver));

    const after = assessorOf(ports);
    const rest = await Effect.runPromise(after.batchOf(record, first.through, 100));
    await Effect.runPromise(Effect.forEach(rest.deliveries, ({ deliver }) => deliver));
    const again = await deliveredAll(after, record);
    const streams = ['MAR-41', 'MAR-42', 'MAR-43'].map((issue) => `assessments/${experimentId(issue)}`);

    expect([first.deliveries.length, first.more, rest.deliveries.length, rest.more]).toEqual([1, true, 2, false]);
    expect(again.keys).toHaveLength(3);
    expect(await Promise.all(streams.map((stream) => book.factsOf('paying-customers', stream)))).toEqual(
      streams.map(() => ['goal_assessment_opened', 'goal_observed', 'goal_assessed']),
    );
  });
});

describe('a run of an older version of a workflow', () => {
  it('observes what that version contributes, whatever a later version changed', async () => {
    const { book, ports } = await built();
    await book.workflowSaved('measure', 2, []);
    const assessor = assessorOf(ports);

    const older = await deliveredAll(assessor, finished({ id: 'v1', version: 1, data: results(1) }));
    const later = await deliveredAll(assessor, finished({ id: 'v2', run: 'two', version: 2, data: results(0, 1) }));

    expect([older.keys, later.keys]).toEqual([[`a:${experimentId('MAR-41')}`], []]);
    expect(Object.keys(await book.rows(assessmentsName))).toEqual([experimentId('MAR-41')]);
  });
});
