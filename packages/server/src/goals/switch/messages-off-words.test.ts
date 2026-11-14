import { openApiPath } from '@on.auto/api';
import { goalsWantedWordsOf } from '@on.auto/playbooks';
import { afterAll, describe, expect, it } from 'vitest';

import { temporaryLedger } from '../../testing/records/temporary-ledger.ts';
import { alpha, servingReasoning } from '../../testing/servers/reasoning-server.ts';
import { workflowSource } from '../../testing/servers/workflow-server.ts';
import { servingReasoningWithGoals } from '../../testing/settings/goals-kept.ts';

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

const askedAboutTelling = /what to tell them|want to be told|when and where to tell|what they are told/u;

const askedForGoalsAtSave =
  'Ask the person: What should this playbook achieve for you, and how will you know it worked? Once they say yes, send it as the goals argument of update_playbook, as the goals guide says, then save the workflow again.';

const scheduled = (contributes: readonly string[] = []) =>
  workflowSource('tally', [...contributes, 'do:', '  - count: { set: { orders: 3 } }', ''].join('\n'));

describe('a Node server that judges goals with messages off, as its agent reads it', () => {
  it('asks only for the goal and how the person will know it worked, refusing a playbook without goals and a workflow saved in one, and its API document says nothing of telling', async () => {
    const before = await servingReasoning([], {}, undefined, { ledger });
    await before.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await before.stop();
    const server = await servingReasoningWithGoals([], {}, undefined, { ledger, goalsMessages: false });
    try {
      const created = await server.call('POST', '/v1/orgs/acme/playbooks', {
        body: { playbook: 'beta', name: 'Beta' },
      });
      const saved = await server.call('POST', `${alpha}/definitions/workflow`, {
        body: { name: 'tally', source: scheduled(['contributes:', '  - goal: weekly', '    purpose: Counts.']) },
      });
      const document = JSON.stringify((await server.call('GET', openApiPath)).body);

      expect(created).toMatchObject({ status: 422, body: { detail: goalsWantedWordsOf(false) } });
      expect(saved).toMatchObject({ status: 422, body: { detail: askedForGoalsAtSave } });
      expect(askedAboutTelling.test(document)).toBe(false);
      expect(document).toContain('create_playbook');
    } finally {
      await server.stop();
    }
  });
});
