import { accountingDigest, type RunIdentity } from '../runs/identity.ts';
import { TARIFF_VERSION } from '../tariff/resources.ts';
import { maximumSpend, type SpendingBound, type WorkBound } from './work-bounds.ts';

export interface QuoteContext {
  readonly run: RunIdentity;
  readonly definitionVersion: string;
  readonly inputDigest: string;
  readonly limitsDigest: string;
  readonly expiresAt: number;
}

export interface RunQuote {
  readonly id: string;
  readonly bindingDigest: string;
  readonly tariffVersion: string;
  readonly expiresAt: number;
  readonly maximum: SpendingBound;
}

function bindingDigest(context: QuoteContext): Promise<string> {
  const { run, definitionVersion, inputDigest, limitsDigest } = context;
  if (!/^[a-f0-9]{64}$/u.test(inputDigest) || !/^[a-f0-9]{64}$/u.test(limitsDigest)) {
    throw new RangeError('A quote requires input and enforced-limit SHA-256 digests');
  }
  return accountingDigest([
    'auto.quote-binding.v1',
    run.accountId,
    run.deploymentId,
    run.playbookId,
    run.runId,
    definitionVersion,
    inputDigest,
    limitsDigest,
  ]);
}

function validDeadline(expiresAt: number, now: number): void {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    throw new RangeError('The quote must have an unexpired safe integer deadline');
  }
}

async function quoteId(quote: Omit<RunQuote, 'id'>): Promise<string> {
  const { maximum } = quote;
  return `quote_${await accountingDigest([
    'auto.quote.v1',
    quote.bindingDigest,
    quote.tariffVersion,
    String(quote.expiresAt),
    String(maximum.platformUnits),
    String(maximum.resourceUnits),
    String(maximum.developmentUnits),
    String(maximum.totalUnits),
  ])}`;
}

export async function runQuote(context: QuoteContext, plan: WorkBound, now: number): Promise<RunQuote> {
  validDeadline(context.expiresAt, now);
  const quote = {
    bindingDigest: await bindingDigest(context),
    tariffVersion: TARIFF_VERSION,
    expiresAt: context.expiresAt,
    maximum: maximumSpend(plan),
  };
  return { ...quote, id: await quoteId(quote) };
}

export async function assertQuoteMatches(
  quote: RunQuote,
  context: QuoteContext,
  plan: WorkBound,
  now: number,
): Promise<void> {
  const expected = await runQuote(context, plan, now);
  if (quote.id !== expected.id || (await quoteId(quote)) !== expected.id) {
    throw new RangeError('The approved quote does not match this run, its limits or its tariff');
  }
}
