import { firstTryAgainMs, mostInlinePayloadBytes } from '@on.auto/operations/payloads';
import { answers, textResult } from '@on.auto/reasoning/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { aLedger, minute, movedOn, nineOClock } from '../testing/accounts/refused-workflows.ts';
import { waitingAgain } from '../testing/accounts/waiting-workflows.ts';
import { contentReads } from '../testing/servers/content-reads.ts';
import { alpha, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { runIdIn, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  '---',
  `Sum up the day. ${'Keep each line short and plain. '.repeat(Math.ceil(mostInlinePayloadBytes / 32))}`,
].join('\n');

const asking = workflowSource(
  'asking',
  'do:\n  - ask: { call: run_definition, with: { type: reasoning, name: summary, input: {} } }\n',
);

type TemporaryLedger = ReturnType<typeof aLedger>;

const switchedOn = { keptOutside: true } as const;

type Switched = { readonly keptOutside?: true };

async function savedByAnotherServer(ledger: TemporaryLedger, switched: Switched = switchedOn): Promise<void> {
  const keeping = await servingReasoning([], {}, undefined, { ledger, ...switched });
  await keeping.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await keeping.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'summary', source: summary, diagram: 'none' },
  });
  await keeping.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'asking', source: asking } });
  await keeping.stop();
}

function replying(replies: number) {
  return Array.from({ length: replies }, () => answers(textResult('A short day.')));
}

async function keepingTheSummary(replies: number, switched: Switched = switchedOn, saved: Switched = switchedOn) {
  const ledger = aLedger();
  await savedByAnotherServer(ledger, saved);
  const content = contentReads();
  const clock = nineOClock();
  const server = await servingReasoning(replying(replies), {}, undefined, {
    clock,
    ledger,
    ledgerOver: content.over,
    ...switched,
  });
  onTestFinished(() => server.stop());
  return { server, clock, content };
}

async function twoRunsOfTheSummary(server: Awaited<ReturnType<typeof keepingTheSummary>>['server']) {
  const runs = [
    await server.call('POST', `${alpha}/definitions/reasoning/summary/run`, { body: { input: {} } }),
    await server.call('POST', `${alpha}/definitions/reasoning/summary/run`, { body: { input: {} } }),
  ];
  return runs.map(({ body }) => body);
}

describe('a workflow whose step calls a function whose document its playbook keeps outside its facts', () => {
  it('waits at the step while that document cannot be read, and runs it once it can and the gate of the process has let a try through', async () => {
    const { server, clock, content } = await keepingTheSummary(1);
    content.fail(true);
    const started = await server.call('POST', `${alpha}/definitions/workflow/asking/run`, { body: { input: {} } });
    const workflow = runIdIn(started.body);
    const [waiting] = await waitingAgain(server, workflow, 1);
    content.fail(false);
    await new Promise((resolve) => {
      setTimeout(resolve, firstTryAgainMs);
    });
    movedOn(clock, minute);
    const settled = await settledRun(server, `${alpha}/runs/${workflow}`);

    expect(waiting?.summary).toContain('The step “ask” waits until what it calls can be read from storage.');
    expect(settled.body).toMatchObject({ status: 'succeeded' });
    expect(server.modelCalls()).toBe(1);
  }, 60_000);
});

describe('a function whose document its playbook keeps outside its facts, run again and again', () => {
  it('has its document read from the store once by a server that did not keep it, which keeps what it read', async () => {
    const { server, content } = await keepingTheSummary(2);

    expect(await twoRunsOfTheSummary(server)).toMatchObject([{ status: 'succeeded' }, { status: 'succeeded' }]);
    expect(content.reads()).toBe(1);
  }, 60_000);

  it('has its document read from the store by no run of the server that kept it, which keeps what it put', async () => {
    const content = contentReads();
    const server = await servingReasoning(replying(2), {}, undefined, {
      ledger: aLedger(),
      ledgerOver: content.over,
      keptOutside: true,
    });
    onTestFinished(() => server.stop());
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await server.call('POST', `${alpha}/definitions/reasoning`, {
      body: { name: 'summary', source: summary, diagram: 'none' },
    });

    expect(await twoRunsOfTheSummary(server)).toMatchObject([{ status: 'succeeded' }, { status: 'succeeded' }]);
    expect(content.reads()).toBe(0);
  }, 60_000);
});

describe('a server whose payloads are not kept outside, over a ledger where the document of a function was', () => {
  it('reads that document from the store once and then from what its process keeps, as with the switch on, since a text is the same for as long as its digest names it', async () => {
    const { server, content } = await keepingTheSummary(2, {});

    expect(await twoRunsOfTheSummary(server)).toMatchObject([{ status: 'succeeded' }, { status: 'succeeded' }]);
    expect(content.reads()).toBe(1);
  }, 60_000);
});

describe('a server whose payloads are not kept outside, over a ledger whose documents a server with it off saved', () => {
  it('reads nothing from the store as it runs a long document twice, the document kept in its fact', async () => {
    const { server, content } = await keepingTheSummary(2, {}, {});

    expect(await twoRunsOfTheSummary(server)).toMatchObject([{ status: 'succeeded' }, { status: 'succeeded' }]);
    expect(content.reads()).toBe(0);
  }, 60_000);
});
