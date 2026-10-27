import { statement } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { openLicenseState } from '../index.ts';
import { licenseStateBehaviour } from '../testing/license-state-behaviour.ts';
import { licenseStateFixture } from '../testing/license-state-fixture.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';

describe('durable license state on SQLite', () => {
  licenseStateBehaviour(sqliteDatabase);
});

describe('local license record boundaries', () => {
  it('refuses changed proof content and capacity on retries', async () => {
    const f = await licenseStateFixture();
    await f.state.record(f.request);
    await expect(
      f.state.record({ ...f.request, challenge: { ...f.request.challenge, nonce: 'B'.repeat(42) + 'A' } }),
    ).rejects.toThrow('license_response_conflict');
    await expect(f.state.record({ ...f.request, allocationTokens: ['another-capacity'] })).rejects.toThrow(
      'license_response_conflict',
    );
  });

  it('refuses invalid revisions before reading or changing state', async () => {
    const f = await licenseStateFixture();
    await expect(f.state.record({ ...f.request, expectedRevision: 0.5 })).rejects.toThrow('license_revision_invalid');
    expect(() => f.state.refuse(-1)).toThrow('license_revision_invalid');
    expect(() => f.state.refuse(Number.NaN)).toThrow('license_revision_invalid');
    expect((await f.state.head()).revision).toBe(0);
  });

  it('refuses exhausted revisions and a different serial with a generation already accepted', async () => {
    const f = await licenseStateFixture();
    await f.state.record(f.request);
    expect(await f.state.record(await f.next(1, 0))).toEqual({ status: 'conflict' });
    await f.database.connection.write(statement`UPDATE meter_license_head SET revision = 9007199254740991`);
    expect(await f.state.record(await f.next(Number.MAX_SAFE_INTEGER))).toEqual({ status: 'conflict' });
    expect(await f.state.refuse(Number.MAX_SAFE_INTEGER)).toBe(false);
    expect((await f.state.current({ now: 5000, onlineRequired: false })).license.generation).toBe(1);
  });

  it('captures the request and public trust before awaiting the database', async () => {
    const f = await licenseStateFixture();
    const state = await openLicenseState(f.options);
    const result = state.record(f.request);
    Object.defineProperty(f.request, 'entitlementToken', { value: 'changed' });
    Object.defineProperty(f.request.challenge, 'nonce', { value: 'changed' });
    Object.defineProperty(f.trust, 'issuer', { value: 'https://another.test' });
    Object.defineProperty(f.trust.keys, 'length', { value: 0 });
    expect((await result).status).toBe('accepted');
    expect((await state.current({ now: 5000, onlineRequired: false })).license.generation).toBe(1);
  });
});

describe('damaged license projections and immutable evidence', () => {
  it('refuses SQLite replacement of accepted history', async () => {
    const f = await licenseStateFixture();
    await f.state.record(f.request);
    await expect(
      f.database.connection.write(statement`INSERT OR REPLACE INTO meter_license_history
      SELECT serial, generation, revision, 'changed', challenge_payload, allocation_json, accepted_at FROM meter_license_history`),
    ).rejects.toThrow('License history is immutable');
  });

  it('refuses a head whose signed history is missing', async () => {
    const f = await licenseStateFixture();
    await f.state.record(f.request);
    await f.database.connection.write(statement`UPDATE meter_license_head SET serial = 'missing'`);
    await expect(f.state.current({ now: 5000, onlineRequired: false })).rejects.toThrow('license_history_unavailable');
  });

  it('refuses a head whose generation differs from its valid signed history', async () => {
    const f = await licenseStateFixture();
    await f.state.record(f.request);
    await f.state.record(await f.next());
    await f.database.connection.write(statement`UPDATE meter_license_head SET generation = 1`);
    await expect(f.state.current({ now: 5000, onlineRequired: false })).rejects.toThrow('license_projection_invalid');
  });
});
