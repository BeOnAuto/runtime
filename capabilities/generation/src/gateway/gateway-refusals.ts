import { Conflict, Unavailable } from '@on.auto/operations';
import { Predicate, type Schema } from 'effect';

import { sizeInWords } from '../assets/asset-words.ts';

export type GatewayRefusal = Conflict | Unavailable;

const moderationSignals: ReadonlySet<unknown> = new Set([
  'moderation_blocked',
  'content_policy_violation',
  'content_filter',
]);

const moderationInWords = /content ?policy ?violation|moderation_blocked|safety system/iu;

const budgetSignals: ReadonlySet<unknown> = new Set([
  'budget_exceeded',
  'insufficient_quota',
  'billing_hard_limit_reached',
  'quota_exceeded',
]);

const budgetInWords = /budget has been exceeded|exceeded your current quota|insufficient[_ ]quota/iu;

const shownCode = /^[A-Za-z0-9_.-]{1,64}$/u;

const unavailableStatuses: ReadonlySet<number> = new Set([408, 409, 425]);

const passingStatuses: ReadonlySet<number> = new Set([...unavailableStatuses, 429]);

function errorFieldOf(body: unknown, field: 'code' | 'type' | 'message'): unknown {
  return Predicate.hasProperty(body, 'error') && Predicate.hasProperty(body.error, field)
    ? body.error[field]
    : undefined;
}

function isModerationRefusal(body: unknown): boolean {
  const message = errorFieldOf(body, 'message');
  return (
    moderationSignals.has(errorFieldOf(body, 'code')) ||
    moderationSignals.has(errorFieldOf(body, 'type')) ||
    (typeof message === 'string' && moderationInWords.test(message))
  );
}

function isBudgetRefusal(status: number, body: unknown): boolean {
  const message = errorFieldOf(body, 'message');
  return (
    status === 402 ||
    budgetSignals.has(errorFieldOf(body, 'code')) ||
    budgetSignals.has(errorFieldOf(body, 'type')) ||
    (typeof message === 'string' && budgetInWords.test(message))
  );
}

function codeInWords(body: unknown): string {
  const code = errorFieldOf(body, 'code');
  return typeof code === 'string' && shownCode.test(code) ? `, with the error code ${code}` : '';
}

const counted = new Intl.NumberFormat('en');

export function unreachedBy(gateway: string, timedOut: boolean, answerMs: number): Unavailable {
  return new Unavailable({
    detail: timedOut
      ? `The gateway ${gateway} did not answer within ${counted.format(answerMs / 1000)} seconds; try again later`
      : `The gateway ${gateway} could not be reached; try again later`,
  });
}

const blockedByModeration = (gateway: string): Conflict =>
  new Conflict({
    detail: `The provider behind the gateway ${gateway} refused the request under its moderation; change the prompt, the input or the references`,
    kind: 'blocked_by_moderation',
  });

function rejectedRequest(gateway: string, status: number, body: unknown): GatewayRefusal {
  if (isModerationRefusal(body)) {
    return blockedByModeration(gateway);
  }
  const reading = status === 404 ? 'the model was not found' : 'the request was not accepted';
  return new Conflict({
    detail: `The gateway ${gateway} answered HTTP ${status}: ${reading}${codeInWords(body)}; update the generation function definition`,
    kind: 'unworkable',
  });
}

function outOfBudget(gateway: string, status: number): Unavailable {
  return new Unavailable({
    detail: `The gateway ${gateway} refused the request for its own budget or quota (HTTP ${status}); try again once it has room`,
  });
}

export type Rejecting = (gateway: string, status: number, body: unknown) => GatewayRefusal;

function refusalOfItsStatus(gateway: string, status: number, body: unknown, rejected: Rejecting): GatewayRefusal {
  if (status === 401 || status === 403) {
    return new Unavailable({ detail: `The gateway ${gateway} rejected the credentials (HTTP ${status})` });
  }
  if (status === 429) {
    return new Unavailable({ detail: `The gateway ${gateway} is limiting the rate of requests; try again later` });
  }
  if (status >= 300 && status < 400) {
    return new Unavailable({
      detail: `The gateway ${gateway} answered a redirect (HTTP ${status}), which this runtime does not follow, so its address may be wrong`,
    });
  }
  if (status >= 500 || unavailableStatuses.has(status)) {
    return new Unavailable({
      detail: `The gateway ${gateway} could not serve the request (HTTP ${status}); try again later`,
    });
  }
  return rejected(gateway, status, body);
}

export function refusalOf(
  gateway: string,
  status: number,
  body: unknown,
  rejected: Rejecting = rejectedRequest,
): GatewayRefusal {
  return isBudgetRefusal(status, body)
    ? outOfBudget(gateway, status)
    : refusalOfItsStatus(gateway, status, body, rejected);
}

export function bytesRefusedBy(kind: string): Rejecting {
  return (gateway, status, body) =>
    isModerationRefusal(body)
      ? blockedByModeration(gateway)
      : new Unavailable({
          detail: `The gateway ${gateway} refused the bytes of the ${kind} it made (HTTP ${status})${codeInWords(body)}; a new run asks for it again`,
        });
}

const shownMediaType = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u;

export function notOfTheKind(
  gateway: string,
  mediaType: string,
  kind: 'audio' | 'video',
  record: Schema.JsonObject,
): Unavailable {
  const named = shownMediaType.test(mediaType)
    ? `as ${mediaType}, which is no ${kind}`
    : `in a type that is no ${kind}`;
  return new Unavailable({ detail: `The gateway ${gateway} answered ${named}; try again`, record });
}

export function tooLargeAnAsset(kind: string, mostBytes: number, record: Schema.JsonObject): Conflict {
  return new Conflict({
    detail: `The ${kind} the model made is larger than the ${sizeInWords(mostBytes)} this runtime keeps of one ${kind}`,
    kind: 'oversized',
    record,
  });
}

export function isPassing(status: number): boolean {
  return passingStatuses.has(status) || status >= 500;
}

export function forgottenBy(gateway: string, kind: string, record: Schema.JsonObject): Unavailable {
  return new Unavailable({
    detail: `The gateway ${gateway} no longer knows the ${kind} it was making; a new run asks for it again`,
    record,
  });
}

export function failedAtTheProvider(
  gateway: string,
  kind: string,
  error: unknown,
  record: Schema.JsonObject,
): GatewayRefusal {
  const body = { error };
  return isModerationRefusal(body)
    ? blockedByModeration(gateway)
    : new Unavailable({
        detail: `The provider behind the gateway ${gateway} could not make the ${kind}${codeInWords(body)}; try again`,
        record,
      });
}

export function unreadableAnswer(gateway: string, what: string, record: Schema.JsonObject): Unavailable {
  return new Unavailable({ detail: `The answer of the gateway ${gateway} held no ${what}; try again`, record });
}
