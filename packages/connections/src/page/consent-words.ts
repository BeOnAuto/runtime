import { Conflict, Forbidden, InvalidInput, Unavailable } from '@on.auto/operations';
import type {
  ClientSource,
  ConsentRefusal,
  IssuerRefusal,
  RevocationFailure,
  SecretKeepingFailure,
  WayRefusal,
} from '@on.auto/tool-servers';

import { invalidAddition } from '../entries/entry-checks.ts';
import { servingWords } from '../serving/serving-words.ts';

export interface ConsentNamed {
  readonly name: string;
  readonly issuer: string;
  readonly provider: string | null;
}

export type ConsentRefused = Conflict | Forbidden | InvalidInput | Unavailable;

type ConflictingRefusal = Extract<
  ConsentRefusal,
  {
    readonly refused:
      | 'another_issuer'
      | 'another_resource'
      | 'no_metadata'
      | 'no_challenge'
      | 'unpinned_endpoint'
      | 'authorization_server_unnamed'
      | 'no_client'
      | 'client_gone'
      | 'studio_elsewhere'
      | 'start_refused'
      | 'no_scope'
      | 'malformed_scope';
  }
>;

type Unnamed = Exclude<
  ConflictingRefusal['refused'],
  'another_issuer' | 'another_resource' | 'unpinned_endpoint' | 'authorization_server_unnamed'
>;

const notAsAdded = 'so it cannot be connected as it was added';

const notByConsent = 'so this runtime cannot connect it by consent';

const takesNoChallenge = 'does not take the authorization code with an S256 challenge';

const didNotAnswerAsAnAuthorizationServer = 'did not answer as an authorization server does; try again in a moment';

const notAScope = 'written with characters a scope does not hold';

function namesAsItsResource(other: string): string {
  return `names ${other} as the resource it protects, which is not its own address`;
}

function namesAsItsIssuer(other: string): string {
  return `names ${other} as its issuer in its own metadata`;
}

function namesAsAnEndpoint(endpoint: string): string {
  return `names ${endpoint} as an endpoint, which is neither https nor on a loopback address`;
}

function noLongerNamedAt(url: string): string {
  return `The server at ${url} no longer names its authorization server, so the consent cannot go on; remove the connection and add it again`;
}

export const unavailableWords = {
  registration: (name: string, detail: string) =>
    `The client the runtime registered for the connection ${name} cannot be kept or read now: ${detail}`,
  verifierUnkept: (name: string, detail: string) =>
    `The consent of the connection ${name} cannot be started now, since the runtime cannot keep its verifier: ${detail}`,
  verifierUnread: (name: string, detail: string) =>
    `The consent of the connection ${name} cannot be finished now, since the runtime cannot read its verifier; the same code may be tried again shortly: ${detail}`,
  tokensUnkept: (name: string, detail: string) =>
    `The tokens of the connection ${name} cannot be kept now, and the code they were given for is spent, so the person starts the consent again: ${detail}`,
  credentialUnkept: (name: string, detail: string) =>
    `The credential of the connection ${name} cannot be kept now, so the connection is not connected and its link stays open: ${detail}`,
  tokensUnread: (name: string, detail: string) =>
    `The tokens of the connection ${name} cannot be read now, so they were not revoked and end on their own: ${detail}`,
} as const;

const conflictsOf: Readonly<Record<Unnamed, (named: ConsentNamed) => string>> = {
  no_metadata: ({ name, issuer }) =>
    `The authorization server of the connection ${name}, ${issuer}, publishes no metadata, ${notAsAdded}`,
  no_challenge: ({ name }) =>
    `The authorization server of the connection ${name} ${takesNoChallenge}, which Auto asks for`,
  no_client: ({ name }) =>
    `The authorization server of the connection ${name} takes none of the clients this runtime has for it, ${notAsAdded}`,
  client_gone: ({ name }) => servingWords.clientGone(name),
  start_refused: ({ name }) =>
    `Auto's consent service did not start the consent of the connection ${name}: Auto has no client at its authorization server, or the service does not send people back to the Studio its link opens, so whoever runs this runtime registers a client`,
  studio_elsewhere: ({ name }) =>
    `The connection ${name} takes consent through Auto's client only where Studio is Auto's or on this computer, so whoever runs this runtime registers a client`,
  malformed_scope: ({ name }) =>
    `The authorization server of the connection ${name} granted a scope ${notAScope}, ${notAsAdded}`,
  no_scope: ({ name }) =>
    `The authorization server of the connection ${name} granted none of the scopes asked, so the connection is not connected; start again and allow them`,
};

