import { accountingDigest, type ExecutionIdentity } from '../executions/identity.ts';
import { TARIFF_VERSION } from '../tariff/resources.ts';
import { maximumSpend, type SpendingBound, type WorkBound } from './work-bounds.ts';

export interface QuoteContext {
  readonly execution: ExecutionIdentity;
  readonly definitionVersion: string;
  readonly inputDigest: string;
  readonly limitsDigest: string;
  readonly expiresAt: number;
}

export interface ExecutionQuote {
  readonly id: string;
  readonly bindingDigest: string;
  readonly tariffVersion: string;
  readonly expiresAt: number;
  readonly maximum: SpendingBound;
}

function bindingDigest(context: QuoteContext): Promise<string> {
  const { execution, definitionVersion, inputDigest, limitsDigest } = context;
  if (!/^[a-f0-9]{64}$/u.test(inputDigest) || !/^[a-f0-9]{64}$/u.test(limitsDigest)) {
    throw new RangeError('A quote requires input and enforced-limit SHA-256 digests');
  }
  return accountingDigest([
    'auto.quote-binding.v1',
    execution.accountId,
    execution.deploymentId,
    execution.playbookId,
    execution.runId,
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

async function quoteId(quote: Omit<ExecutionQuote, 'id'>): Promise<string> {
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

export async function executionQuote(context: QuoteContext, plan: WorkBound, now: number): Promise<ExecutionQuote> {
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
  quote: ExecutionQuote,
  context: QuoteContext,
  plan: WorkBound,
  now: number,
): Promise<void> {
  const expected = await executionQuote(context, plan, now);
  if (quote.id !== expected.id || (await quoteId(quote)) !== expected.id) {
    throw new RangeError('The approved quote does not match this execution, its limits or its tariff');
  }
}
