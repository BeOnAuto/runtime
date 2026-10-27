import type { ConnectionPorts } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { openLicenseState } from '../index.ts';
import { licenseStateFixture } from '../testing/license-state-fixture.ts';

function beforeHead(connection: ConnectionPorts, action: () => Promise<void>): ConnectionPorts {
  const state = { called: false };
  return {
    ...connection,
    read: async (sql) => {
      if (!state.called && sql.strings.join('').includes('FROM meter_license_head')) {
        state.called = true;
        await action();
      }
      return connection.read(sql);
    },
  };
}

describe('license responses racing newer local state', () => {
  it('recovers a duplicate accepted after lookup even when its snapshot sees a later generation', async () => {
    const f = await licenseStateFixture();
    const state = await openLicenseState({
      ...f.options,
      connection: beforeHead(f.options.connection, async () => {
        await f.state.record(f.request);
        await f.state.record(await f.next());
      }),
    });
    expect(await state.record(f.request)).toMatchObject({ status: 'existing', generation: 1, revision: 1 });
    expect((await f.state.current({ now: 5000, onlineRequired: false })).license.generation).toBe(2);
  });

  it('keeps a refusal installed after lookup when a delayed response tries to change the head', async () => {
    const f = await licenseStateFixture();
    await f.state.record(f.request);
    const request = await f.next();
    const state = await openLicenseState({
      ...f.options,
      connection: beforeHead(f.options.connection, async () => {
        await f.state.refuse(1);
      }),
    });
    expect(await state.record(request)).toEqual({ status: 'conflict' });
    await expect(f.state.current({ now: 5000, onlineRequired: false })).rejects.toThrow('license_not_active');
  });
});
