import { statement } from '@on.auto/ledger';
import { expect, it } from 'vitest';

import { openInstallation, openLicenseState } from '../index.ts';
import type { MeterDatabase } from './database.ts';
import { licenseStateFixture } from './license-state-fixture.ts';

const now = { now: 5000, onlineRequired: false };

function retainedLicenseBehaviour(open: () => Promise<MeterDatabase>): void {
  it('retains its signed license and accepted generation across restart, returning the revision needed by admission', async () => {
    const f = await licenseStateFixture(open);
    expect(await f.state.head()).toEqual({
      revision: 0,
      generation: 0,
      state: 'unlicensed',
      accountId: null,
      installationId: null,
      serial: null,
    });
    await expect(f.state.current(now)).rejects.toThrow('license_not_active');
    const receipt = await f.state.record(f.request);
    expect(receipt).toMatchObject({ status: 'accepted', generation: 1, revision: 1 });
    await f.database.close();
    const reopened = await f.database.reopen();
    const state = await openLicenseState({
      ...f.options,
      connection: reopened.connection,
      installation: await openInstallation(reopened),
    });
    expect(await state.current(now)).toMatchObject({
      revision: 1,
      license: { generation: 1, accountId: 'account-1', installationId: 'installation-1' },
    });
    expect(await state.record(f.request)).toMatchObject({ status: 'existing', generation: 1, revision: 1 });
  });

  it('accepts one original signed response across twenty replica retries', async () => {
    const f = await licenseStateFixture(open);
    const replica = await f.database.reopen();
    const second = await openLicenseState({ ...f.options, connection: replica.connection });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => [f.state.record(f.request), second.record(f.request)]).flat(),
    );
    expect(results.filter((result) => result.status === 'accepted')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'existing')).toHaveLength(19);
    expect(await f.database.connection.read(statement`SELECT serial FROM meter_license_history`)).toHaveLength(1);
    expect(await second.head()).toMatchObject({ revision: 1, generation: 1, state: 'active' });
  });
}

function newerLicenseBehaviour(open: () => Promise<MeterDatabase>): void {
  it('classifies a distinct older response as a revision conflict after a newer generation wins', async () => {
    const f = await licenseStateFixture(open);
    const delayed = await f.next(0, 0);
    await f.state.record(f.request);
    await f.state.record(await f.next());
    expect(await f.state.record(delayed)).toEqual({ status: 'conflict' });
    expect((await f.state.current(now)).license.generation).toBe(2);
    expect(await f.database.connection.read(statement`SELECT serial FROM meter_license_history`)).toHaveLength(2);
  });

  it('keeps a newer generation when old responses are replayed and refuses a second token for the same exchange', async () => {
    const f = await licenseStateFixture(open);
    await f.state.record(f.request);
    const next = await f.next();
    expect(await f.state.record(next)).toMatchObject({ status: 'accepted', generation: 2, revision: 2 });
    expect(await f.state.record(f.request)).toMatchObject({ status: 'existing', generation: 1, revision: 1 });
    expect((await f.state.current(now)).license.generation).toBe(2);
    await expect(
      f.state.record({ ...f.request, entitlementToken: `${f.request.entitlementToken}changed` }),
    ).rejects.toThrow('license_response_conflict');
    const older = await f.next(2, 0);
    await expect(f.state.record(older)).rejects.toThrow('stale');
    expect((await f.state.current(now)).license.generation).toBe(2);
  });

  it('fences late responses and stale refusals while allowing a newly started authorized exchange to restore service', async () => {
    const f = await licenseStateFixture(open);
    await f.state.record(f.request);
    const late = await f.next();
    expect(await f.state.refuse(1)).toBe(true);
    expect(await f.state.refuse(1)).toBe(false);
    await expect(f.state.current(now)).rejects.toThrow('license_not_active');
    expect((await f.state.record(f.request)).status).toBe('existing');
    expect(await f.state.record(late)).toEqual({ status: 'conflict' });
    expect((await f.state.head()).state).toBe('refused');
    const fresh = await f.next(2, 2);
    expect(await f.state.record(fresh)).toMatchObject({ status: 'accepted', generation: 3, revision: 3 });
    expect(await f.state.refuse(1)).toBe(false);
    expect((await f.state.current(now)).license.generation).toBe(3);
  });
}

function recoveredLicenseBehaviour(open: () => Promise<MeterDatabase>): void {
  it('recovers a committed license after a lost acknowledgement', async () => {
    const f = await licenseStateFixture(open);
    const state = await openLicenseState({
      ...f.options,
      connection: {
        ...f.options.connection,
        transaction: async (sql) => {
          await f.options.connection.transaction(sql);
          throw new Error('acknowledgement_lost');
        },
      },
    });
    expect(await state.record(f.request)).toMatchObject({ status: 'existing', generation: 1, revision: 1 });
    expect((await f.state.current(now)).license.generation).toBe(1);
  });

  it('rolls back the head and immutable history together after a late transaction failure', async () => {
    const f = await licenseStateFixture(open);
    const state = await openLicenseState({
      ...f.options,
      connection: {
        ...f.options.connection,
        transaction: (sql) =>
          f.options.connection.transaction([
            ...sql,
            statement`INSERT INTO missing_license_table (id) VALUES (1) RETURNING id`,
          ]),
      },
    });
    await expect(state.record(f.request)).rejects.toThrow('missing_license_table');
    expect(await f.database.connection.read(statement`SELECT serial FROM meter_license_history`)).toEqual([]);
    expect(await f.state.head()).toMatchObject({ revision: 0, state: 'unlicensed' });
    expect((await f.state.record(f.request)).status).toBe('accepted');
  });
}

function guardedLicenseBehaviour(open: () => Promise<MeterDatabase>): void {
  it('refuses another account or installation even when the issuing authority signed its license', async () => {
    const f = await licenseStateFixture(open);
    await f.state.record(f.request);
    const next = await f.next();
    const challenge = { ...next.challenge, accountId: 'another-account' };
    await expect(f.state.record({ ...next, challenge, ...(await f.bundle(challenge)) })).rejects.toThrow(
      'another account',
    );
    expect((await f.state.current(now)).license.accountId).toBe('account-1');
  });

  it('refuses edits or deletions of accepted evidence and keeps an expired license as history without authorizing work', async () => {
    const f = await licenseStateFixture(open);
    await f.state.record(f.request);
    await expect(
      f.database.connection.write(statement`UPDATE meter_license_history SET token = 'changed'`),
    ).rejects.toThrow('License history is immutable');
    await expect(f.database.connection.write(statement`DELETE FROM meter_license_history`)).rejects.toThrow(
      'License history is immutable',
    );
    await expect(f.state.current({ now: 1_000_000_000, onlineRequired: false })).rejects.toThrow('exp');
    await expect(f.state.current({ now: 5000, onlineRequired: true })).rejects.toThrow('license_clock_untrusted');
    expect((await f.state.record({ ...f.request, now: 1_000_000_000 })).status).toBe('existing');
    expect((await f.state.head()).generation).toBe(1);
  });
}

export function licenseStateBehaviour(open: () => Promise<MeterDatabase>): void {
  retainedLicenseBehaviour(open);
  newerLicenseBehaviour(open);
  recoveredLicenseBehaviour(open);
  guardedLicenseBehaviour(open);
}