function whereItWasNamed({ issuer, provider }: ConsentNamed): string {
  return provider === null
    ? `where it named ${issuer} when the connection was added`
    : `where its provider names ${issuer}`;
}

const issuerNamedBy: Readonly<
  Record<'server' | 'authorization_server', (named: ConsentNamed, other: string) => string>
> = {
  server: (named, other) =>
    `The server of the connection ${named.name} names ${other} as its authorization server, ${whereItWasNamed(named)}, ${notAsAdded}`,
  authorization_server: (named, other) =>
    `The authorization server of the connection ${named.name} ${namesAsItsIssuer(other)}, ${whereItWasNamed(named)}, ${notAsAdded}`,
};

function refusedAt(pointer: string, detail: string): InvalidInput {
  return new InvalidInput({ detail: 'The consent cannot be finished as it is given', issues: [{ pointer, detail }] });
}

function detailOf(named: ConsentNamed, refusal: ConflictingRefusal): string {
  if (refusal.refused === 'another_issuer') {
    return issuerNamedBy[refusal.by](named, refusal.named);
  }
  if (refusal.refused === 'another_resource') {
    return `The server of the connection ${named.name} ${namesAsItsResource(refusal.named)}, ${notAsAdded}`;
  }
  if (refusal.refused === 'unpinned_endpoint') {
    return `The authorization server of the connection ${named.name} ${namesAsAnEndpoint(refusal.endpoint)}, ${notAsAdded}`;
  }
  return refusal.refused === 'authorization_server_unnamed'
    ? noLongerNamedAt(refusal.url)
    : conflictsOf[refusal.refused](named);
}

function conflictOf(named: ConsentNamed, refusal: ConflictingRefusal): Conflict {
  return new Conflict({ detail: detailOf(named, refusal) });
}

export function consentRefusalOf(named: ConsentNamed, refusal: ConsentRefusal): ConsentRefused {
  if (refusal.refused === 'host') {
    return new Forbidden({ detail: refusal.rule });
  }
  if (refusal.refused === 'unanswered') {
    return new Unavailable({
      detail: `The authorization server of the connection ${named.name} ${didNotAnswerAsAnAuthorizationServer}`,
    });
  }
  if (refusal.refused === 'registration_unavailable') {
    return new Unavailable({ detail: unavailableWords.registration(named.name, refusal.detail) });
  }
  if (refusal.refused === 'registration_refused') {
    return new Conflict({
      detail: `The client the runtime registered for the connection ${named.name} cannot be kept: ${refusal.detail}`,
    });
  }
  if (refusal.refused === 'iss') {
    return refusedAt('/iss', `Expected the issuer of the authorization server of the connection, ${named.issuer}`);
  }
  return refusal.refused === 'code'
    ? refusedAt('/code', 'Expected a code the authorization server takes; it refused this one')
    : conflictOf(named, refusal);
}

type RefusedAtTheServer = Exclude<WayRefusal, { readonly refused: 'host' | 'unanswered' | 'at_the_issuer' }>;

type RefusedAtTheIssuer = Extract<WayRefusal, { readonly refused: 'at_the_issuer' }>;

export type WayRefused = Forbidden | InvalidInput | Unavailable;

const refusedByTheIssuer: Readonly<
  Record<Exclude<IssuerRefusal['refused'], 'another_issuer' | 'unpinned_endpoint' | 'unanswered'>, string>
> = {
  no_metadata: `publishes no metadata that can be read, ${notByConsent}`,
  no_challenge: `${takesNoChallenge}, ${notByConsent}`,
  no_client: `registers no clients, ${notByConsent}: it takes a client registered dynamically or named by a metadata document, and offers neither`,
};

function refusedKindOf(detail: string): InvalidInput {
  return invalidAddition([{ pointer: '/credential/kind', detail }]);
}

