import { CompactSign, errors, exportJWK, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  installationKeyFingerprint,
  readInstallationPublicKey,
  usageReportPayload,
  verifyUsageReport,
  offlineCheckpoint,
  OFFLINE_REPORT_TYPE,
  MOST_REPORT_TOKEN_CHARACTERS,
  type OfflineAllocation,
  type OfflineUsageReport,
} from '../index.ts';

async function fixture() {
  const pair = await generateKeyPair('EdDSA');
  const publicKey = readInstallationPublicKey(await exportJWK(pair.publicKey));
  const installationKeyDigest = await installationKeyFingerprint(publicKey);
  const allocation: OfflineAllocation = {
    issuer: 'https://licenses.auto.test',
    ring: 'local',
    accountId: 'account',
    installationId: 'installation',
    clusterId: 'cluster',
    installationKeyDigest,
    id: 'allocation',
    epoch: 1,
    mode: 'standard',
    issuedAt: 5_000,
    expiresAt: 604_805_000,
    sources: [{ lotId: 'grant', source: 'free', issuedAt: 1_000, expiresAt: 100_000, units: 40_000_000n }],
  };
  const report: OfflineUsageReport = {
    ...allocation,
    allocationId: allocation.id,
    sequence: 1,
    previousCheckpoint: 'b'.repeat(64),
    reportedAt: 6_000,
    close: false,
    counters: [{ lotId: 'grant', committedUnits: 1_000_000n, reservedUnits: 2_000_000n }],
    charges: [
      {
        playbookId: 'playbook',
        runId: 'run',
        evidenceDigest: 'c'.repeat(64),
        admittedAt: 5_000,
        committedAt: 6_000,
        parts: [{ lotId: 'grant', units: 1_000_000n }],
      },
    ],
  };
  const header = { alg: 'EdDSA', typ: OFFLINE_REPORT_TYPE, kid: installationKeyDigest };
  function sign(text = usageReportPayload(report), protectedHeader: Readonly<typeof header> = header) {
    return new CompactSign(new TextEncoder().encode(text)).setProtectedHeader(protectedHeader).sign(pair.privateKey);
  }
  function verify(token: string, now = report.reportedAt) {
    return verifyUsageReport(token, allocation, publicKey, now);
  }
  return { allocation, report, publicKey, header, sign, verify };
}

describe('installation-signed offline usage', () => {
  it('authenticates a cumulative report and its canonical hash checkpoint', async () => {
    const f = await fixture();
    const result = await f.verify(await f.sign());
    expect(result.report.counters).toEqual(f.report.counters);
    expect(result.checkpoint).toBe(await offlineCheckpoint(usageReportPayload(f.report)));
  });

  it('accepts delayed reporting of work admitted while its source was valid', async () => {
    const f = await fixture();
    const report = {
      ...f.report,
      reportedAt: 700_000_000,
      charges: f.report.charges.map((charge) => ({ ...charge, committedAt: 700_000_000 })),
    };
    expect((await f.verify(await f.sign(usageReportPayload(report)), report.reportedAt)).report.reportedAt).toBe(
      report.reportedAt,
    );
  });

  it('refuses an unrelated private key, substituted public key and wrong proof type', async () => {
    const f = await fixture();
    const attacker = await fixture();
    await expect(f.verify(await attacker.sign())).rejects.toThrow(errors.JWSSignatureVerificationFailed);
    await expect(verifyUsageReport(await f.sign(), f.allocation, attacker.publicKey, 6_000)).rejects.toThrow(
      'another public key',
    );
    await expect(
      f.verify(await f.sign(undefined, { ...f.header, typ: 'auto-installation-proof+jws' })),
    ).rejects.toThrow('dedicated type');
    await expect(f.verify(await f.sign(undefined, { ...f.header, kid: 'other' }))).rejects.toThrow('dedicated type');
  });
});

