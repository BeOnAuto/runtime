import { Conflict, Forbidden, Unavailable, type InvalidInput } from '@on.auto/operations';
import type { ConsentRefusal, SecretKeepingFailure } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import type { KeptConnection } from '../registry/registry.ts';
import {
  consentAskedForASignIn,
  namedOf,
  type ConsentAsked,
  type ConsentServices,
  type OwnClientUnheld,
} from './consent-asking.ts';
import { detailOf, refusedAt, unavailableWords, type ConsentNamed } from './consent-words.ts';
import { unansweredWordsOf } from './unanswered-words.ts';

export type ConsentRefused = Conflict | Forbidden | InvalidInput | Unavailable;

type Refusing = (detail: string) => ConsentRefused;

interface Refusal {
  readonly refusing: Refusing;
  readonly detail: string;
}

const conflict: Refusing = (detail) => new Conflict({ detail });

const forbidden: Refusing = (detail) => new Forbidden({ detail });

const unavailable: Refusing = (detail) => new Unavailable({ detail });

function refusedAtThe(pointer: string): Refusing {
  return (detail) => refusedAt(pointer, detail);
}

function refusalWordsOf(named: ConsentNamed, refusal: ConsentRefusal): Refusal {
  if (refusal.refused === 'host') {
    return { refusing: forbidden, detail: refusal.rule };
  }
  if (refusal.refused === 'unanswered') {
    return {
      refusing: unavailable,
      detail: unansweredWordsOf(`The consent of the connection ${named.name} cannot go on`, refusal.call),
    };
  }
  if (refusal.refused === 'registration_unavailable') {
    return { refusing: unavailable, detail: unavailableWords.registration(named.name, refusal.detail) };
  }
  if (refusal.refused === 'registration_refused') {
    return {
      refusing: conflict,
      detail: `The client the runtime registered for the connection ${named.name} cannot be kept: ${refusal.detail}`,
    };
  }
  if (refusal.refused === 'iss') {
    return {
      refusing: refusedAtThe('/iss'),
      detail: `Expected the issuer of the authorization server of the connection, ${named.issuer}`,
    };
  }
  return refusal.refused === 'code'
    ? { refusing: refusedAtThe('/code'), detail: 'Expected a code the authorization server takes; it refused this one' }
    : { refusing: conflict, detail: detailOf(named, refusal) };
}

function standingOf({ name, connected }: ConsentNamed, detail: string): string {
  return connected ? `${detail}; the connection ${name} stays connected as it was` : detail;
}

function refusedFor(named: ConsentNamed, { refusing, detail }: Refusal): ConsentRefused {
  return refusing(standingOf(named, detail));
}

export function consentRefusalOf(named: ConsentNamed, refusal: ConsentRefusal): ConsentRefused {
  return refusedFor(named, refusalWordsOf(named, refusal));
}

export function verifierUnkeptOf(named: ConsentNamed, detail: string): ConsentRefused {
  return refusedFor(named, { refusing: unavailable, detail: unavailableWords.verifierUnkept(named.name, detail) });
}

export function finishRefusalOf(named: ConsentNamed, refusal: ConsentRefusal, given: Returned): ConsentRefused {
  return given === 'handle' && refusal.refused === 'code'
    ? refusedFor(named, {
        refusing: refusedAtThe('/handle'),
        detail: "Expected a handle Auto's consent service takes; it refused this one",
      })
    : consentRefusalOf(named, refusal);
}

export function tokensUnkeptOf(named: ConsentNamed, { _tag, detail }: SecretKeepingFailure): ConsentRefused {
  return _tag === 'secret_refused'
    ? refusedFor(named, { refusing: conflict, detail })
    : refusedFor(named, { refusing: unavailable, detail: unavailableWords.tokensUnkept(named.name, detail) });
}

export function verifierUnreadOf(named: ConsentNamed, detail: string): ConsentRefused {
  return refusedFor(named, { refusing: unavailable, detail: unavailableWords.verifierUnread(named.name, detail) });
}

function ownClientRefusalOf(named: ConsentNamed, unheld: OwnClientUnheld): ConsentRefused {
  return 'detail' in unheld
    ? refusedFor(named, { refusing: unavailable, detail: unavailableWords.ownClientUnread(named.name, unheld.detail) })
    : refusedFor(named, {
        refusing: conflict,
        detail: `The client secret of the organization's own OAuth client for the connection ${named.name} is no longer in the secret store, so the person gives its client ID and client secret again on its page`,
      });
}

export function askedForASignIn(
  kept: KeptConnection,
  services: ConsentServices,
  scope: string | undefined,
): Effect.Effect<ConsentAsked, ConsentRefused> {
  return consentAskedForASignIn(kept, services, scope).pipe(
    Effect.mapError((unheld) => ownClientRefusalOf(namedOf(kept.connection), unheld)),
  );
}

const throughAuto = (name: string) =>
  `Expected handle: the consent of the connection ${name} began through Auto's consent service, which answers a handle, not a code`;

const throughAClientOfItsOwn = (name: string) =>
  `Expected code: the consent of the connection ${name} began with a client of this runtime's, which answers a code, not a handle`;

export type Returned = 'code' | 'handle';

export function wrongShapeOf(named: ConsentNamed, began: Returned, given: Returned): ConsentRefused | undefined {
  if (began === given) {
    return undefined;
  }
  return given === 'code'
    ? refusedFor(named, { refusing: refusedAtThe('/code'), detail: throughAuto(named.name) })
    : refusedFor(named, { refusing: refusedAtThe('/handle'), detail: throughAClientOfItsOwn(named.name) });
}
