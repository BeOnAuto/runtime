import { statement } from '@on.auto/ledger';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { SpawnedServer } from '../testing/processes/spawned-server.ts';
import { requestTo, settledOver, workflowProcess, type Answer } from '../testing/processes/workflow-process.ts';
import { readOfTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { workflows } from '../testing/servers/workflow-calls.ts';
import { runIdIn, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const Listed = Schema.Struct({ runs: Schema.Array(Schema.Struct({ run_id: Schema.String })) });

const decodeListed = Schema.decodeUnknownSync(Listed);

function ledgerFile(): string {
  const ledger = temporaryLedger();
  onTestFinished(() => {
    ledger.remove();
  });
  return ledger.fileName;
}

function sourceOf(name: string): string {
  return workflowSource(name, workflows[name] ?? '');
}

async function definedOn(port: number): Promise<void> {
  await requestTo(port, 'POST', '', { playbook: 'beta', name: 'Beta' });
  await requestTo(port, 'POST', '/beta/definitions/workflow', { name: 'pending', source: sourceOf('pending') });
  await requestTo(port, 'POST', '/beta/definitions/workflow', { name: 'waiting', source: sourceOf('waiting') });
}

function callStatesIn(file: string): () => Promise<readonly unknown[]> {
  return () => readOfTheLedgerIn(file, statement`SELECT state FROM workflow_calls`);
}

function waitingOnce(states: readonly unknown[]): boolean {
  return JSON.stringify(states) === JSON.stringify([{ state: 'waiting' }]);
}

async function waitingOn(port: number, file: string): Promise<{ readonly parent: string; readonly child: string }> {
  await definedOn(port);
  const started = await requestTo(port, 'POST', '/beta/definitions/workflow/waiting/run', { input: {} });
  await until(callStatesIn(file), waitingOnce);
  const listed = await requestTo(port, 'GET', '/beta/runs?name=pending');
  return { parent: runIdIn(started.body), child: String(decodeListed(listed.body).runs[0]?.run_id) };
}

function accepted(answer: Answer): boolean {
  return answer.status === 200;
}

function stopped(server: SpawnedServer, signal: NodeJS.Signals): Promise<unknown> {
  server.signal(signal);
  return server.exited;
}

describe('a server that restarts while a run waits for the workflow it called', () => {
  it('keeps the call waiting, and the ending of the workflow it called answers it', async () => {
    const file = ledgerFile();
    const first = workflowProcess(file);
    const { parent, child } = await waitingOn(await first.port, file);
    await stopped(first, 'SIGKILL');

    const second = workflowProcess(file);
    const port = await second.port;
    const afterRestart = await callStatesIn(file)();
    await until(
      () => requestTo(port, 'POST', `/beta/runs/${child}/events`, { event: { type: 'com.acme.go', data: 1 } }),
      accepted,
    );
    const settled = await settledOver(port, `/beta/runs/${parent}`);

    expect(afterRestart).toEqual([{ state: 'waiting' }]);
    expect(settled).toMatchObject({ status: 'succeeded', output: [1] });
    expect(await stopped(second, 'SIGTERM')).toBe(0);
  });
});

describe('a cancel that lands on a server that does not hold the lease', () => {
  it('is accepted, and the server that holds it ends the run and answers the run that waited for it, which fails by the status of the error', async () => {
    const file = ledgerFile();
    const holder = workflowProcess(file);
    const { parent, child } = await waitingOn(await holder.port, file);
    const standby = workflowProcess(file);

    const cancelled = await requestTo(await standby.port, 'POST', `/beta/runs/${child}/cancel`, {
      reason: 'Cancelled elsewhere',
    });
    const settled = await settledOver(await holder.port, `/beta/runs/${parent}`);
    const ofTheChild = await settledOver(await holder.port, `/beta/runs/${child}`);

    expect(cancelled.status).toBe(200);
    expect(ofTheChild).toMatchObject({
      rejection: { reason: 'cancelled', kind: 'requested', detail: 'Cancelled elsewhere' },
    });
    expect(settled).toMatchObject({ status: 'rejected', rejection: { reason: 'invalid_input' } });
    expect(JSON.stringify(settled)).toContain('Cancelled elsewhere');
    expect([await stopped(standby, 'SIGTERM'), await stopped(holder, 'SIGTERM')]).toEqual([0, 0]);
  });

  it('is kept while no server holds the lease, and takes effect once one does', async () => {
    const file = ledgerFile();
    const first = workflowProcess(file);
    const { parent } = await waitingOn(await first.port, file);
    await stopped(first, 'SIGKILL');

    const second = workflowProcess(file);
    const port = await second.port;
    const cancelled = await requestTo(port, 'POST', `/beta/runs/${parent}/cancel`, {});
    const settled = await settledOver(port, `/beta/runs/${parent}`);

    expect(cancelled.status).toBe(200);
    expect(settled).toMatchObject({ status: 'rejected', rejection: { reason: 'cancelled', kind: 'requested' } });
    expect(await stopped(second, 'SIGTERM')).toBe(0);
  });
});
