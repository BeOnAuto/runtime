import { textResult } from '@on.auto/reasoning/testing';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { now, runId, runKey, startOf } from '../testing/attempt-leases/left-by-dead-processes.ts';
import {
  aLedger,
  as,
  aSummaryDefinedOn,
  aSummaryOn,
  endedOn,
  quarter,
  reader,
  startedAfter,
  writer,
} from '../testing/attempt-leases/servers-after-dead-processes.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/waiting/until.ts';

const leftWhenItDied = {
  type: 'reasoning',
  name: 'summary',
  events: [startOf({ resumes: true })],
  leases: [[`attempt/${runKey}/process-that-died/1`, 'process-that-died', now - 1]],
} as const;

describe('a reasoning run a client started, whose process died', () => {
  it('is resumed at once its lease lapsed, under the key that started it as that key may act now', async () => {
    const { server } = await startedAfter(leftWhenItDied, [writer], [() => Effect.succeed(textResult('Went well.'))]);

    const ended = await endedOn(server, writer);
    const history = await server.call('GET', `${alpha}/runs/${runId}/history`, as(writer));

    expect(ended.body).toMatchObject({ status: 'succeeded', output: 'Went well.' });
    expect(server.modelCalls()).toBe(1);
    expect(history.body).toMatchObject({
      events: [{ type: 'run_started' }, { type: 'attempt_resumed' }, {}, {}, { type: 'run_succeeded' }],
    });
  });

  it('is ended, never resumed, where the key that started it was taken away, in the words the server refuses such a caller with', async () => {
    const { server } = await startedAfter(leftWhenItDied, [reader], [() => Effect.succeed(textResult('Never asked.'))]);

    const ended = await endedOn(server, reader);

    expect(ended.body).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'unavailable', detail: 'The caller lacks the playbook:write permission' },
    });
    expect(server.modelCalls()).toBe(0);
  });
});

describe('a reasoning run a signed-in person started, whose process died', () => {
  it('is ended with the words of an attempt that died, since this server keeps no grant of a person, and never resumed or refused', async () => {
    const ada = { id: 'person:ada', name: 'Ada Lovelace' };
    const left = { ...leftWhenItDied, events: [startOf({ resumes: true }, ada)] };
    const { server } = await startedAfter(left, [writer], [() => Effect.succeed(textResult('Never asked.'))]);

    const ended = await endedOn(server, writer);

    expect(ended.body).toMatchObject({ status: 'failed' });
    expect(ended.body).not.toHaveProperty('rejection');
    expect(server.modelCalls()).toBe(0);
  });
});

describe('a reasoning run a client started, whose server stops cleanly while the run waits on its model', () => {
  it('is resumed by the next server at once, its lease handed over as its attempt ended, with no lease left to lapse', async () => {
    const ledger = aLedger();
    const first = await aSummaryOn(ledger, [() => Effect.never]);
    await aSummaryDefinedOn(first.server);
    void first.server.call('POST', `${alpha}/definitions/reasoning/summary/run`, { body: quarter }).catch(() => 'gone');
    await until(first.server.modelCalls, (calls) => calls > 0);
    await first.server.stop();

    const second = await aSummaryOn(ledger, [() => Effect.succeed(textResult('Went well.'))]);
    onTestFinished(second.server.stop);

    expect((await endedOn(second.server)).body).toMatchObject({ status: 'succeeded', output: 'Went well.' });
  });
});

describe('a reasoning run a client started, whose server lives while its model takes ten times as long as a lease', () => {
  it('is never ended or resumed meanwhile, and records its own result', async () => {
    const answering = Promise.withResolvers<void>();
    const slow = () => Effect.promise(() => answering.promise).pipe(Effect.as(textResult('Slowly, well.')));
    const { server, clock } = await aSummaryOn(aLedger(), [slow]);
    onTestFinished(server.stop);
    await aSummaryDefinedOn(server);
    const asked = server.call('POST', `${alpha}/definitions/reasoning/summary/run`, { body: quarter });
    await until(server.modelCalls, (calls) => calls > 0);

    clock.moveTo(now + 300_000);
    const meanwhile = await server.call('GET', `${alpha}/runs/${runId}/history`);
    answering.resolve();

    expect((await asked).body).toMatchObject({ status: 'succeeded', output: 'Slowly, well.' });
    expect(meanwhile.body).toMatchObject({ events: [{ type: 'run_started' }, { type: 'model_call_started' }] });
    expect(server.modelCalls()).toBe(1);
  });
});
