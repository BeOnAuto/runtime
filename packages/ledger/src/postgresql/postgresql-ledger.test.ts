import { Ledger } from '@on.auto/operations';
import { Cause, Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { unreachableDatabase } from '../testing/index.ts';
import { plainPoolsOn, postgresqlEventStore, postgresqlLedgerLayer } from './postgresql-ledger.ts';

describe('a ledger on PostgreSQL that cannot be reached', () => {
  it('fails to build, with a defect naming the address it tried and no credential', async () => {
    const { url, port, password } = await unreachableDatabase();

    const cause = await Effect.runPromise(
      Effect.provide(Ledger, postgresqlLedgerLayer({ pools: plainPoolsOn(url) })).pipe(Effect.sandbox, Effect.flip),
    );

    expect({ dies: Cause.hasDies(cause), fails: Cause.hasFails(cause) }).toEqual({ dies: true, fails: false });
    expect(Cause.pretty(cause)).toContain(`ECONNREFUSED 127.0.0.1:${port}`);
    expect(Cause.pretty(cause)).not.toContain(password);
  });

  it('fails a read of what a playbook recorded with the error of the driver', async () => {
    const { url, port } = await unreachableDatabase();
    const lost: Readonly<Error>[] = [];
    const store = postgresqlEventStore({
      pools: plainPoolsOn(url),
      reportLostConnection: (error) => {
        lost.push(error);
      },
    });
    onTestFinished(() => store.close());

    await expect(
      store.readRecorded('playbook/acme/alpha/', { kind: 'everything' }, { order: 'asc', limit: 1 }),
    ).rejects.toThrow(`ECONNREFUSED 127.0.0.1:${port}`);
    expect(lost).toEqual([]);
  });
});