function serverWordsOf(url: string, refusal: RefusedAtTheServer): string {
  if (refusal.refused === 'another_resource') {
    return `The server at ${url} ${namesAsItsResource(refusal.named)}, ${notByConsent}`;
  }
  return refusal.refused === 'malformed_scope'
    ? `The server at ${url} asks a scope ${notAScope}, ${notByConsent}`
    : `The server at ${url} names no authorization server, so it offers no consent; give the credential it takes: a secret in a header, or none`;
}

function issuerWordsOf(refusal: Exclude<IssuerRefusal, { readonly refused: 'unanswered' }>): string {
  if (refusal.refused === 'another_issuer') {
    return `${namesAsItsIssuer(refusal.named)}, ${notByConsent}`;
  }
  return refusal.refused === 'unpinned_endpoint'
    ? `${namesAsAnEndpoint(refusal.endpoint)}, ${notByConsent}`
    : refusedByTheIssuer[refusal.refused];
}

function issuerRefusalOf(url: string, { issuer, refusal }: RefusedAtTheIssuer): InvalidInput | Unavailable {
  const named = `The authorization server ${issuer} of the server at ${url}`;
  return refusal.refused === 'unanswered'
    ? new Unavailable({ detail: `${named} ${didNotAnswerAsAnAuthorizationServer}` })
    : refusedKindOf(`${named} ${issuerWordsOf(refusal)}`);
}

export function wayRefusalOf(url: string, refusal: WayRefusal): WayRefused {
  if (refusal.refused === 'host') {
    return new Forbidden({ detail: refusal.rule });
  }
  if (refusal.refused === 'unanswered') {
    return new Unavailable({
      detail: `The server at ${url} did not answer as an MCP server does; try again in a moment`,
    });
  }
  return refusal.refused === 'at_the_issuer'
    ? issuerRefusalOf(url, refusal)
    : refusedKindOf(serverWordsOf(url, refusal));
}

export function tokensUnkeptOf({ name }: ConsentNamed, { _tag, detail }: SecretKeepingFailure): Conflict | Unavailable {
  return _tag === 'secret_refused'
    ? new Conflict({ detail })
    : new Unavailable({ detail: unavailableWords.tokensUnkept(name, detail) });
}

const throughAuto = (name: string) =>
  `Expected handle: the consent of the connection ${name} began through Auto's consent service, which answers a handle, not a code`;

const throughAClientOfItsOwn = (name: string) =>
  `Expected code: the consent of the connection ${name} began with a client of this runtime's, which answers a code, not a handle`;

export type Returned = 'code' | 'handle';

export function wrongShapeOf({ name }: ConsentNamed, began: Returned, given: Returned): InvalidInput | undefined {
  if (began === given) {
    return undefined;
  }
  return given === 'code' ? refusedAt('/code', throughAuto(name)) : refusedAt('/handle', throughAClientOfItsOwn(name));
}

export function finishRefusalOf(named: ConsentNamed, refusal: ConsentRefusal, given: Returned): ConsentRefused {
  return given === 'handle' && refusal.refused === 'code'
    ? refusedAt('/handle', "Expected a handle Auto's consent service takes; it refused this one")
    : consentRefusalOf(named, refusal);
}

function unansweredRevocationOf(name: string, source: ClientSource): string {
  return source === 'auto'
    ? `Auto's consent service did not answer the revocation of the tokens of the connection ${name}, so they end on their own`
    : `The authorization server of the connection ${name} did not answer the revocation of its tokens, so they end on their own`;
}

export function unrevokedWordsOf({ name }: ConsentNamed, failure: RevocationFailure, source: ClientSource): string {
  if (failure.refused === 'not_revoked') {
    return `The authorization server of the connection ${name} refused to revoke its tokens, answering HTTP ${failure.status}, so they end on their own`;
  }
  if (failure.refused === 'host') {
    return `The tokens of the connection ${name} were not revoked, so they end on their own: ${failure.rule}`;
  }
  if (failure.refused === 'unknown_key') {
    return `Auto's consent service does not know the key of the connection ${name}, so its tokens were not revoked and end on their own`;
  }
  if (failure.refused === 'registration_unavailable') {
    return `The tokens of the connection ${name} were not revoked, since the client they were given to cannot be read now, so they end on their own: ${failure.detail}`;
  }
  return failure.refused === 'unanswered'
    ? unansweredRevocationOf(name, source)
    : `The tokens of the connection ${name} could not be revoked with the client and at the authorization server it was made with, so they end on their own`;
}
