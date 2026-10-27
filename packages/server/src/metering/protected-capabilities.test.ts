import { statement } from '@on.auto/ledger';
import { weeklyOrders } from '@on.auto/prediction/testing';
import { describe, expect, it } from 'vitest';

import { runId, withComputation } from '../metering-testing/fixture.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { workflowSource } from '../testing/servers/workflow-server.ts';

describe('protected work awaiting complete metering bounds', () => {
  it('records a refusal before a workflow can start any uncharged work', async () => {
    const server = await withComputation();
    await server.activate();
    const source = workflowSource('hello', "do:\n  - answer: { set: { message: 'hello' } }\n");
    expect(
      await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'hello', source } }),
    ).toMatchObject({ status: 201 });
    expect(
      await server.call('POST', `${alpha}/definitions/workflow/hello/run`, { body: { input: {}, run_id: runId } }),
    ).toMatchObject({
      status: 409,
      body: { detail: 'This run needs an approved bound covering all of its work before it can start.' },
    });
    expect(await server.call('GET', `${alpha}/runs/${runId}`)).toMatchObject({
      status: 200,
      body: { status: 'rejected' },
    });
    expect(await server.database.connection.read(statement`SELECT id FROM meter_offline_charges`)).toEqual([]);
  });

  it('keeps prediction definitions readable while refusing local training and candidate upload', async () => {
    const server = await withComputation();
    await server.activate();
    expect(
      await server.call('POST', `${alpha}/definitions/prediction`, { body: { name: 'orders', source: weeklyOrders } }),
    ).toMatchObject({ status: 201 });
    expect(
      await server.call('POST', `${alpha}/definitions/prediction/orders/run`, {
        body: { input: { build: {} }, run_id: runId },
      }),
    ).toMatchObject({
      status: 409,
      body: {
        detail: 'Model training and development run only in Auto Cloud. Request an authorized Cloud build from Studio.',
      },
    });
    expect(await server.call('GET', `${alpha}/definitions/prediction/orders`)).toMatchObject({ status: 200 });
    expect(await server.call('GET', `${alpha}/runs/${runId}/history`)).toMatchObject({
      status: 200,
      body: { events: [{ type: 'run_started' }, { type: 'run_rejected' }] },
    });
    expect(await server.call('POST', `${alpha}/runs/${runId}/build/candidates`)).toMatchObject({ status: 404 });
    expect(await server.database.connection.read(statement`SELECT id FROM meter_offline_charges`)).toEqual([]);
  });
});
