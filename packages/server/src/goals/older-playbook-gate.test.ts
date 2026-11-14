import { movedClock } from '@on.auto/workflow-host/testing';
import { Schema } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';

import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { workflowSource } from '../testing/servers/workflow-server.ts';
import { goalsText, plainGoalId, servingReasoningWithGoals } from '../testing/settings/goals-kept.ts';
import { until } from '../testing/waiting/until.ts';

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

const askedForGoals =
  'Ask the person: What should this playbook achieve for you, and how will you know it worked? Ask too what to tell them, and where. Once they say yes, send it as the goals argument of update_playbook, as the goals guide says, then save the workflow again.';

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

async function runsOf(server: ReasoningServer, name: string): Promise<number> {
  return runsIn((await server.call('GET', `${alpha}/runs?type=workflow&name=${name}`)).body).runs.length;
}

function runsReaching(server: ReasoningServer, count: number): Promise<readonly number[]> {
  return until(
    () => Promise.all(['tally', 'tidy'].map((name) => runsOf(server, name))),
    (counts: readonly number[]) => counts.every((runs) => runs >= count),
  );
}

async function anOlderPlaybook(): Promise<void> {
  const before = await servingReasoning([], {}, undefined, { ledger });
  try {
    await before.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    const created = async (name: string) =>
      (await before.call('POST', `${alpha}/definitions/workflow`, { body: { name, source: scheduled(name) } })).status;
    expect([await created('tally'), await created('tidy')]).toEqual([201, 201]);
  } finally {
    await before.stop();
  }
}

describe('an older playbook on a Node server that now keeps goals', () => {
  it('keeps running, is asked for its goals at the next workflow save, and takes the workflow with its contribution once they are sent', async () => {
    await anOlderPlaybook();
    const savedBy = Date.now();
    const clock = movedClock(savedBy);
    const server = await servingReasoningWithGoals([], {}, undefined, { ledger, clock });
    try {
      const read = await server.call('GET', alpha);
      clock.moveTo(savedBy + aMinuteAndASecond);
      const ranBefore = await runsReaching(server, 1);

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
      const ranAfter = await runsReaching(server, 2);

      expect(read).toMatchObject({ status: 200, body: { goals: { gaps: [{ kind: 'no_goal' }] } } });
      expect(ranBefore).toEqual([1, 1]);
      expect(refused).toMatchObject({
        status: 422,
        body: { detail: askedForGoals, errors: [{ pointer: '', detail: askedForGoals }] },
      });
      expect(functionSaved.status).toBe(201);
      expect(goalsSent).toMatchObject({ status: 200, body: { goals: { source: goalsText, version: 1 } } });
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
