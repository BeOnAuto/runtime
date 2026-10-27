import { statement } from '@on.auto/ledger';
import {
  verifyInstallationProof,
  verifyUsageReport,
  type InstallationChallenge,
  type OfflineAllocation,
  type OfflineUsageReport,
} from '@on.auto/metering';
import { Effect, Schema } from 'effect';
import { expect, it } from 'vitest';

import { openInstallation } from '../index.ts';
import type { InstallationSigner } from '../installation/records.ts';
import type { MeterDatabase } from './database.ts';

function challengeFor(identity: InstallationSigner): InstallationChallenge {
  return {
    clusterId: identity.clusterId,
    installationKeyDigest: identity.installationKeyDigest,
    issuer: 'https://accounts.auto.test',
    ring: 'local',
    id: 'challenge-one',
    accountId: 'account-one',
    installationId: 'installation-one',
    licenseId: 'license-one',
    purpose: 'activate',
    generation: 0,
    nonce: 'A'.repeat(43),
    createdAt: 1000,
    expiresAt: 301_000,
    requestDigest: 'a'.repeat(64),
  };
}

function reportFor(
  identity: InstallationSigner,
): Readonly<{ allocation: OfflineAllocation; report: OfflineUsageReport }> {
  const allocation: OfflineAllocation = {
    clusterId: identity.clusterId,
    installationKeyDigest: identity.installationKeyDigest,
    issuer: 'https://accounts.auto.test',
    ring: 'local',
    accountId: 'account-one',
    installationId: 'installation-one',
    id: 'allocation-one',
    epoch: 1,
    mode: 'standard',
    issuedAt: 1000,
    expiresAt: 301_000,
    sources: [{ lotId: 'lot-one', source: 'welcome', units: 1_000_000n, issuedAt: 1000, expiresAt: 301_000 }],
  };
  return {
    allocation,
    report: {
      clusterId: identity.clusterId,
      installationKeyDigest: identity.installationKeyDigest,
      issuer: allocation.issuer,
      ring: allocation.ring,
      accountId: allocation.accountId,
      installationId: allocation.installationId,
      epoch: allocation.epoch,
      allocationId: allocation.id,
      sequence: 1,
      previousCheckpoint: '0'.repeat(64),
      reportedAt: 2000,
      close: false,
      counters: [{ lotId: 'lot-one', committedUnits: 0n, reservedUnits: 0n }],
      charges: [],
    },
  };
}

const secretReference = Schema.decodeUnknownSync(Schema.Tuple([Schema.Struct({ secret_id: Schema.String })]));

export async function secretIdIn(database: MeterDatabase): Promise<string> {
  const [{ secret_id: id }] = secretReference(
    await database.connection.read(statement`SELECT secret_id FROM meter_identity`),
  );
  return id;
}

function retainedIdentityBehaviour(open: () => Promise<MeterDatabase>): void {
  it('keeps one encrypted signing identity through a process restart and exposes only public metadata', async () => {
    const database = await open();
    const identity = await openInstallation(database);
    const challenge = challengeFor(identity);
    const proof = await identity.proveChallenge(challenge);
    const reference = await secretIdIn(database);
    const [secret] = await database.connection.read(
      statement`SELECT held, kept_by, wrapped_key FROM kept_secrets WHERE id = ${reference}`,
    );
    await database.close();
    const restarted = await database.reopen();
    const reopened = await openInstallation(restarted);

    await verifyInstallationProof(proof, challenge, reopened.publicKey, 2000);
    expect(await reopened.proveChallenge(challenge)).toBe(proof);
    expect(reopened.clusterId).toBe(identity.clusterId);
    expect(secret).toMatchObject({ kept_by: 'ledger' });
    expect(Schema.decodeUnknownSync(Schema.Struct({ wrapped_key: Schema.String }))(secret).wrapped_key).not.toBe('');
    expect(JSON.stringify(secret)).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(identity)).not.toContain(reference);
    expect(Object.keys(identity).toSorted()).toEqual([
      'clusterId',
      'installationKeyDigest',
      'proveChallenge',
      'publicKey',
      'signReport',
    ]);
    expect(Object.isFrozen(identity.publicKey)).toBe(true);
  });

  it('shares one identity between replicas racing to start, retaining only the winning key', async () => {
    const first = await open();
    const second = await first.reopen();
    const identities = await Promise.all(
      Array.from({ length: 10 }, () => [openInstallation(first), openInstallation(second)]).flat(),
    );
    expect(new Set(identities.map((identity) => identity.clusterId)).size).toBe(1);
    expect(new Set(identities.map((identity) => identity.installationKeyDigest)).size).toBe(1);
    expect(await first.connection.read(statement`SELECT id FROM meter_identity`)).toHaveLength(1);
    expect(await first.connection.read(statement`SELECT id FROM kept_secrets`)).toHaveLength(1);
  });
}

