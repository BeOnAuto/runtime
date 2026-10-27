import { statement } from '@on.auto/ledger';
import { MOST_REPORT_TOKEN_CHARACTERS } from '@on.auto/metering';
import { describe, expect, it } from 'vitest';

import { openOfflineReporter } from '../index.ts';
import { reportingFixture } from '../offline-testing/report-fixture.ts';

describe('bounded offline report counters', () => {
  it('refuses exhausted local revisions before signing another report or closing', async () => {
    const f = await reportingFixture();
    await f.options.connection.write(statement`UPDATE meter_capacity_state SET revision = 9007199254740991`);
    await expect(f.reporter.prepare()).rejects.toThrow('offline_report_exhausted');
    await expect(f.reporter.requestClose(f.allocation.id)).rejects.toThrow('offline_close_exhausted');
    expect(await f.reporter.pending()).toBeUndefined();
  });

  it('refuses an exhausted report sequence without inventing history', async () => {
    const f = await reportingFixture();
    await f.options.connection.write(statement`UPDATE meter_capacity_state SET report_sequence = 9007199254740991`);
    await expect(f.reporter.prepare()).rejects.toThrow('offline_report_exhausted');
    expect(await f.reporter.pending()).toBeUndefined();
  });

  it('retains the pending report when local acknowledgement revisions are exhausted', async () => {
    const f = await reportingFixture();
    const prepared = await f.reporter.prepare();
    await f.options.connection.write(statement`UPDATE meter_capacity_state SET revision = 9007199254740991`);
    await expect(f.reporter.send()).rejects.toThrow('offline_report_exhausted');
    expect(await f.reporter.pending()).toEqual(prepared);
  });
});

describe('bounded offline report contention', () => {
  it('bounds repeated report creation and close conflicts', async () => {
    const f = await reportingFixture();
    const reporter = await openOfflineReporter({
      ...f.reporting,
      connection: { ...f.options.connection, transaction: () => Promise.resolve([]) },
    });
    await expect(reporter.prepare()).rejects.toThrow('offline_report_contended');
    await expect(reporter.requestClose(f.allocation.id)).rejects.toThrow('offline_close_contended');
    expect(await reporter.pending()).toBeUndefined();
  });

  it('bounds acknowledgement conflicts and preserves the exact report', async () => {
    const f = await reportingFixture();
    const prepared = await f.reporter.prepare();
    const reporter = await openOfflineReporter({
      ...f.reporting,
      connection: { ...f.options.connection, transaction: () => Promise.resolve([]) },
    });
    await expect(reporter.send()).rejects.toThrow('offline_report_contended');
    expect(await reporter.pending()).toEqual(prepared);
  });
});

describe('verified report signing', () => {
  it('refuses a signer returning oversized bytes without saving an unusable report', async () => {
    const f = await reportingFixture();
    const reporter = await openOfflineReporter({
      ...f.reporting,
      installation: {
        ...f.installation,
        signReport: () => Promise.resolve('x'.repeat(MOST_REPORT_TOKEN_CHARACTERS + 1)),
      },
    });
    await expect(reporter.prepare()).rejects.toThrow('offline_report_exceeds_bound');
    expect(await reporter.pending()).toBeUndefined();
  });

  it('refuses a signature over different valid counters instead of changing the prepared snapshot', async () => {
    const f = await reportingFixture();
    const reporter = await openOfflineReporter({
      ...f.reporting,
      installation: {
        ...f.installation,
        signReport: (report) => f.installation.signReport({ ...report, counters: report.counters.toReversed() }),
      },
    });
    await expect(reporter.prepare()).rejects.toThrow('offline_report_signature_mismatch');
    expect(await reporter.pending()).toBeUndefined();
  });

  it('rejects an allocation from another configured authority or installed identity', async () => {
    const f = await reportingFixture();
    const reporter = await openOfflineReporter({
      ...f.reporting,
      authority: { ...f.trust, issuer: 'https://other.test' },
    });
    await expect(reporter.prepare()).rejects.toThrow('offline_report_authority_mismatch');
    const other = await openOfflineReporter({
      ...f.reporting,
      installation: { ...f.installation, clusterId: 'other-cluster' },
    });
    await expect(other.prepare()).rejects.toThrow('offline_report_authority_mismatch');
  });
});

describe('explicit close identity', () => {
  it('cannot close a different allocation or silently invent a close request for frozen state', async () => {
    const f = await reportingFixture();
    await expect(f.reporter.requestClose('different')).rejects.toThrow('offline_allocation_not_current');
    await f.options.connection.write(statement`UPDATE meter_capacity_state SET state = 'quarantined'`);
    await expect(f.reporter.requestClose(f.allocation.id)).rejects.toThrow('offline_allocation_unavailable');
  });
});