describe('report allocation binding', () => {
  const changes: readonly Partial<OfflineUsageReport>[] = [
    { issuer: 'https://other.test' },
    { ring: 'production' },
    { accountId: 'other' },
    { installationId: 'other' },
    { clusterId: 'other' },
    { installationKeyDigest: 'f'.repeat(64) },
    { allocationId: 'other' },
    { epoch: 2 },
  ];
  it.each(changes)('refuses cross-scope evidence: %j', async (change) => {
    const f = await fixture();
    await expect(f.verify(await f.sign(usageReportPayload({ ...f.report, ...change })))).rejects.toThrow(
      'another allocation',
    );
  });

  it('requires every source counter and refuses an unknown or excessive source', async () => {
    const f = await fixture();
    const counters = [
      { lotId: 'grant', committedUnits: 0n, reservedUnits: 0n },
      { lotId: 'other', committedUnits: 0n, reservedUnits: 0n },
    ];
    await expect(f.verify(await f.sign(usageReportPayload({ ...f.report, counters })))).rejects.toThrow(
      'every allocated source',
    );
    await Promise.all(
      [
        { lotId: 'other', committedUnits: 1_000_000n, reservedUnits: 0n },
        { lotId: 'grant', committedUnits: 40_000_000n, reservedUnits: 1n },
      ].map(async (counter: Readonly<{ lotId: string; committedUnits: bigint; reservedUnits: bigint }>) =>
        expect(f.verify(await f.sign(usageReportPayload({ ...f.report, counters: [counter] })))).rejects.toThrow(
          'source capacity',
        ),
      ),
    );
  });
});

describe('offline admission timing', () => {
  it.each([4_999, 604_805_000])('refuses admission outside allocation validity: %s', async (admittedAt) => {
    const f = await fixture();
    const reportedAt = Math.max(6_000, admittedAt);
    const report = {
      ...f.report,
      reportedAt,
      charges: f.report.charges.map((charge) => ({ ...charge, admittedAt, committedAt: reportedAt })),
    };
    await expect(f.verify(await f.sign(usageReportPayload(report)), reportedAt)).rejects.toThrow('allocation validity');
  });

  it('refuses source expiry and unknown charge sources while accepting an earlier admission', async () => {
    const f = await fixture();
    const expired = {
      ...f.report,
      reportedAt: 100_000,
      charges: f.report.charges.map((charge) => ({ ...charge, admittedAt: 100_000, committedAt: 100_000 })),
    };
    await expect(f.verify(await f.sign(usageReportPayload(expired)), 100_000)).rejects.toThrow(
      'unknown or expired source',
    );
    const unknown = {
      ...f.report,
      charges: f.report.charges.map((charge) => ({ ...charge, parts: [{ lotId: 'other', units: 1_000_000n }] })),
    };
    await expect(f.verify(await f.sign(usageReportPayload(unknown)))).rejects.toThrow('unknown or expired source');
  });

  it('refuses premature and future reports or an invalid trusted clock', async () => {
    const f = await fixture();
    const premature = { ...f.report, reportedAt: 4_999, charges: [] };
    await expect(f.verify(await f.sign(usageReportPayload(premature)))).rejects.toThrow('trusted time');
    await expect(f.verify(await f.sign(), 5_999)).rejects.toThrow('trusted time');
    await expect(f.verify('', -1)).rejects.toThrow('safe non-negative');
  });
});

describe('report size and payload bytes', () => {
  it('bounds reports before doing cryptographic work', async () => {
    const f = await fixture();
    await expect(f.verify('x'.repeat(MOST_REPORT_TOKEN_CHARACTERS + 1))).rejects.toThrow('size bound');
  });

  it('refuses noncanonical, malformed and business-content payloads even when signed', async () => {
    const f = await fixture();
    const payload = usageReportPayload(f.report);
    await Promise.all(
      [` ${payload}`, payload.replace('"close":false', '"close":false,"prompt":"secret"')].map(async (text) =>
        expect(f.verify(await f.sign(text))).rejects.toThrow('canonical'),
      ),
    );
    await Promise.all(
      [`\uFEFF${payload}`, 'not-json'].map(async (text) =>
        expect(f.verify(await f.sign(text))).rejects.toThrow(SyntaxError),
      ),
    );
  });
});
