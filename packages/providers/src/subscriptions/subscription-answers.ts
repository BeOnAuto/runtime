import { Buffer } from 'node:buffer';

import { textAt, valueAt } from '@on.auto/definitions/tool-blocks';
import { stringFormats } from '@on.auto/json-schema';
import { answerDocument, toolBounds, type CalledOnce, type RequestedOnce } from '@on.auto/tool-servers';
import { Effect, Redacted, type Schema } from 'effect';

import type { Destination } from '../events/destination-fields.ts';
import { failedBecause, refusedAs, requestRefusedAs, type SubscriptionCallFailed } from './subscription-failed.ts';
import type { Renewed, Subscribed, SubscriptionSecret } from './subscription-ports.ts';

type Pointers = NonNullable<Destination['subscribe']>['subscribed'];

type RenewedPointers = NonNullable<Destination['renew']>['renewed'];

function isReadable(document: Schema.Json): boolean {
  return Buffer.byteLength(JSON.stringify(document), 'utf8') <= toolBounds.readAnswerBytes;
}

type Answered = Schema.Json | undefined;

function readable(document: Answered): Effect.Effect<Answered, SubscriptionCallFailed> {
  return document === undefined || isReadable(document)
    ? Effect.succeed(document)
    : Effect.fail(failedBecause('too_large'));
}

export function answeredIn(called: CalledOnce): Effect.Effect<Answered, SubscriptionCallFailed> {
  if (called.kind === 'unopened' || called.outcome !== 'result') {
    return Effect.fail(refusedAs(called));
  }
  return readable(answerDocument(called.answer));
}

export function requestedIn(requested: RequestedOnce): Effect.Effect<Answered, SubscriptionCallFailed> {
  if (requested.kind === 'unopened' || requested.outcome !== 'result') {
    return Effect.fail(requestRefusedAs(requested));
  }
  return readable(requested.answer);
}

function textIn(document: Schema.Json, pointer: string): string | undefined {
  const text = textAt(document, pointer);
  return text === '' ? undefined : text;
}

const isTime = stringFormats['date-time'].holds;

function timeIn(document: Answered, pointer: string | undefined): string | undefined {
  const value = pointer === undefined || document === undefined ? undefined : valueAt(document, pointer);
  if (typeof value !== 'string' || !isTime(value)) {
    return undefined;
  }
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : new Date(at).toISOString();
}

function expiringAt(expiresAt: string | undefined): { readonly expiresAt?: string } {
  return expiresAt === undefined ? {} : { expiresAt };
}

function answeredSecretIn(document: Schema.Json, pointer: string): SubscriptionSecret | undefined {
  const value = valueAt(document, pointer);
  return typeof value === 'string' && value !== '' ? { answered: Redacted.make(value) } : undefined;
}

function secretIn(
  document: Schema.Json,
  pointer: string | undefined,
  placed: boolean,
): Effect.Effect<{ readonly secret?: SubscriptionSecret }, SubscriptionCallFailed> {
  if (placed) {
    return Effect.succeed({ secret: 'made' });
  }
  if (pointer === undefined) {
    return Effect.succeed({});
  }
  const secret = answeredSecretIn(document, pointer);
  return secret === undefined ? Effect.fail(failedBecause('unreadable')) : Effect.succeed({ secret });
}

export function subscribedIn(
  document: Answered,
  pointers: Pointers,
  placed: boolean,
): Effect.Effect<Subscribed, SubscriptionCallFailed> {
  const id = document === undefined ? undefined : textIn(document, pointers.id);
  if (document === undefined || id === undefined) {
    return Effect.fail(failedBecause('unreadable'));
  }
  return Effect.map(secretIn(document, pointers.secret, placed), (secret) => ({
    id,
    ...expiringAt(timeIn(document, pointers.expires_at)),
    ...secret,
  }));
}

export function renewedIn(document: Answered, pointers: RenewedPointers): Renewed {
  return expiringAt(timeIn(document, pointers?.expires_at));
}
