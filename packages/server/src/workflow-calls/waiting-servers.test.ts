import { statement } from '@on.auto/ledger';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { readOfTheLedgerIn } from '../testing/records/ledger-file.ts';
import { ledgerLeftByAKill } from '../testing/records/ledger-left-by-a-kill.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { workflows } from '../testing/servers/workflow-calls.ts';
import { runIdIn, settledAsSwept, workflowSource } from '../testing/servers/workflow-server.ts';
import { fewSweeps, steppedServerClock, type SteppedServerClock } from '../testing/waiting/stepped-server-clock.ts';

/*
 * Servers in the process, each over the ledger file of its test: what one leaves on the file is what the next reads,
 * as a server started again or one beside it would. A kill is the ledger a server running in the process leaves at that
 * moment (`ledgerLeftByAKill`), with nothing of its shutdown.
 */
const beta = '/v1/orgs/acme/playbooks/beta';

const Listed = Schema.Struct({ runs: Schema.Array(Schema.Struct({ run_id: Schema.String })) });

const decodeListed = Schema.decodeUnknownSync(Listed);

function ledgerOfTheTest(): TemporaryLedger {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return ledger;
}

interface Serving {
  readonly server: ReasoningServer;
  readonly clock: SteppedServerClock;
}

/** A server over the ledger, on a stepped clock that starts where the given one stands: time goes on over a restart. */
async function servedOver(ledger: TemporaryLedger, after?: SteppedServerClock): Promise<Serving> {
  const clock = after === undefined ? steppedServerClock() : steppedServerClock(after.now());
  const server = await servingReasoning([], {}, undefined, { ledger, clock });
  onTestFinished(server.stop);
  return { server, clock };
}

function sourceOf(name: string): string {
  return workflowSource(name, workflows[name] ?? '');
}

async function definedOn({ server }: Serving): Promise<void> {
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'beta', name: 'Beta' } });
  await server.call('POST', `${beta}/definitions/workflow`, { body: { name: 'pending', source: sourceOf('pending') } });
  await server.call('POST', `${beta}/definitions/workflow`, { body: { name: 'waiting', source: sourceOf('waiting') } });
}

function callStatesIn({ fileName }: TemporaryLedger): () => Promise<readonly unknown[]> {
  return () => readOfTheLedgerIn(fileName, statement`SELECT state FROM workflow_calls`);
}

function waitingOnce(states: readonly unknown[]): boolean {
  return JSON.stringify(states) === JSON.stringify([{ state: 'waiting' }]);
}

async function waitingOn(
  serving: Serving,
  ledger: TemporaryLedger,
): Promise<{ readonly parent: string; readonly child: string }> {
  await definedOn(serving);
  const started = await serving.server.call('POST', `${beta}/definitions/workflow/waiting/run`, {
    body: { input: {} },
  });
  await serving.clock.swept.until(callStatesIn(ledger), waitingOnce, fewSweeps);
  const listed = await serving.server.call('GET', `${beta}/runs?name=pending`);
  return { parent: runIdIn(started.body), child: String(decodeListed(listed.body).runs[0]?.run_id) };
}

/** The ledger the server leaves when it is killed, the server then gone. */
async function killed({ server }: Serving, ledger: TemporaryLedger): Promise<TemporaryLedger> {
  const left = ledgerLeftByAKill(ledger);
  await server.stop();
  return left;
}

function accepted(answer: { readonly status: number }): boolean {
  return answer.status === 200;
}

describe('a server that is killed while a run waits for the workflow it called, and started again', () => {
  it('keeps the call waiting, and the ending of the workflow it called answers it', async () => {
    const ledger = ledgerOfTheTest();
    const first = await servedOver(ledger);
    const { parent, child } = await waitingOn(first, ledger);
    const left = await killed(first, ledger);

    const second = await servedOver(left, first.clock);
    const afterRestart = await callStatesIn(left)();
    await second.clock.swept.until(
      () =>
        second.server.call('POST', `${beta}/runs/${child}/events`, {
          body: { event: { type: 'com.acme.go', data: 1 } },
        }),
      accepted,
      fewSweeps,
    );
    const settled = await settledAsSwept(second.server, second.clock, `${beta}/runs/${parent}`);

    expect(afterRestart).toEqual([{ state: 'waiting' }]);
    expect(settled.body).toMatchObject({ status: 'succeeded', output: [1] });
  });
});

describe('a cancel that lands on a server that does not hold the lease', () => {
  it('is accepted, and the server that holds it ends the run and answers the run that waited for it, which fails by the status of the error', async () => {
    const ledger = ledgerOfTheTest();
    const holder = await servedOver(ledger);
    const { parent, child } = await waitingOn(holder, ledger);
    const standby = await servedOver(ledger, holder.clock);

    const cancelled = await standby.server.call('POST', `${beta}/runs/${child}/cancel`, {
      body: { reason: 'Cancelled elsewhere' },
    });
    const settled = await settledAsSwept(holder.server, holder.clock, `${beta}/runs/${parent}`);
    const ofTheChild = await settledAsSwept(holder.server, holder.clock, `${beta}/runs/${child}`);

    expect(cancelled.status).toBe(200);
    expect(ofTheChild.body).toMatchObject({
      rejection: { reason: 'cancelled', kind: 'requested', detail: 'Cancelled elsewhere' },
    });
    expect(settled.body).toMatchObject({ status: 'rejected', rejection: { reason: 'invalid_input' } });
    expect(JSON.stringify(settled.body)).toContain('Cancelled elsewhere');
  });

  it('is kept while no server holds the lease, and takes effect once one does', async () => {
    const ledger = ledgerOfTheTest();
    const first = await servedOver(ledger);
    const { parent } = await waitingOn(first, ledger);
    const left = await killed(first, ledger);

    const second = await servedOver(left, first.clock);
    const cancelled = await second.server.call('POST', `${beta}/runs/${parent}/cancel`, { body: {} });
    const settled = await settledAsSwept(second.server, second.clock, `${beta}/runs/${parent}`);

    expect(cancelled.status).toBe(200);
    expect(settled.body).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'cancelled', kind: 'requested' },
    });
  });
});
