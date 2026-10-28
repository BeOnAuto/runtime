import { nestedRunId } from '@on.auto/definitions';
import { textResult } from '@on.auto/reasoning/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { accountsServed, installation, servedBy, type Accounts } from '../testing/accounts/licensed-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { runIdIn, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const summary = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Summarize acme.'].join('\n');

const askingThenTallying = workflowSource(
  'asking-then-tallying',
  `do:
  - ask: { call: run_definition, with: { type: reasoning, name: summary, input: {} } }
  - tally: { call: run_definition, with: { type: workflow, name: tally } }
`,
);

const nestingIt = workflowSource(
  'nesting-it',
  'do:\n  - nest: { call: run_definition, with: { type: workflow, name: asking-then-tallying } }\n',
);

function actionOf(runId: string): string {
  return `installation:${installation}/acme/alpha/${runId.toLowerCase()}`;
}

async function stoppedBetweenItsCalls(refuseTheNext: (accounts: Accounts) => void, top = 'asking-then-tallying') {
  const accounts = await accountsServed();
  const answered = Promise.withResolvers<void>();
  const server = await servedBy(accounts, { AUTO_RUNTIME_LICENSE_KEY: accounts.key }, {}, [
    () =>
      Effect.as(
        Effect.promise(() => answered.promise),
        textResult('Short.'),
      ),
  ]);
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
  await server.call('POST', `${alpha}/definitions/workflow`, {
    body: { name: 'asking-then-tallying', source: askingThenTallying },
  });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'nesting-it', source: nestingIt } });
  const started = await server.call('POST', `${alpha}/definitions/workflow/${top}/run`, { body: { input: {} } });
  const topRun = runIdIn(started.body);
  const workflow = top === 'nesting-it' ? nestedRunId(topRun, '/do/0/nest', 1) : topRun;
  await until(
    () => server.modelCalls(),
    (calls) => calls === 1,
  );
  refuseTheNext(accounts);
  answered.resolve();
  const settledTop = await settledRun(server, `${alpha}/runs/${topRun}`);
  const settled = await settledRun(server, `${alpha}/runs/${workflow}`);
  const asked = nestedRunId(workflow, '/do/0/ask', 1);
  const tally = nestedRunId(workflow, '/do/1/tally', 1);
  return {
    accounts,
    topRun,
    settledTop,
    workflow,
    asked,
    settled,
    askedRun: await server.call('GET', `${alpha}/runs/${asked}`),
    tallyRun: await server.call('GET', `${alpha}/runs/${tally}`),
    askedAgain: await server.call('POST', `${alpha}/definitions/workflow/asking-then-tallying/run`, {
      body: { input: {}, run_id: workflow },
    }),
  };
}

describe('a workflow of a licensed runtime whose org runs out of credits between two of its calls', () => {
  it('finishes the call it was admitted for, ends rejected at the next, and is never continued under its run id', async () => {
    const stopped = await stoppedBetweenItsCalls(({ account }) => {
      account.exhaust();
    });

    expect(stopped.askedRun).toMatchObject({ status: 200, body: { status: 'succeeded' } });
    expect(stopped.settled).toMatchObject({
      body: { status: 'rejected', rejection: { reason: 'conflict', kind: 'credits_exhausted' } },
    });
    expect(stopped.tallyRun.status).toBe(404);
    expect(stopped.askedAgain).toMatchObject({ status: 409, body: { kind: 'unworkable' } });
    expect(stopped.accounts.account.charged()).toEqual([actionOf(stopped.workflow), actionOf(stopped.asked)]);
  }, 60_000);
});

describe('a workflow of a licensed runtime that calls a workflow whose next call is refused for credits', () => {
  it('ends rejected too, as its own step’s error, with both runs and the call made before still counted', async () => {
    const stopped = await stoppedBetweenItsCalls(({ account }) => {
      account.exhaust();
    }, 'nesting-it');

    expect(stopped.settledTop).toMatchObject({
      body: { status: 'rejected', rejection: { reason: 'conflict', kind: 'credits_exhausted' } },
    });
    expect(stopped.settled).toMatchObject({ body: { status: 'rejected', rejection: { kind: 'credits_exhausted' } } });
    expect(stopped.accounts.account.charged()).toEqual(
      [stopped.topRun, stopped.workflow, stopped.asked].map((run) => actionOf(run)),
    );
  }, 60_000);
});

describe('a workflow of a licensed runtime whose account at Auto cannot be reached between two of its calls', () => {
  it('finishes the call it was admitted for and ends rejected as unavailable at the next, however long its license stands', async () => {
    const stopped = await stoppedBetweenItsCalls(({ account }) => {
      account.goDown();
    });

    expect(stopped.askedRun).toMatchObject({ status: 200, body: { status: 'succeeded' } });
    expect(stopped.settled).toMatchObject({
      body: { status: 'rejected', rejection: { reason: 'unavailable' } },
    });
    expect(JSON.stringify(stopped.settled.body)).toContain('could not ask its account at Auto to admit the run');
    expect(stopped.tallyRun.status).toBe(404);
    expect(stopped.askedAgain).toMatchObject({ status: 409, body: { kind: 'unworkable' } });
    expect(stopped.accounts.account.charged()).toEqual([actionOf(stopped.workflow), actionOf(stopped.asked)]);
  }, 60_000);
});
