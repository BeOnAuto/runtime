import { setImmediate } from 'node:timers/promises';

import { statement } from '@on.auto/ledger';
import { selfHostedFixture } from '@on.auto/meter/testing';
import { movedClock } from '@on.auto/workflow-host/testing';
import { Context } from 'effect';
import { describe, expect, it } from 'vitest';

import { delayedAuthority } from '../metering-testing/delayed-authority.ts';
import { licensePath, meteredServer, runId, withComputation } from '../metering-testing/fixture.ts';
import { until } from '../testing/waiting/until.ts';
import { runtimeMeter } from './runtime-meter.ts';

describe('metering owned by the server lifecycle', () => {
  it('reconciles and sends usage automatically from the existing background host', async () => {
    const clock = movedClock(0);
    const server = await withComputation({ clock });
    expect(await server.activate()).toMatchObject({ status: 200 });
    expect(await server.run()).toMatchObject({ status: 200 });
    server.pass(300_000);
    clock.moveTo(300_000);
    await until(() => {
      expect(server.received.at(-1)).toMatchObject({ charges: [{ runId }] });
    });
    await until(async () => {
      expect(await server.database.connection.read(statement`SELECT state FROM meter_reservation_state`)).toEqual([
        { state: 'settled' },
      ]);
    });
  });

  it('finishes an accepted activation before closing the secret store and database', async () => {
    const delayed = delayedAuthority();
    const server = await meteredServer({}, [], {}, delayed.fetchOver);
    const activation = server.call('POST', `${licensePath}/activate`, { body: { activationKey: 'activation-secret' } });
    await delayed.heard;
    let stopped = false;
    const stopping = server.stop().then(() => {
      stopped = true;
      return true;
    });
    await setImmediate();
    expect(stopped).toBe(false);
    delayed.release();
    expect(await activation).toMatchObject({ status: 200 });
    await stopping;
    expect(stopped).toBe(true);
    expect(await server.meter.license.head()).toMatchObject({ state: 'active' });
  });
});

describe('a refused meter during server startup', () => {
  it('closes the already opened secret store before propagating the failure', async () => {
    const f = await selfHostedFixture();
    let closed = false;
    const secrets = {
      ...f.database.secrets,
      close: async () => {
        await f.database.secrets.close();
        closed = true;
      },
    };
    const runtime = {
      context: Context.empty(),
      run: () => Promise.reject(new Error('not running')),
      dispose: () => Promise.resolve(),
    };
    await expect(
      runtimeMeter(
        runtime,
        { connection: f.options.connection, secrets },
        { ...f.options, operatorKeyIds: [], trust: { ...f.trust, issuer: 'http://invalid.test' } },
      ),
    ).rejects.toThrow('A license issuer must be an HTTPS address');
    expect(closed).toBe(true);
  });
});
