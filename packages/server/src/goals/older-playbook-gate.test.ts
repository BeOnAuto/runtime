import { Schema } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';

import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { workflowSource } from '../testing/servers/workflow-server.ts';
import {
  goalsText,
  leadGoalId,
  plainGoalId,
  savedSourceOf,
  servingReasoningWithGoals,
  versionsOf,
} from '../testing/settings/goals-kept.ts';
import { fewSweeps, steppedServerClock, type SteppedServerClock } from '../testing/waiting/stepped-server-clock.ts';

const aMinuteAndASecond = 61_000;

const contribution = [
  'contributes:',
  `  - goal: ${plainGoalId}`,
  '    purpose: Counts the orders of the week.',
  '    measures: /orders',
];

const scheduled = (name: string, contributes: readonly string[] = []) =>
  workflowSource(
    name,
    [...contributes, 'schedule:', '  every: PT1M', 'do:', '  - count: { set: { orders: 3 } }', ''].join('\n'),
  );

const verdict = ['---', 'model: openai/gpt-5', '---', 'Should we approve {{ input.expense }}?'].join('\n');

const ListedRuns = Schema.Struct({ runs: Schema.Array(Schema.Struct({ run_id: Schema.String })) });

const runsIn = Schema.decodeUnknownSync(ListedRuns);

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

async function runsOf(server: ReasoningServer, name: string): Promise<number> {
  return runsIn((await server.call('GET', `${alpha}/runs?type=workflow&name=${name}`)).body).runs.length;
}

function runsReaching(server: ReasoningServer, clock: SteppedServerClock, count: number): Promise<readonly number[]> {
  return clock.swept.until(
    () => Promise.all(['tally', 'tidy'].map((name) => runsOf(server, name))),
    (counts: readonly number[]) => counts.every((runs) => runs >= count),
    fewSweeps,
  );
}

/** Saves the older playbook on a server that kept no goals, answering the time of its clock once it had. */
async function anOlderPlaybook(): Promise<number> {
  const before = await servingReasoning([], {}, undefined, { ledger });
  try {
    await before.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    const created = async (name: string) =>
      (await before.call('POST', `${alpha}/definitions/workflow`, { body: { name, source: scheduled(name) } })).status;
    expect([await created('tally'), await created('tidy')]).toEqual([201, 201]);
    return before.runsOn.now();
  } finally {
    await before.stop();
  }
}

describe('an older playbook on a Node server that now keeps goals', () => {
  it('keeps running, is asked for its goals at the next workflow save, and takes the workflow with its contribution once they are sent', async () => {
    const savedBy = await anOlderPlaybook();
    const clock = steppedServerClock(savedBy);
    const server = await servingReasoningWithGoals([], {}, undefined, { ledger, clock });
    try {
      const read = await server.call('GET', alpha);
      clock.moveTo(savedBy + aMinuteAndASecond);
      const ranBefore = await runsReaching(server, clock, 1);

      const refused = await server.call('PUT', `${alpha}/definitions/workflow/tally`, {
        body: { source: scheduled('tally', contribution) },
      });
      const functionSaved = await server.call('POST', `${alpha}/definitions/reasoning`, {
        body: { name: 'verdict', source: verdict, diagram: 'none' },
      });
      const goalsSent = await server.call('PUT', alpha, { body: { goals: goalsText } });
      const saved = await server.call('PUT', `${alpha}/definitions/workflow/tally`, {
        body: { source: scheduled('tally', contribution) },
      });
      clock.moveTo(savedBy + 2 * aMinuteAndASecond + aMinuteAndASecond);
      const ranAfter = await runsReaching(server, clock, 2);

      expect(read).toMatchObject({ status: 200, body: { goals: { gaps: [{ kind: 'no_goal' }] } } });
      expect(ranBefore).toEqual([1, 1]);
      expect(refused).toMatchObject({
        status: 422,
        body: { errors: [{ pointer: '' }] },
      });
      expect(functionSaved.status).toBe(201);
      expect(goalsSent).toMatchObject({
        status: 200,
        body: { goals: { source: savedSourceOf(goalsText), versions: versionsOf([leadGoalId, 1], [plainGoalId, 1]) } },
      });
      expect(saved).toMatchObject({
        status: 200,
        body: { version: 2, details: { contributes: [{ goal: plainGoalId, measures: '/orders' }] } },
      });
      expect(ranAfter.every((runs) => runs >= 2)).toBe(true);
    } finally {
      await server.stop();
    }
  });
});
