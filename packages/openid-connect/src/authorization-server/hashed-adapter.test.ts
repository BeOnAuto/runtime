import { sha256Of } from '@on.auto/content';
import { describe, expect, it, onTestFinished } from 'vitest';

import { authStoreInMemory } from '../testing/store-in-memory.ts';
import { hashedAdapterOf } from './hashed-adapter.ts';
import type { ProviderRows } from './provider-rows.ts';

const at = Date.parse('2026-11-19T09:00:00Z');

async function rowsInMemory(): Promise<ProviderRows> {
  const { store, close } = await authStoreInMemory();
  onTestFinished(close);
  return store.providerRows;
}

function sweepsCountedOn(rows: ProviderRows, swept: (endedBefore: number) => void): ProviderRows {
  return {
    ...rows,
    swept: (endedBefore) => {
      swept(endedBefore);
      return rows.swept(endedBefore);
    },
  };
}

describe('the adapter that keeps the authorization server rows by the SHA-256 of their ids', () => {
  it("finds a row by its id, puts the id back, and keeps neither the id nor an interaction's session value", async () => {
    const rows = await rowsInMemory();
    const adapter = hashedAdapterOf({ rows, now: () => at });
    const interactions = adapter('Interaction');

    await interactions.upsert('uid-1', { jti: 'uid-1', session: { accountId: 'a3f1', cookie: 'session-value' } }, 60);

    expect(await interactions.find('uid-1')).toEqual({ jti: 'uid-1', session: { accountId: 'a3f1' } });
    expect(await rows.found({ model: 'Interaction', sha256: sha256Of('uid-1') })).toEqual({
      payload: '{"session":{"accountId":"a3f1"}}',
      grantId: undefined,
      consumedAt: undefined,
    });
    expect(await adapter('Interaction').findByUserCode('code')).toBeUndefined();
  });

  it('finds a session by its uid, without the value its cookie holds', async () => {
    const adapter = hashedAdapterOf({ rows: await rowsInMemory(), now: () => at });

    await adapter('Session').upsert('session-value', { jti: 'session-value', uid: 'uid-2', accountId: 'a3f1' }, 60);

    expect(await adapter('Session').findByUid('uid-2')).toEqual({ uid: 'uid-2', accountId: 'a3f1' });
  });
});

describe('the adapter, as rows are consumed, destroyed and swept', () => {
  it('consumes a row once, and ends its whole grant when it is consumed a second time', async () => {
    const adapter = hashedAdapterOf({ rows: await rowsInMemory(), now: () => at });
    await adapter('Grant').upsert('grant-1', { jti: 'grant-1', accountId: 'a3f1' }, 600);
    await adapter('AccessToken').upsert('access', { jti: 'access', grantId: 'grant-1' }, 60);
    await adapter('RefreshToken').upsert('refresh', { jti: 'refresh', grantId: 'grant-1' }, 600);
    await adapter('RefreshToken').consume('refresh');

    await expect(adapter('RefreshToken').consume('refresh')).rejects.toMatchObject({ error: 'invalid_grant' });
    expect(await Promise.all([adapter('Grant').find('grant-1'), adapter('AccessToken').find('access')])).toEqual([
      undefined,
      undefined,
    ]);
    await expect(adapter('AuthorizationCode').consume('never-kept')).rejects.toMatchObject({ error: 'invalid_grant' });
  });

  it('marks a consumed row so, and destroys rows by their id and by their grant', async () => {
    const adapter = hashedAdapterOf({ rows: await rowsInMemory(), now: () => at });
    await adapter('AuthorizationCode').upsert('code', { jti: 'code', grantId: 'grant-2' }, 60);
    await adapter('AccessToken').upsert('access', { jti: 'access', grantId: 'grant-2' }, 60);
    await adapter('Grant').upsert('grant-2', { jti: 'grant-2' }, 600);

    await adapter('AuthorizationCode').consume('code');
    const consumed = await adapter('AuthorizationCode').find('code');
    await adapter('AccessToken').revokeByGrantId('grant-2');
    await adapter('Grant').destroy('grant-2');

    expect(consumed).toEqual({ jti: 'code', grantId: 'grant-2', consumed: at / 1000 });
    expect(await Promise.all([adapter('AccessToken').find('access'), adapter('Grant').find('grant-2')])).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe('the adapter, as rows are kept', () => {
  it('sweeps the rows that ended a day before, at most once a minute, as rows are kept', async () => {
    const swept: number[] = [];
    const clock = { now: at };
    const counted = sweepsCountedOn(await rowsInMemory(), (endedBefore) => {
      swept.push(endedBefore);
    });
    const adapter = hashedAdapterOf({ rows: counted, now: () => clock.now });

    await adapter('Client').upsert('client-1', { client_id: 'client-1' });
    await adapter('Client').upsert('client-2', { client_id: 'client-2' });
    clock.now += 60_000;
    await adapter('Client').upsert('client-3', { client_id: 'client-3' });

    expect(swept).toEqual([at - 86_400_000, at + 60_000 - 86_400_000]);
    expect(await adapter('Client').find('client-1')).toEqual({ jti: 'client-1', client_id: 'client-1' });
  });
});
