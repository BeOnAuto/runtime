import { describe, expect, it } from 'vitest';

import { executionChargeId, resourceReceiptId, type ExecutionIdentity } from '../index.ts';

const run: ExecutionIdentity = { accountId: 'customer', deploymentId: 'cluster', playbookId: 'playbook', runId: 'run' };

describe('logical execution identities', () => {
  it('keeps the same identity through retry, restart and response replay', async () => {
    const first = await executionChargeId(run, 'platform');
    expect(first).toMatch(/^charge_[a-f0-9]{64}$/u);
    expect(await executionChargeId({ ...run }, 'platform')).toBe(first);
    expect(await executionChargeId(run, 'development')).not.toBe(first);
  });

  it.each(['accountId', 'deploymentId', 'playbookId', 'runId'])('isolates charges by %s', async (field) => {
    expect(await executionChargeId({ ...run, [field]: 'another' }, 'platform')).not.toBe(
      await executionChargeId(run, 'platform'),
    );
  });

  it('does not collide when delimiters occur in identifiers', async () => {
    const first = { ...run, accountId: 'a:b', deploymentId: 'c' };
    const second = { ...run, accountId: 'a', deploymentId: 'b:c' };
    expect(await executionChargeId(first, 'platform')).not.toBe(await executionChargeId(second, 'platform'));
  });

  it.each(['', ' account', 'account ', 'x'.repeat(513)])('refuses an invalid identity component', async (accountId) => {
    await expect(executionChargeId({ ...run, accountId }, 'platform')).rejects.toThrow('bounded identifiers');
  });
});

describe('provider receipt identities', () => {
  it('deduplicates a response and a later gateway log by the provider request', async () => {
    const response = await resourceReceiptId('customer', 'gateway', 'request');
    expect(response).toMatch(/^resource_[a-f0-9]{64}$/u);
    expect(await resourceReceiptId('customer', 'gateway', 'request')).toBe(response);
    expect(await resourceReceiptId('customer', 'gateway', 'retry-request')).not.toBe(response);
    expect(await resourceReceiptId('another', 'gateway', 'request')).not.toBe(response);
    expect(await resourceReceiptId('customer', 'another', 'request')).not.toBe(response);
  });
});
