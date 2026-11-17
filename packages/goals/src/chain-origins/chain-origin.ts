import { localDeveloperId, signedInPersonPrefix, type Context } from '@on.auto/operations';

export type ChainOrigin = 'schedule' | 'machine' | 'person' | 'playbook' | 'service' | 'test' | 'unknown';

export interface ChainFact {
  readonly stream: string;
  readonly context: Context;
  readonly causationId: string | null;
  readonly correlationId: string | null;
}

export type ChainStep =
  | { readonly origin: ChainOrigin }
  | { readonly firstFactOf: string }
  | { readonly record: string };

export interface CallerRule {
  readonly serviceCallers: ReadonlySet<string>;
}

const playbookCallerPrefix = 'playbook:';

const keyHolderId = /^[a-z0-9-]{1,32}$/u;

const ofARunStream = /(?:^|\/)runs\/([^/]+)$/u;

const countingOrigins: ReadonlySet<ChainOrigin> = new Set(['schedule', 'machine', 'person']);

export function originCounts(origin: ChainOrigin): boolean {
  return countingOrigins.has(origin);
}

export function callerOriginOf(by: string, { serviceCallers }: CallerRule): ChainOrigin {
  if (by === localDeveloperId || by.startsWith(signedInPersonPrefix)) {
    return 'person';
  }
  if (by.startsWith(playbookCallerPrefix)) {
    return 'playbook';
  }
  if (serviceCallers.has(by)) {
    return 'service';
  }
  return keyHolderId.test(by) ? 'machine' : 'unknown';
}

function startedByTheRun({ context, causationId }: ChainFact, rule: CallerRule): ChainStep {
  if (context.trigger?.kind === 'event') {
    return causationId === null ? { origin: 'unknown' } : { record: causationId };
  }
  return context.calledBy === undefined
    ? { origin: callerOriginOf(context.by, rule) }
    : { firstFactOf: context.calledBy.runId };
}

const ofATest: ChainStep = { origin: 'test' };

export function stepFromARunFact(run: string, fact: ChainFact, first: boolean, rule: CallerRule): ChainStep {
  if (fact.context.test === true) {
    return ofATest;
  }
  const kind = fact.context.trigger?.kind;
  if (kind === 'cron' || kind === 'every') {
    return { origin: 'schedule' };
  }
  if (kind === 'goal') {
    return { origin: 'playbook' };
  }
  const { correlationId: top } = fact;
  if (top !== null && top !== run) {
    return { firstFactOf: top };
  }
  return first ? startedByTheRun(fact, rule) : { firstFactOf: run };
}

export function stepFromACause({ stream, context, correlationId }: ChainFact, rule: CallerRule): ChainStep {
  if (context.test === true) {
    return ofATest;
  }
  const run = context.runId ?? ofARunStream.exec(stream)?.[1];
  if (run === undefined) {
    return { origin: callerOriginOf(context.by, rule) };
  }
  return { firstFactOf: correlationId ?? run };
}
