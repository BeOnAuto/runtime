import { describe, expect, it } from 'vitest';

import { assertQuoteMatches, executionQuote, type QuoteContext, type WorkBound } from '../index.ts';

const context: QuoteContext = {
  execution: { accountId: 'customer', deploymentId: 'cluster', playbookId: 'playbook', runId: 'run' },
  definitionVersion: 'version',
  inputDigest: 'a'.repeat(64),
  limitsDigest: 'b'.repeat(64),
  expiresAt: 2_000,
};
const plan: WorkBound = { type: 'execution', resources: [], developmentUnits: 0n };

describe('execution quote binding', () => {
  it('reproduces the same quote and checks it before dispatch', async () => {
    const quote = await executionQuote(context, plan, 1_000);
    expect(quote.id).toMatch(/^quote_[a-f0-9]{64}$/u);
    expect(quote.maximum.totalUnits).toBe(1_000_000n);
    expect(await executionQuote(context, plan, 1_100)).toEqual(quote);
    await expect(assertQuoteMatches(quote, context, plan, 1_200)).resolves.toBeUndefined();
  });

  it.each(['accountId', 'deploymentId', 'playbookId', 'runId'])(
    'cannot be replayed under another %s',
    async (field) => {
      const quote = await executionQuote(context, plan, 1_000);
      const changed = { ...context, execution: { ...context.execution, [field]: 'another' } };
      await expect(assertQuoteMatches(quote, changed, plan, 1_000)).rejects.toThrow('does not match');
    },
  );

  it.each(['definitionVersion', 'inputDigest', 'limitsDigest'])('binds approval to %s', async (field) => {
    const quote = await executionQuote(context, plan, 1_000);
    await expect(assertQuoteMatches(quote, { ...context, [field]: 'c'.repeat(64) }, plan, 1_000)).rejects.toThrow(
      'does not match',
    );
  });

  it('requires another approval when limits or the approval deadline change', async () => {
    const quote = await executionQuote(context, plan, 1_000);
    await expect(
      assertQuoteMatches(quote, context, { type: 'repeat', iterations: 2n, body: plan }, 1_000),
    ).rejects.toThrow('does not match');
    await expect(assertQuoteMatches(quote, { ...context, expiresAt: 3_000 }, plan, 1_000)).rejects.toThrow(
      'does not match',
    );
  });
});

describe('altered and expired quotes', () => {
  it('detects an edited amount, tariff or binding even when the original quote ID is supplied', async () => {
    const quote = await executionQuote(context, plan, 1_000);
    const maximum = { ...quote.maximum, totalUnits: 0n };
    await expect(assertQuoteMatches({ ...quote, maximum }, context, plan, 1_000)).rejects.toThrow('does not match');
    await expect(assertQuoteMatches({ ...quote, tariffVersion: 'another' }, context, plan, 1_000)).rejects.toThrow(
      'does not match',
    );
    await expect(assertQuoteMatches({ ...quote, bindingDigest: 'c'.repeat(64) }, context, plan, 1_000)).rejects.toThrow(
      'does not match',
    );
  });

  it.each([0, 999, 1_000, 1_000.5, Number.POSITIVE_INFINITY])(
    'refuses invalid or expired deadline %s',
    async (expiresAt) => {
      await expect(executionQuote({ ...context, expiresAt }, plan, 1_000)).rejects.toThrow('unexpired safe integer');
    },
  );

  it.each([-1, 0.5, Number.NaN])('refuses an unsafe trusted clock %s', async (now) => {
    await expect(executionQuote(context, plan, now)).rejects.toThrow('unexpired safe integer');
  });

  it('refuses a previously valid quote at the exact expiration boundary', async () => {
    const quote = await executionQuote(context, plan, 1_000);
    await expect(assertQuoteMatches(quote, context, plan, 2_000)).rejects.toThrow('unexpired safe integer');
  });

  it.each(['inputDigest', 'limitsDigest'])('requires a canonical SHA-256 %s', async (field) => {
    await expect(executionQuote({ ...context, [field]: 'unhashed-data' }, plan, 1_000)).rejects.toThrow(
      'SHA-256 digests',
    );
  });
});