function recoveredIdentityBehaviour(open: () => Promise<MeterDatabase>): void {
  it('recovers the committed key after the database loses its acknowledgement', async () => {
    const database = await open();
    const identity = await openInstallation({
      ...database,
      connection: {
        ...database.connection,
        write: async (sql) => {
          await database.connection.write(sql);
          throw new Error('acknowledgement_lost');
        },
      },
    });
    const reopened = await openInstallation(database);
    expect(reopened.installationKeyDigest).toBe(identity.installationKeyDigest);
    expect(await database.connection.read(statement`SELECT id FROM kept_secrets`)).toHaveLength(1);
  });
}

function signedIdentityBehaviour(open: () => Promise<MeterDatabase>): void {
  it('retains the candidate secret when the write outcome cannot be established', async () => {
    const database = await open();
    await expect(
      openInstallation({
        ...database,
        connection: { ...database.connection, write: () => Promise.reject(new Error('write_unavailable')) },
      }),
    ).rejects.toThrow('write_unavailable');
    expect(await database.connection.read(statement`SELECT id FROM meter_identity`)).toHaveLength(0);
    expect(await database.connection.read(statement`SELECT id FROM kept_secrets`)).toHaveLength(1);
  });

  it('refuses signing if a stored identity has lost its private key and preserves its public identity', async () => {
    const database = await open();
    const identity = await openInstallation(database);
    await Effect.runPromise(database.secrets.forget(await secretIdIn(database)));
    await expect(openInstallation(database)).rejects.toThrow('installation_key_unavailable');
    expect(await database.connection.read(statement`SELECT cluster_id FROM meter_identity`)).toEqual([
      { cluster_id: identity.clusterId },
    ]);
    expect(await database.connection.read(statement`SELECT id FROM kept_secrets`)).toHaveLength(0);
  });

  it('signs the canonical cumulative report with the installation key and its dedicated protocol type', async () => {
    const database = await open();
    const identity = await openInstallation(database);
    const { allocation, report } = reportFor(identity);
    const proof = await identity.signReport(report);
    expect((await verifyUsageReport(proof, allocation, identity.publicKey, 3000)).report).toEqual(report);
  });

  it('refuses challenge proofs and reports bound to another cluster or installation key', async () => {
    const identity = await openInstallation(await open());
    const challenge = challengeFor(identity);
    const { report } = reportFor(identity);
    expect(() => identity.proveChallenge({ ...challenge, clusterId: 'another-cluster' })).toThrow(
      'installation_binding_mismatch',
    );
    expect(() => identity.proveChallenge({ ...challenge, installationKeyDigest: 'b'.repeat(64) })).toThrow(
      'installation_binding_mismatch',
    );
    expect(() => identity.signReport({ ...report, clusterId: 'another-cluster' })).toThrow(
      'installation_binding_mismatch',
    );
    expect(() => identity.signReport({ ...report, installationKeyDigest: 'b'.repeat(64) })).toThrow(
      'installation_binding_mismatch',
    );
  });
}

export function identityBehaviour(open: () => Promise<MeterDatabase>): void {
  retainedIdentityBehaviour(open);
  recoveredIdentityBehaviour(open);
  signedIdentityBehaviour(open);
}
